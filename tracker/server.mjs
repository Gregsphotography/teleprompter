/* ==========================================================================
   AeroPrompter visitor counter

   A single Node process, no dependencies, bound to loopback. nginx serves
   aeroprompter.app and proxies /api/hit and /stats here, so the tracker is
   same-origin with the site and never needs CORS.

   Storage is one append-only CSV file. No IP addresses are written: each hit
   is attributed to a hash of a salt that changes daily and is overwritten
   when it does. Set TRACKER_STORE_RAW_IP=1 to store raw IPs instead — see
   README.md for what that obliges you to do.
   ========================================================================== */

import { createServer } from 'node:http';
import { appendHit, csvPath, readHits } from './store.mjs';
import { renderDashboard } from './dashboard.mjs';

const PORT = Number(process.env.TRACKER_PORT || 8787);
const HOST = process.env.TRACKER_HOST || '127.0.0.1';

const MAX_BODY_BYTES = 4 * 1024;
const MAX_PATH_LENGTH = 512;
const MAX_REFERRER_LENGTH = 253;

// Generous for any real visitor, low enough that one source can't inflate the
// numbers. This is a single long-lived process, so the map is authoritative.
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const rateBuckets = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  if (rateBuckets.size > 10000) {
    for (const [key, bucket] of rateBuckets) {
      if (now - bucket.start > RATE_LIMIT_WINDOW_MS) rateBuckets.delete(key);
    }
  }

  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.start > RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(ip, { start: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX;
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_BODY_BYTES) throw new Error('Body too large');
    chunks.push(buf);
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

// The character classes here are what guarantee the CSV never needs quoting:
// neither pattern admits a comma, quote or newline.
function normalizePath(value) {
  const path = String(value || '/').trim();
  if (!path.startsWith('/') || path.length > MAX_PATH_LENGTH) return null;
  if (!/^\/[A-Za-z0-9\-._~/]*$/.test(path)) return null;
  return path;
}

function normalizeReferrerHost(value) {
  if (!value) return null;
  const host = String(value).trim().toLowerCase();
  if (host.length > MAX_REFERRER_LENGTH) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  return host;
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health' && req.method === 'GET') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('ok\n');
  }

  // nginx gates this behind basic auth, and the service binds to loopback, so
  // an unauthenticated request can't reach here in the first place.
  if ((url.pathname === '/dashboard' || url.pathname === '/dashboard/') && req.method === 'GET') {
    let html;
    try {
      html = renderDashboard(readHits());
    } catch (error) {
      console.error('Dashboard render failed:', error.message);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.end('Could not render dashboard\n');
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    );
    return res.end(html);
  }

  if (url.pathname !== '/hit' || req.method !== 'POST') {
    res.statusCode = 404;
    return res.end();
  }

  handleHit(req).catch(error => {
    console.warn('Hit discarded:', error.message);
  }).finally(() => {
    // Always 204, whatever happened. The client can't act on the outcome and
    // shouldn't learn anything from it either.
    res.statusCode = 204;
    res.end();
  });
});

async function handleHit(req) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('application/json') && !contentType.includes('text/plain')) {
    req.resume();
    throw new Error('Unsupported media type');
  }

  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    req.resume();
    throw new Error('Rate limited');
  }

  const body = await readJsonBody(req);

  const path = normalizePath(body.path);
  if (!path) throw new Error('Invalid path');

  const userAgent = String(req.headers['user-agent'] || '').slice(0, 512);
  appendHit({ path, referrer: normalizeReferrerHost(body.ref) }, ip, userAgent);
}

server.listen(PORT, HOST, () => {
  console.log(`AeroPrompter tracker listening on http://${HOST}:${PORT}`);
  console.log(`Writing to ${csvPath()}`);
  console.log(process.env.TRACKER_STORE_RAW_IP === '1'
    ? 'WARNING: storing raw IP addresses (TRACKER_STORE_RAW_IP=1)'
    : 'Storing daily-rotating salted hashes; no personal data at rest');
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

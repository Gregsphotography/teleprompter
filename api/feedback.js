const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_BODY_BYTES = 16 * 1024;
const MAILGUN_ENDPOINT = 'https://api.eu.mailgun.net/v3';

// Best-effort per-IP rate limit. Serverless instances don't share memory, so
// this only bounds abuse per warm instance — combined with the honeypot it
// keeps casual spam out without external dependencies.
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const rateBuckets = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  if (rateBuckets.size > 1000) {
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

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sanitizeHeaderValue(value) {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  if (typeof req.body === 'string') {
    return JSON.parse(req.body);
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error('Body too large');
    }
    chunks.push(buf);
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

module.exports = async function feedbackHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const contentType = req.headers['content-type'] || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return sendJson(res, 415, { ok: false, error: 'Unsupported media type' });
  }

  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return sendJson(res, 413, { ok: false, error: 'Payload too large' });
  }

  if (isRateLimited(getClientIp(req))) {
    return sendJson(res, 429, { ok: false, error: 'Too many requests' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    console.warn('Feedback request contained invalid or oversized JSON');
    return sendJson(res, 400, { ok: false, error: 'Invalid request' });
  }

  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const message = String(body.message || '').trim();
  const company = String(body.company || '').trim();

  if (company) {
    return sendJson(res, 200, { ok: true });
  }

  if (
    !name ||
    !email ||
    !message ||
    name.length > MAX_NAME_LENGTH ||
    email.length > MAX_EMAIL_LENGTH ||
    message.length > MAX_MESSAGE_LENGTH ||
    !isValidEmail(email)
  ) {
    return sendJson(res, 400, { ok: false, error: 'Invalid request' });
  }

  const { MAILGUN_API_KEY, MAILGUN_DOMAIN, MAILGUN_FROM, FEEDBACK_TO } = process.env;
  if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN || !MAILGUN_FROM || !FEEDBACK_TO) {
    console.error('Feedback Mailgun configuration is incomplete');
    return sendJson(res, 500, { ok: false, error: 'Could not send feedback' });
  }

  const form = new URLSearchParams();
  form.set('from', sanitizeHeaderValue(MAILGUN_FROM));
  form.set('to', sanitizeHeaderValue(FEEDBACK_TO));
  form.set('subject', `AeroPrompter feedback from ${sanitizeHeaderValue(name)}`);
  form.set('text', [
    `Name: ${name}`,
    `Email: ${email}`,
    '',
    message
  ].join('\n'));
  form.set('h:Reply-To', `${sanitizeHeaderValue(name)} <${sanitizeHeaderValue(email)}>`);

  try {
    const response = await fetch(`${MAILGUN_ENDPOINT}/${encodeURIComponent(MAILGUN_DOMAIN)}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form
    });

    if (!response.ok) {
      const responseText = await response.text();
      console.error('Mailgun feedback send failed', {
        status: response.status,
        body: responseText.slice(0, 500)
      });
      return sendJson(res, 502, { ok: false, error: 'Could not send feedback' });
    }

    return sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error('Feedback send request failed', error);
    return sendJson(res, 502, { ok: false, error: 'Could not send feedback' });
  }
};

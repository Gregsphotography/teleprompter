#!/usr/bin/env node
/* ==========================================================================
   AeroPrompter visitor counter - read-only reporting

   Run over SSH on the server holding the database. Nothing here is exposed
   to the web; this CLI is the only way to read the data.

     node tracker/stats.mjs              last 30 days
     node tracker/stats.mjs --days 90    a longer window
     node tracker/stats.mjs --total      all-time totals
     node tracker/stats.mjs --paths      most visited paths
     node tracker/stats.mjs --referrers  where visitors came from
   ========================================================================== */

import { DatabaseSync } from 'node:sqlite';

const DB_PATH = process.env.TRACKER_DB || '/var/lib/aeroprompter/hits.db';

const args = process.argv.slice(2);

function flagValue(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const days = flagValue('--days', 30);
const limit = flagValue('--limit', 20);

let db;
try {
  db = new DatabaseSync(DB_PATH, { readOnly: true });
} catch (error) {
  console.error(`Could not open ${DB_PATH}: ${error.message}`);
  console.error('Set TRACKER_DB if the database lives elsewhere.');
  process.exit(1);
}

function pad(value, width) {
  return String(value).padStart(width);
}

function printTable(rows, columns) {
  if (rows.length === 0) {
    console.log('  (no data yet)');
    return;
  }

  const widths = columns.map(col => Math.max(
    col.label.length,
    ...rows.map(row => String(row[col.key] ?? '').length)
  ));

  console.log('  ' + columns.map((col, i) =>
    col.align === 'right' ? pad(col.label, widths[i]) : col.label.padEnd(widths[i])
  ).join('  '));

  console.log('  ' + widths.map(w => '-'.repeat(w)).join('  '));

  rows.forEach(row => {
    console.log('  ' + columns.map((col, i) => {
      const value = String(row[col.key] ?? '');
      return col.align === 'right' ? pad(value, widths[i]) : value.padEnd(widths[i]);
    }).join('  '));
  });
}

if (args.includes('--total')) {
  const totals = db.prepare(`
    SELECT COUNT(*) AS pageviews,
           COUNT(DISTINCT day || visitor) AS daily_visitors,
           MIN(day) AS first_day,
           MAX(day) AS last_day
    FROM hits
  `).get();

  console.log('\nAll time');
  console.log(`  Pageviews:          ${totals.pageviews ?? 0}`);
  // Hashes are per-day by design, so this counts visitor-days, not people.
  console.log(`  Visitor-days:       ${totals.daily_visitors ?? 0}`);
  console.log(`  Range:              ${totals.first_day || 'n/a'} to ${totals.last_day || 'n/a'}\n`);
} else if (args.includes('--paths')) {
  const rows = db.prepare(`
    SELECT path, COUNT(*) AS pageviews, COUNT(DISTINCT day || visitor) AS visitors
    FROM hits GROUP BY path ORDER BY pageviews DESC LIMIT ?
  `).all(limit);

  console.log(`\nTop paths (limit ${limit})\n`);
  printTable(rows, [
    { key: 'path', label: 'PATH' },
    { key: 'visitors', label: 'VISITORS', align: 'right' },
    { key: 'pageviews', label: 'VIEWS', align: 'right' }
  ]);
  console.log('');
} else if (args.includes('--referrers')) {
  const rows = db.prepare(`
    SELECT referrer_host AS host, COUNT(*) AS pageviews
    FROM hits WHERE referrer_host IS NOT NULL
    GROUP BY referrer_host ORDER BY pageviews DESC LIMIT ?
  `).all(limit);

  console.log(`\nTop referrers (limit ${limit})\n`);
  printTable(rows, [
    { key: 'host', label: 'REFERRER' },
    { key: 'pageviews', label: 'VIEWS', align: 'right' }
  ]);
  console.log('');
} else {
  const rows = db.prepare(`
    SELECT day, COUNT(DISTINCT visitor) AS visitors, COUNT(*) AS pageviews
    FROM hits GROUP BY day ORDER BY day DESC LIMIT ?
  `).all(days);

  console.log(`\nLast ${days} days\n`);
  printTable(rows, [
    { key: 'day', label: 'DAY' },
    { key: 'visitors', label: 'VISITORS', align: 'right' },
    { key: 'pageviews', label: 'VIEWS', align: 'right' }
  ]);

  const totals = rows.reduce((acc, row) => ({
    visitors: acc.visitors + row.visitors,
    pageviews: acc.pageviews + row.pageviews
  }), { visitors: 0, pageviews: 0 });

  console.log(`\n  Sum over window: ${totals.visitors} visitor-days, ${totals.pageviews} pageviews\n`);
}

db.close();

#!/usr/bin/env node
/* ==========================================================================
   AeroPrompter visitor counter - read-only reporting

   Reads the CSV. You can equally just open the file — this is only here so
   you don't have to count rows by hand.

     node stats.mjs              last 30 days
     node stats.mjs --days 90    a longer window
     node stats.mjs --total      all-time totals
     node stats.mjs --paths      most visited paths
     node stats.mjs --referrers  where visitors came from
   ========================================================================== */

import { csvPath, dailyRows, readHits, topPaths, topReferrers, totals } from './store.mjs';

const args = process.argv.slice(2);

function flagValue(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const days = flagValue('--days', 30);
const limit = flagValue('--limit', 20);

const hits = readHits();

if (hits.length === 0) {
  console.log(`\nNo visits recorded yet (${csvPath()} is empty or missing).\n`);
  process.exit(0);
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
  const summary = totals(hits);
  console.log('\nAll time');
  console.log(`  Pageviews:          ${summary.pageviews}`);
  // Hashes are per-day by design, so this counts visitor-days, not people.
  console.log(`  Visitor-days:       ${summary.visitors}`);
  console.log(`  Range:              ${summary.first_day} to ${summary.last_day}\n`);
} else if (args.includes('--paths')) {
  console.log(`\nTop paths (limit ${limit})\n`);
  printTable(topPaths(hits, limit), [
    { key: 'path', label: 'PATH' },
    { key: 'visitors', label: 'VISITORS', align: 'right' },
    { key: 'pageviews', label: 'VIEWS', align: 'right' }
  ]);
  console.log('');
} else if (args.includes('--referrers')) {
  console.log(`\nTop referrers (limit ${limit})\n`);
  printTable(topReferrers(hits, limit), [
    { key: 'host', label: 'REFERRER' },
    { key: 'pageviews', label: 'VIEWS', align: 'right' }
  ]);
  console.log('');
} else {
  const rows = dailyRows(hits, days);
  console.log(`\nLast ${days} days\n`);
  printTable(rows, [
    { key: 'day', label: 'DAY' },
    { key: 'visitors', label: 'VISITORS', align: 'right' },
    { key: 'pageviews', label: 'VIEWS', align: 'right' }
  ]);

  const sum = rows.reduce((acc, row) => ({
    visitors: acc.visitors + row.visitors,
    pageviews: acc.pageviews + row.pageviews
  }), { visitors: 0, pageviews: 0 });

  console.log(`\n  Sum over window: ${sum.visitors} visitor-days, ${sum.pageviews} pageviews\n`);
}

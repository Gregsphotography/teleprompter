/* ==========================================================================
   AeroPrompter visitor counter - dashboard rendering

   Server-rendered, fully self-contained HTML: no scripts, no external
   requests, no fonts. Caddy puts this behind basic auth; the database itself
   is never exposed, only these rendered numbers.
   ========================================================================== */

import { dailyRows, dayOffset, summaryForDays, topPaths, topReferrers, totals, utcDay } from './queries.mjs';

const CHART_DAYS = 30;

// Pad the window out to a full CHART_DAYS so quiet days show as gaps rather
// than vanishing — otherwise a brand new install renders one bar stretched
// across the whole chart, and later charts silently compress their timeline.
function fillMissingDays(rows, days) {
  const byDay = new Map(rows.map(row => [row.day, row]));
  const today = utcDay();
  const filled = [];

  for (let i = days - 1; i >= 0; i--) {
    const day = dayOffset(today, -i);
    filled.push(byDay.get(day) || { day, visitors: 0, pageviews: 0 });
  }

  return filled;
}

// path and referrer_host originate from visitors' browsers. They are validated
// on write, but anything rendered into HTML gets escaped regardless.
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function num(value) {
  return Number(value || 0).toLocaleString('en-GB');
}

function statCard(label, visitors, pageviews) {
  return `
    <div class="card">
      <p class="card-label">${esc(label)}</p>
      <p class="card-value">${num(visitors)}</p>
      <p class="card-sub">${num(pageviews)} pageviews</p>
    </div>`;
}

function chart(rows) {
  const peak = Math.max(...rows.map(row => row.visitors), 1);

  const bars = rows.map(row => {
    const height = row.visitors === 0 ? 0 : Math.max(3, Math.round((row.visitors / peak) * 100));
    const title = `${row.day}: ${row.visitors} visitors, ${row.pageviews} pageviews`;
    return `<div class="bar-slot" title="${esc(title)}">
      <div class="bar${row.visitors === 0 ? ' bar-empty' : ''}" style="height:${height}%"></div>
      <span class="bar-day">${esc(row.day.slice(8))}</span>
    </div>`;
  }).join('');

  return `<div class="chart" role="img" aria-label="Daily visitors for the last ${rows.length} days">${bars}</div>`;
}

function table(caption, columns, rows, emptyMessage) {
  if (rows.length === 0) return `<h2>${esc(caption)}</h2><p class="empty">${esc(emptyMessage)}</p>`;

  const head = columns.map(col =>
    `<th${col.align === 'right' ? ' class="right"' : ''}>${esc(col.label)}</th>`).join('');

  const body = rows.map(row => {
    const cells = columns.map(col =>
      `<td${col.align === 'right' ? ' class="right"' : ''}>${esc(row[col.key])}</td>`).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  return `<h2>${esc(caption)}</h2>
    <div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

const STYLES = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 20px 64px;
    background: #0a0d14; color: #e8ecf4;
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .shell { max-width: 960px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; }
  .meta { color: #7d8799; font-size: .85rem; margin: 0 0 32px; }
  h2 { font-size: .8rem; text-transform: uppercase; letter-spacing: .08em;
       color: #7d8799; margin: 40px 0 12px; }
  .cards { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  .card { background: #121722; border: 1px solid #1f2634; border-radius: 12px; padding: 16px; }
  .card-label { margin: 0 0 8px; font-size: .75rem; text-transform: uppercase;
                letter-spacing: .07em; color: #7d8799; }
  .card-value { margin: 0; font-size: 1.9rem; font-weight: 700; line-height: 1; }
  .card-sub { margin: 6px 0 0; font-size: .8rem; color: #7d8799; }
  .chart { display: flex; align-items: flex-end; gap: 3px; height: 180px;
           background: #121722; border: 1px solid #1f2634; border-radius: 12px;
           padding: 16px 12px 8px; overflow-x: auto; }
  .bar-slot { flex: 1 1 0; min-width: 14px; height: 100%;
              display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 6px; }
  .bar { width: 100%; border-radius: 3px 3px 0 0;
         background: linear-gradient(180deg, #38bdf8, #0284c7); }
  /* A day with no visits still occupies a slot, so the timeline stays honest */
  .bar-empty { height: 2px !important; background: #1f2634; border-radius: 2px; }
  .bar-day { font-size: .65rem; color: #5c6675; }
  .table-wrap { overflow-x: auto; border: 1px solid #1f2634; border-radius: 12px; background: #121722; }
  table { width: 100%; border-collapse: collapse; font-size: .9rem; }
  th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #1f2634; }
  th { font-size: .7rem; text-transform: uppercase; letter-spacing: .06em; color: #7d8799; }
  tr:last-child td { border-bottom: none; }
  .right { text-align: right; }
  .empty { color: #7d8799; font-style: italic; }
  .note { margin-top: 48px; padding-top: 16px; border-top: 1px solid #1f2634;
          color: #5c6675; font-size: .8rem; }
  @media (max-width: 600px) {
    body { padding: 20px 12px 48px; }
    .bar-day { display: none; }
    /* Let the bars shrink so the whole window fits. Scrolling would default to
       the left, hiding the most recent days — the ones actually being read. */
    .chart { gap: 2px; overflow-x: visible; }
    .bar-slot { min-width: 0; }
  }
`;

export function renderDashboard(db) {
  const rows = dailyRows(db, CHART_DAYS);
  const chartRows = fillMissingDays(rows, CHART_DAYS);

  const today = utcDay();
  const todayRow = rows.find(row => row.day === today) || { visitors: 0, pageviews: 0 };
  const week = summaryForDays(db, 7);
  const month = summaryForDays(db, 30);
  const allTime = totals(db);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>AeroPrompter visitors</title>
<style>${STYLES}</style>
</head>
<body>
<div class="shell">
  <h1>AeroPrompter visitors</h1>
  <p class="meta">All figures UTC. Generated ${esc(new Date().toISOString().replace('T', ' ').slice(0, 16))}.</p>

  <div class="cards">
    ${statCard('Today', todayRow.visitors, todayRow.pageviews)}
    ${statCard('Last 7 days', week.visitors, week.pageviews)}
    ${statCard('Last 30 days', month.visitors, month.pageviews)}
    ${statCard('All time', allTime.visitors, allTime.pageviews)}
  </div>

  <h2>Daily visitors, last ${CHART_DAYS} days</h2>
  ${chart(chartRows)}

  ${table('Top pages', [
    { key: 'path', label: 'Path' },
    { key: 'visitors', label: 'Visitors', align: 'right' },
    { key: 'pageviews', label: 'Views', align: 'right' }
  ], topPaths(db, 10), 'No pages recorded yet.')}

  ${table('Top referrers', [
    { key: 'host', label: 'Referrer' },
    { key: 'pageviews', label: 'Views', align: 'right' }
  ], topReferrers(db, 10), 'No external referrers yet.')}

  <p class="note">
    Visitor hashes are scoped to a single UTC day, so a person returning on
    three days counts three times. There is deliberately no way to follow
    someone across days. Range: ${esc(allTime.first_day || 'n/a')} to ${esc(allTime.last_day || 'n/a')}.
  </p>
</div>
</body>
</html>`;
}

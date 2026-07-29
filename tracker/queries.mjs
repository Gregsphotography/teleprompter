/* ==========================================================================
   AeroPrompter visitor counter - shared read queries

   Used by both stats.mjs (CLI) and the dashboard route in server.mjs, so the
   two can never disagree about what a number means.
   ========================================================================== */

export function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function dayOffset(day, days) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return utcDay(date);
}

// Callers pass user-supplied window sizes; clamp rather than trust.
function safeCount(value, fallback, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.min(Math.floor(number), max);
}

export function dailyRows(db, days = 30) {
  return db.prepare(`
    SELECT day, COUNT(DISTINCT visitor) AS visitors, COUNT(*) AS pageviews
    FROM hits GROUP BY day ORDER BY day DESC LIMIT ?
  `).all(safeCount(days, 30, 3650));
}

// A visitor hash is scoped to one day by design, so counting distinct
// day+visitor pairs gives visitor-days, not people. Named accordingly.
export function summaryForDays(db, days) {
  const since = dayOffset(utcDay(), -(safeCount(days, 30, 3650) - 1));
  return db.prepare(`
    SELECT COUNT(DISTINCT day || visitor) AS visitors, COUNT(*) AS pageviews
    FROM hits WHERE day >= ?
  `).get(since) || { visitors: 0, pageviews: 0 };
}

export function totals(db) {
  return db.prepare(`
    SELECT COUNT(*) AS pageviews,
           COUNT(DISTINCT day || visitor) AS visitors,
           MIN(day) AS first_day,
           MAX(day) AS last_day
    FROM hits
  `).get() || { pageviews: 0, visitors: 0, first_day: null, last_day: null };
}

export function topPaths(db, limit = 20) {
  return db.prepare(`
    SELECT path, COUNT(*) AS pageviews, COUNT(DISTINCT day || visitor) AS visitors
    FROM hits GROUP BY path ORDER BY pageviews DESC LIMIT ?
  `).all(safeCount(limit, 20, 500));
}

export function topReferrers(db, limit = 20) {
  return db.prepare(`
    SELECT referrer_host AS host, COUNT(*) AS pageviews
    FROM hits WHERE referrer_host IS NOT NULL
    GROUP BY referrer_host ORDER BY pageviews DESC LIMIT ?
  `).all(safeCount(limit, 20, 500));
}

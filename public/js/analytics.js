/* ==========================================================================
   AeroPrompter - First-party visitor counter

   Sends one beacon per page load to a self-hosted endpoint on our own EU
   server. No cookies, no persistent identifier, no third party. The server
   derives a daily-rotating salted hash from the request so visitors can be
   counted without anything personal being stored.
   ========================================================================== */

const ANALYTICS_ENDPOINT = 'https://stats.aeroprompter.app/hit';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '']);

// Only the referrer's hostname is ever sent — full URLs can carry query
// strings, which is exactly the kind of payload this tracker exists to avoid.
function getReferrerHost() {
  if (!document.referrer) return null;

  try {
    const { hostname } = new URL(document.referrer);
    return hostname === location.hostname ? null : hostname;
  } catch {
    return null;
  }
}

export function shouldTrack() {
  // Dev servers and the test suite run over http on loopback: never emit.
  if (location.protocol !== 'https:') return false;
  if (LOCAL_HOSTS.has(location.hostname)) return false;

  if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return false;
  if (navigator.globalPrivacyControl) return false;

  return true;
}

export function sendHit() {
  const payload = { path: location.pathname };
  const ref = getReferrerHost();
  if (ref) payload.ref = ref;

  const body = JSON.stringify(payload);

  // text/plain keeps this a CORS "simple request" — an application/json body
  // would trigger a preflight, and sendBeacon drops the beacon silently if the
  // preflight fails. The body is still JSON; the server parses it as such.
  const CONTENT_TYPE = 'text/plain;charset=UTF-8';

  // Counting must never surface to the user or delay anything: fire and forget,
  // swallow every failure (offline, blocked, endpoint down).
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: CONTENT_TYPE });
      if (navigator.sendBeacon(ANALYTICS_ENDPOINT, blob)) return;
    }

    fetch(ANALYTICS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': CONTENT_TYPE },
      body,
      keepalive: true,
      mode: 'cors',
      credentials: 'omit'
    }).catch(() => {});
  } catch {
    /* never let analytics break the app */
  }
}

export function initAnalytics() {
  if (shouldTrack()) sendHit();
}

/* ==========================================================================
   AeroPrompter - Native shell detection (Capacitor)

   The web build has no bundler, so native plugins are reached through the
   Capacitor runtime bridge (window.Capacitor.Plugins.*) instead of npm
   imports. In a browser these helpers report "not native" and every caller
   falls through to its normal web code path.
   ========================================================================== */

export function isNativeApp() {
  return !!window.Capacitor?.isNativePlatform?.();
}

export function getNativePlugin(name) {
  return window.Capacitor?.Plugins?.[name] ?? null;
}

// Relative /api/... URLs don't resolve from the capacitor://localhost origin,
// so the native app talks to the production API directly.
export const API_BASE = isNativeApp() ? 'https://aeroprompter.app' : '';

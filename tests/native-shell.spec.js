const { test, expect } = require('@playwright/test');

// Simulates the Capacitor runtime so the native code paths can be exercised
// in a browser: platform detection, the SpeechRecognition and KeepAwake
// plugin bridges, and the absolute API base URL.
const FAKE_CAPACITOR_BRIDGE = `
  window.__native = { keepAwake: 0, allowSleep: 0, speechStarts: 0, speechStops: 0, listeners: {} };
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      SpeechRecognition: {
        available: async () => ({ available: true }),
        requestPermissions: async () => ({ speechRecognition: 'granted' }),
        start: async () => {
          window.__native.speechStarts++;
          setTimeout(() => window.__native.listeners.listeningState?.({ status: 'started' }), 0);
        },
        stop: async () => {
          window.__native.speechStops++;
          setTimeout(() => window.__native.listeners.listeningState?.({ status: 'stopped' }), 0);
        },
        addListener: async (name, cb) => { window.__native.listeners[name] = cb; },
        removeAllListeners: async () => { window.__native.listeners = {}; }
      },
      KeepAwake: {
        keepAwake: async () => { window.__native.keepAwake++; },
        allowSleep: async () => { window.__native.allowSleep++; }
      }
    }
  };
`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(FAKE_CAPACITOR_BRIDGE);
  await page.goto('/');
});

test('native shell skips service worker registration', async ({ page }) => {
  await page.waitForLoadState('load');
  await page.waitForTimeout(500);
  const registrations = await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    return regs.length;
  });
  expect(registrations).toBe(0);
});

test('voice launch uses the native bridge: keep-awake, speech session, transcript-driven scrolling', async ({ page }) => {
  // Default script launches in voice mode with auto-start
  await page.click('#btn-launch');
  await expect(page.locator('#countdown-overlay')).toBeHidden({ timeout: 5000 });

  // Native speech session started and keep-awake engaged
  await expect.poll(() => page.evaluate(() => window.__native.speechStarts)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__native.keepAwake)).toBeGreaterThan(0);
  await expect(page.locator('#hud-voice-text')).toHaveText('Listening...');

  // Feed cumulative partial transcripts (as SFSpeechRecognizer does) built
  // from the actual script words and assert the prompter follows along.
  const advanced = await page.evaluate(async () => {
    const words = Array.from(document.querySelectorAll('.prompter-word'))
      .slice(0, 40)
      .map(el => el.textContent);
    for (let end = 4; end <= words.length; end += 4) {
      window.__native.listeners.partialResults?.({ matches: [words.slice(0, end).join(' ')] });
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    return {
      spoken: document.querySelectorAll('.prompter-word.spoken').length,
      current: document.querySelectorAll('.prompter-word.current-word').length
    };
  });
  expect(advanced.spoken).toBeGreaterThan(10);
  expect(advanced.current).toBe(1);

  // The voice ticker scrolls the viewport toward the matched word
  await expect.poll(
    () => page.evaluate(() => document.getElementById('prompter-viewport').scrollTop),
    { timeout: 5000 }
  ).toBeGreaterThan(0);
});

test('native speech session auto-restarts when iOS ends it mid-read', async ({ page }) => {
  await page.click('#btn-launch');
  await expect(page.locator('#countdown-overlay')).toBeHidden({ timeout: 5000 });
  await expect.poll(() => page.evaluate(() => window.__native.speechStarts)).toBe(1);

  // Simulate SFSpeechRecognizer's ~1-minute session cap ending the session
  await page.evaluate(() => window.__native.listeners.listeningState?.({ status: 'stopped' }));
  await expect.poll(() => page.evaluate(() => window.__native.speechStarts), { timeout: 3000 }).toBe(2);
  await expect(page.locator('#hud-voice-text')).toHaveText('Listening...');
});

test('exiting the prompter stops speech and releases keep-awake', async ({ page }) => {
  await page.click('#btn-launch');
  await expect(page.locator('#countdown-overlay')).toBeHidden({ timeout: 5000 });
  await expect.poll(() => page.evaluate(() => window.__native.speechStarts)).toBeGreaterThan(0);

  await page.keyboard.press('Escape');
  await expect(page.locator('#dashboard-view')).toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => window.__native.speechStops)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__native.allowSleep)).toBeGreaterThan(0);
  // Paused state must not trigger a session restart
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__native.speechStarts)).toBe(1);
});

test('feedback form posts to the absolute production API URL', async ({ page }) => {
  let requestedUrl = null;
  await page.route('https://aeroprompter.app/api/feedback', route => {
    requestedUrl = route.request().url();
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });

  await page.click('#btn-feedback');
  await page.fill('#feedback-name', 'Test User');
  await page.fill('#feedback-email', 'test@example.com');
  await page.fill('#feedback-message', 'Native shell test message');
  await page.click('#feedback-submit');

  await expect.poll(() => requestedUrl).toBe('https://aeroprompter.app/api/feedback');
});

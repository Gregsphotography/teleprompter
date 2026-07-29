const fs = require('fs');
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('loads with default scripts and live stats', async ({ page }) => {
  await expect(page.locator('.script-item')).toHaveCount(2);
  await expect(page.locator('#stat-words')).not.toHaveText('0');
  await expect(page.locator('#script-title-field')).not.toHaveValue('');
});

test('create, edit, duplicate, and delete scripts', async ({ page }) => {
  await page.click('#btn-new-script');
  await expect(page.locator('.script-item')).toHaveCount(3);

  await page.fill('#script-title-field', 'Test Speech');
  await page.fill('#script-editor-body', 'Hello world, this is a test script.');
  // Persistence is debounced; the sidebar catches up shortly after typing
  await expect(page.locator('.script-item.active .script-title')).toHaveText('Test Speech');

  await page.click('#btn-duplicate-script');
  await expect(page.locator('.script-item')).toHaveCount(4);
  await expect(page.locator('.script-item.active .script-title')).toHaveText('Test Speech Copy');

  page.on('dialog', dialog => dialog.accept());
  await page.locator('.script-item.active .btn-delete').click();
  await expect(page.locator('.script-item')).toHaveCount(3);
});

test('auto-scroll launches after countdown and pause/play keeps a stable rate', async ({ page }) => {
  await page.locator('#container-auto-scroll .switch').click();
  await expect(page.locator('#config-auto-scroll')).toBeChecked();

  await page.click('#btn-launch');
  await expect(page.locator('#countdown-overlay')).toBeVisible();
  await expect(page.locator('#countdown-overlay')).toBeHidden({ timeout: 5000 });

  const scrollTop = () => page.evaluate(() => document.getElementById('prompter-viewport').scrollTop);

  await page.waitForTimeout(1000);
  const s1 = await scrollTop();
  await page.waitForTimeout(1500);
  const s2 = await scrollTop();
  expect(s2).toBeGreaterThan(s1);

  // Rapid pause/play must not stack scroll loops (rate would double)
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(60);
  }
  const playing = await page.evaluate(() => document.getElementById('hud-svg-pause').style.display !== 'none');
  if (!playing) await page.keyboard.press('Space');
  await page.waitForTimeout(500);

  const t0 = await scrollTop();
  await page.waitForTimeout(2000);
  const t1 = await scrollTop();
  const toggledRate = (t1 - t0) / 2;

  await page.keyboard.press('KeyR');
  await page.waitForTimeout(500);
  const b0 = await scrollTop();
  await page.waitForTimeout(2000);
  const b1 = await scrollTop();
  const baselineRate = (b1 - b0) / 2;

  expect(toggledRate / baselineRate).toBeGreaterThan(0.7);
  expect(toggledRate / baselineRate).toBeLessThan(1.3);

  // Time remaining shows a real estimate during auto-scroll
  await expect(page.locator('#hud-time-remaining')).toHaveText(/^\d+:\d{2}$/);

  await page.keyboard.press('Escape');
  await expect(page.locator('#dashboard-view')).toHaveClass(/active/);
});

test('colourblind highlight never re-wraps the paragraph', async ({ page }) => {
  await page.locator('label.switch:has(#config-colorblind-mode)').click();
  await expect(page.locator('#config-colorblind-mode')).toBeChecked();

  // Keep the text still so geometry is measured against a stationary viewport
  await page.locator('label.switch:has(#config-auto-start)').click();
  await expect(page.locator('#config-auto-start')).not.toBeChecked();

  await page.click('#btn-launch');
  await expect(page.locator('.prompter-word').first()).toBeVisible();

  const measure = () => page.evaluate(() =>
    Array.from(document.querySelectorAll('.prompter-word'))
      .map(el => [el.offsetTop, el.offsetLeft, el.offsetWidth])
  );

  const before = await measure();
  expect(before.length).toBeGreaterThan(10);

  // Highlight the last word of a line — the one a wider box would push onto
  // the next line — and confirm no word anywhere moved.
  const highlightedIndex = await page.evaluate(() => {
    const words = Array.from(document.querySelectorAll('.prompter-word'));
    const index = words.findIndex((el, i) =>
      words[i + 1] && words[i + 1].offsetTop > el.offsetTop);
    if (index === -1) return -1;
    words[index].classList.add('current-word');
    void document.body.offsetHeight; // force layout
    return index;
  });

  expect(highlightedIndex).toBeGreaterThan(-1);
  expect(await measure()).toEqual(before);

  await page.keyboard.press('Escape');
});

test('export produces valid JSON and import round-trips', async ({ page }) => {
  const downloadPromise = page.waitForEvent('download');
  await page.click('#btn-export-scripts');
  const download = await downloadPromise;
  const filePath = await download.path();

  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  expect(payload.app).toBe('AeroPrompter');
  expect(Array.isArray(payload.scripts)).toBe(true);
  expect(payload.scripts.length).toBeGreaterThanOrEqual(2);

  const before = await page.locator('.script-item').count();
  await page.setInputFiles('#script-import-file', filePath);
  await expect(page.locator('.script-item')).toHaveCount(before + payload.scripts.length);
});

test('voice language preference persists across reloads', async ({ page }) => {
  await page.selectOption('#config-voice-lang', 'fr-FR');
  await page.reload();
  await expect(page.locator('#config-voice-lang')).toHaveValue('fr-FR');
});

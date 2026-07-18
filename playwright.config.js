const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3111',
    // Point CHROMIUM_EXECUTABLE at a system Chromium to skip the browser download
    launchOptions: process.env.CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
      : {}
  },
  webServer: {
    command: 'npx http-server public -p 3111 -c-1 --silent',
    url: 'http://127.0.0.1:3111',
    reuseExistingServer: !process.env.CI
  }
});

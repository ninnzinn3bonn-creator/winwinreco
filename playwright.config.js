const { defineConfig } = require('@playwright/test');
const fs = require('fs');

function resolveBrowserPath() {
    const candidates = [
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ].filter(Boolean);

    return candidates.find((candidate) => fs.existsSync(candidate));
}

const executablePath = resolveBrowserPath();

module.exports = defineConfig({
    testDir: './e2e',
    timeout: 60_000,
    expect: {
        timeout: 10_000
    },
    fullyParallel: false,
    retries: 0,
    workers: 1,
    use: {
        baseURL: 'http://127.0.0.1:3000',
        headless: true,
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
        launchOptions: {
            executablePath,
            args: [
                '--use-fake-ui-for-media-stream',
                '--use-fake-device-for-media-stream',
                '--autoplay-policy=no-user-gesture-required'
            ]
        }
    },
    webServer: {
        command: 'node src/backend/server.js',
        url: 'http://127.0.0.1:3000',
        reuseExistingServer: true,
        timeout: 120_000
    }
});

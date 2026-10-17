import { defineConfig } from "@playwright/test";
export default defineConfig({
    testDir: "tests/browser",
    workers: 1,
    timeout: 120000,
    expect: { timeout: 15000 },
    reporter: "list",
    use: {
        baseURL: "http://127.0.0.1:8000",
        headless: true,
        actionTimeout: 15000,
        viewport: { width: 1440, height: 1000 },
        launchOptions: {
            executablePath:
                process.env.PLAYWRIGHT_CHROME_EXECUTABLE ??
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        },
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    webServer: {
        command: "php artisan serve --host=127.0.0.1 --port=8000",
        url: "http://127.0.0.1:8000/api/csrf",
        reuseExistingServer: true,
    },
});

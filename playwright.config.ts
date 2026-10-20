import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "tests",
    timeout: 120_000,
    // software GL is CPU-bound; too many parallel workers make screenshots time out
    workers: 4,
    // under load, software-GL screenshots are slow: give comparisons time instead of failing on a timeout
    expect: { timeout: 30_000, toHaveScreenshot: { maxDiffPixelRatio: 0.002 } },
    reporter: [["list"], ["html", { open: "never", outputFolder: "reports/playwright" }]],
    webServer: { command: "npx vite --port 5180 --strictPort", port: 5180, reuseExistingServer: true },
    use: {
        baseURL: "http://localhost:5180/",
        viewport: { width: 1100, height: 800 },
        launchOptions: { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
    },
});

// The first 10 seconds, recorded on desktop and phone profiles (reports/videos/).
import { test, devices } from "@playwright/test";
import fs from "node:fs";

for (const [name, opts] of [["desktop", { viewport: { width: 1280, height: 800 } }], ["phone", (({ defaultBrowserType, ...d }) => d)(devices["Pixel 7"])]] as const) {
    test(`first 10 s video · ${name}`, async ({ playwright }) => {
        test.setTimeout(60_000);
        const browser = await playwright.chromium.launch();
        const size = name === "desktop" ? { width: 1280, height: 800 } : { width: 412, height: 915 };
        const ctx = await browser.newContext({ ...(opts as any), recordVideo: { dir: "reports/videos/tmp", size } });
        const page = await ctx.newPage();
        await page.goto("/");
        await page.waitForTimeout(10_000);
        const path = await page.video()!.path();
        await ctx.close();
        fs.mkdirSync("reports/videos", { recursive: true });
        fs.renameSync(path, `reports/videos/first-10s-${name}.webm`);
        await browser.close();
    });
}

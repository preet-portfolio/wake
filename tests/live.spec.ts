// The live view: alive within a second, a new design is one obvious action away,
// and the viewer's touch moves it. Runs on a real GPU.
import { test, expect, devices } from "@playwright/test";
import { changed, shot } from "./motion";

test.use({ launchOptions: { args: [] } });

test("visible motion within 1 second of opening", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => (window as any).wake);
    const a = await shot(page);
    await page.waitForTimeout(800);
    const b = await shot(page);
    expect(changed(a, b), "share of pixels changed in the first second").toBeGreaterThan(0.02);
});

test("each fresh visit starts from a different design", async ({ page }) => {
    const designs = new Set<number>();
    for (let i = 0; i < 3; i++) {
        await page.goto("/");
        await page.waitForFunction(() => (window as any).wake);
        designs.add(await page.evaluate(() => (window as any).wake.state.design));
        await page.goto("about:blank");
    }
    expect(designs.size).toBeGreaterThan(1);
});

for (const [name, opts] of [["desktop", { viewport: { width: 1440, height: 900 } }], ["phone", (({ defaultBrowserType, ...d }) => d)(devices["Pixel 7"])]] as const) {
    test(`✦ new is large and on screen (${name})`, async ({ browser }) => {
        const ctx = await browser.newContext(opts as any);
        const page = await ctx.newPage();
        await page.goto("/");
        await page.waitForFunction(() => (window as any).wake);
        const box = (await page.locator("#new").boundingBox())!;
        const vp = page.viewportSize()!;
        expect(box.width).toBeGreaterThanOrEqual(120);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
        await ctx.close();
    });
}

test("✦ new, a tap on the canvas and the space bar each give a new design", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => (window as any).wake);
    const n = () => page.evaluate(() => (window as any).wake.state.design as number);
    let last = await n();
    await page.click("#new");
    expect(await n()).not.toBe(last); last = await n();
    const box = (await page.locator("#art").boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
    expect(await n()).not.toBe(last); last = await n();
    await page.keyboard.press("Space");
    expect(await n()).not.toBe(last);
});

test("dragging stirs the drawing without replacing it", async ({ page }) => {
    await page.goto("/?particles=8000#n=808");
    await page.waitForFunction(() => (window as any).wake);
    await page.waitForTimeout(1500);
    const box = (await page.locator("#art").boundingBox())!;
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx - 150, cy);
    await page.mouse.down();
    for (let i = 0; i <= 20; i++) await page.mouse.move(cx - 150 + i * 15, cy + Math.sin(i / 3) * 80, { steps: 2 });
    await page.mouse.up();
    expect(await page.evaluate(() => (window as any).wake.state.design)).toBe(808); // a drag is not a tap
});

test("controls stay hidden until asked for", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => (window as any).wake);
    await expect(page.locator(".panel")).toBeHidden();
    await page.click("#edit");
    await expect(page.locator(".panel")).toBeVisible();
    await page.click("#close");
    await expect(page.locator(".panel")).toBeHidden();
});

test("freeze & plot saves an SVG of the current trails", async ({ page }) => {
    await page.goto("/#n=500");
    await page.waitForFunction(() => (window as any).wake);
    await page.waitForTimeout(1000);
    const download = page.waitForEvent("download");
    await page.click("#plot");
    const file = await download;
    const svg = await (await file.createReadStream()).toArray().then(c => Buffer.concat(c).toString());
    expect(svg).toContain("<svg");
    expect((svg.match(/<path /g) ?? []).length).toBeGreaterThan(100);
    await expect(page.locator(".toast")).toContainText("SVG saved");
});

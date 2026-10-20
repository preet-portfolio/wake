// The live view: alive within a second, a new design is one obvious action away,
// and the viewer's touch moves it. Runs on a real GPU.
import { test, expect, devices } from "@playwright/test";
import { changed, shot } from "./motion";

// a real GPU: since Playwright 1.5x the default headless shell renders in software
test.use({ channel: "chromium", launchOptions: { args: [] } });

test("visible motion within 1 second of opening, on every fresh visit", async ({ page }) => {
    // several fresh visits: the opening design is random, so check more than one
    for (let visit = 0; visit < 4; visit++) {
    await page.goto("about:blank");
    await page.goto("/");
    await page.waitForFunction(() => (window as any).wake);
    const a = await shot(page);
    await page.waitForTimeout(800);
    const b = await shot(page);
    expect(changed(a, b), `visit ${visit} (${await page.evaluate(() => (window as any).wake.state.species)}): share of pixels changed in the first second`).toBeGreaterThan(0.005);
    }
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
    // a spot clear of the ⓘ card (top left) and the tools (right edge)
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5);
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

test("the drawing fills the window, and controls step aside when you're just watching", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 820 });
    await page.goto("/");
    await page.waitForFunction(() => (window as any).wake);
    const box = (await page.locator("#art").boundingBox())!;
    expect(box.width).toBe(1440);
    expect(box.height).toBe(820);
    // visible on arrival, so people find them
    await expect(page.locator(".dock")).toHaveCSS("opacity", "1");
    // hidden after a while without movement...
    await page.waitForTimeout(6500);
    await expect(page.locator("body")).toHaveClass(/idle/);
    // ...and back on the first movement
    await page.mouse.move(200, 200);
    await expect(page.locator("body")).not.toHaveClass(/idle/);
    // ✦ new sits in a corner, not over the middle of the drawing
    const nb = (await page.locator("#new").boundingBox())!;
    expect(nb.x + nb.width).toBeLessThan(1440 * 0.3);
});

test("100 presses of ✦ new: never the same species twice in a row, and every species appears", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/?particles=500");
    await page.waitForFunction(() => (window as any).wake);
    const seen: string[] = [];
    for (let i = 0; i < 100; i++) {
        await page.evaluate(() => (window as any).wake.newDesign());
        seen.push(await page.evaluate(() => (window as any).wake.state.species));
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i], `press ${i}`).not.toBe(seen[i - 1]);
    const all = ["flow", "orbit", "flock", "grid", "waves", "pulse", "growth", "constellation", "ink", "lorenz", "pendulum", "threebody", "kuramoto", "chladni", "grayscott"];
    for (const k of all) expect(seen, `species ${k}`).toContain(k);
    const counts = Object.fromEntries(all.map(k => [k, seen.filter(s => s === k).length]));
    console.log("100 presses:", JSON.stringify(counts));
});

// A shared link is untrusted: it must not freeze the tab or put markup into the SVG.
import { test, expect } from "@playwright/test";

test("hostile link is clamped and escaped", async ({ page }) => {
    test.setTimeout(300_000); // the clamped worst case (20,000 × 600) renders slowly in software GL
    const evil = {
        v: 1, seed: "x", steps: 1e9,
        shape: { kind: "circle", n: 1e9, r: 400, cx: 500, cy: 500, rot: 0, sides: 1e6, la: 3, lb: 2, shuffle: 1e9, path: new Array(1e5).fill(1) },
        blocks: [{ k: "rotate", on: true, p: { a: { b: "1\"/><script>alert(1)</script>", t: ["sin", 1e9, 0] } } }, { k: "__proto__", p: {} }],
        mark: { skip: 5, detach: "yes", seglen: 1e9, segrot: 0 },
        style: { paper: "red;</style>", ink: "#000000", alpha: 1, width: "1\"><script>alert(1)</script>", hue: 0, palette: ["x", 1], blend: "lighter;", grain: 1e9 },
        design: "1; drop",
    };
    const b64 = Buffer.from(JSON.stringify(evil)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await page.goto(`/?instant#s=${b64}`);
    await page.waitForFunction(() => (window as any).wake);
    await page.evaluate(() => (window as any).wake.whenDone());
    // The clamps bound the work (≤ 20,000 points × 600 steps), so they are what's asserted.
    // A wall-clock limit would only measure how busy the test machine is.
    const s = await page.evaluate(() => (window as any).wake.state);
    expect(s.steps).toBe(600);
    expect(s.shape.n).toBe(20000);
    expect(s.shape.shuffle).toBe(200);
    expect(s.shape.path.length).toBeLessThanOrEqual(4000);
    expect(s.blocks.length).toBe(1);
    expect(s.style.paper).toBe("#f2eee4");
    expect(s.style.width).toBe(1.1);
    expect(s.mark.skip).toBe(0.95);
    expect(s.style.palette).toBeNull();
    expect(s.style.blend).toBe("over");
    expect(s.style.grain).toBe(1);
    expect(s.design).toBeUndefined();
    expect(s.blocks[0].p.a.t[2]).toBeGreaterThan(0);
    const svg: string = await page.evaluate(() => (window as any).wake.svg());
    expect(svg).not.toContain("<script");
});

test("a hostile Turing-pattern link can't ask the GPU for thousands of steps per frame", async ({ page }) => {
    const evil = { v: 1, species: "grayscott", sp: { iters: 10000, t: 99 }, live: { mode: "trails", trail: 1, speed: 4 } };
    const b64 = Buffer.from(JSON.stringify(evil)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await page.goto(`/?particles=500#s=${b64}`);
    await page.waitForFunction(() => (window as any).wake);
    // the page keeps answering: frames are being produced
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => (window as any).wake.fps())).toBeGreaterThan(0);
});

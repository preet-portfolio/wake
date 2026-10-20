// The science species in the browser: the GPU matches the CPU reference, every
// ⓘ card explains with an equation and a source, and the aha controls work.
import { test, expect } from "@playwright/test";
import { speciesOf } from "../src/design";
import { PRESETS, simulate } from "../src/science/grayscott";

// a real GPU: since Playwright 1.5x the default headless shell renders in software
test.use({ channel: "chromium", launchOptions: { args: [] } }); // a real GPU: float render targets

const firstOf = (kind: string) => { for (let n = 3; ; n += 5) if (speciesOf(n) === kind) return n; };

test("Gray-Scott on the GPU matches the CPU reference: same classes, near-identical fields", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/?still#n=1");
    await page.waitForFunction(() => (window as any).wake);
    const gpu = (p: { F: number; k: number }) => page.evaluate(([F, k]) => (window as any).wake.grayscott(F, k, 128, 6000), [p.F, p.k]);
    // Pearson correlation of the two v fields, from the same starting field
    const corr = (a: ArrayLike<number>, b: ArrayLike<number>) => {
        let ma = 0, mb = 0; const n = a.length;
        for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
        ma /= n; mb /= n;
        let ab = 0, aa = 0, bb = 0;
        for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; ab += x * y; aa += x * x; bb += y * y; }
        return ab / Math.sqrt(aa * bb || 1);
    };
    const spots = await gpu(PRESETS.spots), stripes = await gpu(PRESETS.stripes), fade = await gpu(PRESETS.fade);
    expect(spots.blobs).toBeGreaterThanOrEqual(15);
    expect(spots.largestShare).toBeLessThan(0.2);
    expect(stripes.largestShare).toBeGreaterThan(0.8);
    expect(fade.coverage).toBeLessThan(0.005);
    for (const [name, g] of [["spots", spots], ["stripes", stripes]] as const) {
        const cpu = simulate(PRESETS[name].F, PRESETS[name].k, 128, 6000).v;
        const c = corr(g.v, cpu);
        console.log(`Gray-Scott ${name}: GPU vs CPU field correlation ${c.toFixed(4)}`);
        expect(c, name).toBeGreaterThan(0.95);
    }
});

for (const kind of ["lorenz", "pendulum", "threebody", "kuramoto", "chladni", "grayscott"]) {
    test(`${kind}: a link opens with its ⓘ card: equation, one control, a dated source`, async ({ page }) => {
        await page.goto(`/#n=${firstOf(kind)}`);
        await page.waitForFunction(() => (window as any).wake);
        const card = page.locator(".card");
        await expect(card).toBeVisible();
        await expect(card.locator(".katex")).toHaveCount(1);
        await expect(card.locator(".aha input[type=range]")).toHaveCount(1);
        await expect(card.locator(".source")).toContainText(/1[6-9]\d\d|20\d\d/);
    });
}

test("fireflies: raising K past K_c = 1 switches synchrony on; lowering it switches it off", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(`/#n=${firstOf("kuramoto")}`);
    await page.waitForFunction(() => (window as any).wake);
    const slider = page.locator(".card .aha input");
    // synchrony takes simulated time, not wall time: poll the readout with a deadline
    const r = async () => parseFloat((await page.locator(".card .readout").textContent())!.match(/r = ([\d.]+)/)![1]);
    await slider.fill("2.2"); await slider.dispatchEvent("input");
    await expect.poll(r, { timeout: 30_000 }).toBeGreaterThan(0.5);
    await slider.fill("0.3"); await slider.dispatchEvent("input");
    await expect.poll(r, { timeout: 30_000 }).toBeLessThan(0.25);
});

test("Lorenz: the ρ control reads out chaos, transient chaos and no chaos at the right thresholds", async ({ page }) => {
    await page.goto(`/#n=${firstOf("lorenz")}`);
    await page.waitForFunction(() => (window as any).wake);
    const slider = page.locator(".card .aha input"), out = page.locator(".card .aha output");
    for (const [v, text] of [["28", "· chaos"], ["20", "transient chaos"], ["10", "no chaos"]]) {
        await slider.fill(v); await slider.dispatchEvent("input");
        await expect(out).toContainText(text);
    }
});

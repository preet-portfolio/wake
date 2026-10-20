// FPS at 20,000 segments per step under phone emulation (Pixel 7 viewport,
// DPR 2.6, 4x CPU throttle). This is an emulation, not a real phone: the
// numbers go to reports/fps.json and the real-phone check uses ?fps on device.
import { test, devices } from "@playwright/test";
import fs from "node:fs";
import { blk, st } from "./helpers";
import { encode } from "../src/state";

const heavy = st({
    steps: 100000,
    shape: { kind: "circle", n: 20000, r: 420, cx: 500, cy: 500, rot: 0, sides: 5, la: 3, lb: 2, shuffle: 0 },
    blocks: [blk("delay", { span: 80 }), blk("scale", { s: -0.05 }), blk("rotate", { a: 0.3, ox: 380 }), blk("wave", { a: 0.4, f: 9 })],
    style: { paper: "#f2eee4", ink: "#1c1b18", alpha: 0.06, width: 1, hue: 0 },
});

const results: Record<string, unknown> = {};
const { defaultBrowserType, ...pixel } = devices["Pixel 7"];
void defaultBrowserType;

for (const [gpu, args] of [["gpu", []], ["software-gl", ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]]] as const) {
    for (const throttle of [1, 4]) {
        test(`fps · ${gpu} · cpu ÷${throttle}`, async ({ playwright }) => {
            const browser = await playwright.chromium.launch({ args: [...args] });
            const ctx = await browser.newContext({ ...pixel });
            const page = await ctx.newPage();
            const cdp = await ctx.newCDPSession(page);
            await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
            await page.goto(`/?fps#s=${encode(heavy)}`);
            await page.waitForFunction(() => (window as any).wake);
            await page.waitForTimeout(2500);
            const samples: number[] = [];
            for (let i = 0; i < 5; i++) {
                await page.waitForTimeout(1000);
                samples.push(await page.evaluate(() => (window as any).wake.fps()));
            }
            const renderer = await page.evaluate(() => {
                const gl = document.createElement("canvas").getContext("webgl2")!;
                const ext = gl.getExtension("WEBGL_debug_renderer_info");
                return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
            });
            const segs = await page.evaluate(() => (window as any).wake.state.shape.n);
            results[`${gpu} · cpu ÷${throttle}`] = { samples, median: samples.sort((a, b) => a - b)[2], segmentsPerStep: segs, renderer };
            await browser.close();
        });
    }
}

test.afterAll(() => {
    fs.mkdirSync("reports", { recursive: true });
    fs.writeFileSync("reports/fps.json", JSON.stringify({ device: "Pixel 7 emulation (412x915 @2.625x, capped to 2x in app)", note: "emulated, not a real phone", results }, null, 1));
});

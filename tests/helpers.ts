import type { Page } from "@playwright/test";
import { defaultState, newBlock, type Block, type BlockKind, type State } from "../src/model";
import { encode } from "../src/state";
import { designFor } from "../src/design";

export function blk(k: BlockKind, p: Record<string, number> = {}, mods: Partial<Block["p"]> = {}): Block {
    const b = newBlock(k);
    for (const [name, v] of Object.entries(p)) b.p[name].b = v;
    for (const [name, m] of Object.entries(mods)) Object.assign(b.p[name], m);
    return b;
}

export function st(patch: Partial<State>): State {
    return { ...defaultState(), ...patch };
}

/** Load a state with instant rendering and wait until it is fully drawn. */
export async function show(page: Page, s: State, extra = "instant") {
    await page.goto(`/?${extra}#s=${encode(s)}`);
    await page.waitForFunction(() => (window as any).wake);
    await page.evaluate(() => (window as any).wake.whenDone());
}

/** The block-stack cases shown on the regression sheet. */
export const CASES: [string, State][] = [
    ["default", st({})],
    ["wave → swirl", st({ steps: 60, blocks: [blk("wave", { a: 6, f: 7 }), blk("swirl", { k: 8 }), blk("scale", { s: -1.5 })] })],
    ["swirl → wave", st({ steps: 60, blocks: [blk("scale", { s: -1.5 }), blk("swirl", { k: 8 }), blk("wave", { a: 6, f: 7 })] })],
    ["rotate", st({ blocks: [blk("rotate", { a: 1.5, ox: 360, oy: 420 })] })],
    ["scale (sy 0.4)", st({ blocks: [blk("scale", { s: -1.5, sy: 0.4 })] })],
    ["move", st({ blocks: [blk("scale", { s: -1 }), blk("move", { dx: 2, dy: 3 })] })],
    ["wave", st({ blocks: [blk("scale", { s: -1.4 }), blk("wave", { a: 3, f: 9 })] })],
    ["jitter", st({ blocks: [blk("jitter", { a: 3 }), blk("scale", { s: -1.4 })] })],
    ["swirl", st({ blocks: [blk("scale", { s: -1.2 }), blk("swirl", { k: 6 })] })],
    ["attract", st({ blocks: [blk("attract", { k: 2, x: 700, y: 300 })] })],
    ["delay −", st({ blocks: [blk("delay", { span: -80 }), blk("scale", { s: -2 }), blk("rotate", { a: 1 })] })],
    ["rotate ∿ time", st({ blocks: [blk("scale", { s: -1.6 }), blk("rotate", { a: 3, ox: 400 }, { a: { b: 3, t: ["sin", 1, 40] } })] })],
    ["scale ∿ along", st({ blocks: [blk("scale", { s: -2 }, { s: { b: -2, u: ["sin", 0.9, 1] } })] })],
    ["delay ∿ noise", st({ blocks: [blk("delay", { span: 90 }, { span: { b: 90, u: ["noise", 1, 0.2] } }), blk("scale", { s: -2 })] })],
    ["polygon", st({ shape: { ...defaultState().shape, kind: "polygon", sides: 5 } })],
    ["lissajous", st({ shape: { ...defaultState().shape, kind: "lissajous", r: 330 }, blocks: [blk("scale", { s: -1.2 }), blk("rotate", { a: 0.8 })] })],
    ["line", st({ shape: { ...defaultState().shape, kind: "line" }, blocks: [blk("rotate", { a: 1.6 }), blk("move", { dy: 1.5 })] })],
    ["separate strokes", st({ mark: { skip: 0, detach: true, seglen: 300, segrot: 70 }, blocks: [blk("scale", { s: -2.5 })] })],
    ["gaps + tangle", st({ mark: { skip: 0.5, detach: false, seglen: 100, segrot: 0 }, shape: { ...defaultState().shape, shuffle: 12 }, blocks: [blk("scale", { s: -1.5 })] })],
    ["ink on dark", st({ style: { ...defaultState().style, paper: "#1c1b18", paper2: "#1c1b18", ink: "#f2eee4", alpha: 0.5, width: 0.8, hue: 2 } })],
    ["No. 808 colour", designFor(808)],
    ["No. 3333 colour", designFor(3333)],
    ["No. 7777 colour", designFor(7777)],
    ["No. 4444 multiply", designFor(4444)],
    ["No. 500 ink", designFor(500)],
];

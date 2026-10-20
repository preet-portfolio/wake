// The wake model: a seed shape, an ordered stack of blocks, a clock, a mark
// and a style. Everything here is plain data so it can live in the URL.

export type SignalKind = "none" | "lin" | "sin" | "fade" | "noise";

/** A modulation: kind, amount, period. */
export type Signal = [SignalKind, number, number];

/** A numeric parameter: a base value, optionally modulated over time (t) and along the line (u). */
export interface Param {
    b: number;
    t?: Signal;
    u?: Signal;
}

export type BlockKind = "rotate" | "scale" | "move" | "wave" | "jitter" | "swirl" | "attract" | "delay";

export interface Block {
    k: BlockKind;
    on: boolean;
    p: Record<string, Param>;
}

export type SeedKind = "circle" | "polygon" | "line" | "lissajous" | "drawn";

export interface Seed {
    kind: SeedKind;
    n: number;          // points
    r: number;          // radius / half-length, world units
    cx: number;         // centre, world units (0..1000)
    cy: number;
    rot: number;        // initial rotation, degrees
    sides: number;      // polygon
    la: number;         // lissajous frequency a
    lb: number;         // lissajous frequency b
    shuffle: number;    // random point swaps
    path?: number[];    // drawn: flat [x0,y0,x1,y1,...] in world units
}

export interface Mark {
    skip: number;       // chance a segment is not drawn
    detach: boolean;    // draw segments as separate strokes
    seglen: number;     // detached: length in % of nominal
    segrot: number;     // detached: rotation in degrees
}

export interface Style {
    paper: string;
    ink: string;
    alpha: number;
    width: number;      // world units
    hue: number;        // hue shift per step, degrees
}

export interface State {
    v: 1;
    seed: number;
    steps: number;
    shape: Seed;
    blocks: Block[];
    mark: Mark;
    style: Style;
}

export const WORLD = 1000;

/** Parameter metadata for the UI: [label, min, max, step, default]. The first entry is the block's main knob. */
export type ParamSpec = [string, string, number, number, number, number];

export const BLOCKS: Record<BlockKind, { label: string; hint: string; params: ParamSpec[] }> = {
    rotate: {
        label: "rotate", hint: "turn around an origin, every step",
        params: [["a", "degrees / step", -6, 6, 0.01, 0.8], ["ox", "origin x", 0, WORLD, 1, 500], ["oy", "origin y", 0, WORLD, 1, 500]],
    },
    scale: {
        label: "scale", hint: "grow or shrink toward an origin, every step",
        params: [["s", "% / step", -6, 6, 0.01, -1.6], ["sy", "y vs x", 0, 2, 0.01, 1], ["ox", "origin x", 0, WORLD, 1, 500], ["oy", "origin y", 0, WORLD, 1, 500]],
    },
    move: {
        label: "move", hint: "drift, every step",
        params: [["dx", "x / step", -10, 10, 0.05, 0], ["dy", "y / step", -10, 10, 0.05, 1]],
    },
    wave: {
        label: "wave", hint: "push sideways in waves along the line",
        params: [["a", "amplitude", 0, 10, 0.05, 1.5], ["f", "waves around", 0, 60, 1, 6], ["dir", "angle °", 0, 180, 1, 0]],
    },
    jitter: {
        label: "jitter", hint: "random nudge, every step",
        params: [["a", "amount", 0, 10, 0.05, 0.6]],
    },
    swirl: {
        label: "swirl", hint: "turn faster near the origin",
        params: [["k", "strength", -10, 10, 0.05, 2], ["ox", "origin x", 0, WORLD, 1, 500], ["oy", "origin y", 0, WORLD, 1, 500]],
    },
    attract: {
        label: "attract", hint: "pull toward a point",
        params: [["k", "% / step", -5, 5, 0.01, 0.8], ["x", "x", 0, WORLD, 1, 500], ["y", "y", 0, WORLD, 1, 500]],
    },
    delay: {
        label: "delay", hint: "each point starts later than the one before it",
        params: [["span", "steps", -400, 400, 1, 60], ["shift", "start at", 0, 1, 0.01, 0]],
    },
};

export function newBlock(k: BlockKind): Block {
    const p: Record<string, Param> = {};
    for (const [name, , , , , def] of BLOCKS[k].params) p[name] = { b: def };
    return { k, on: true, p };
}

export function defaultState(): State {
    const rotate = newBlock("rotate");
    rotate.p.ox.b = 380;
    rotate.p.a.b = 1.1;
    const scale = newBlock("scale");
    scale.p.s.b = -2.2;
    const delay = newBlock("delay");
    delay.p.span.b = 60;
    return {
        v: 1,
        seed: 4,
        steps: 54,
        shape: { kind: "circle", n: 600, r: 400, cx: 500, cy: 500, rot: 0, sides: 5, la: 3, lb: 2, shuffle: 0 },
        blocks: [delay, scale, rotate],
        mark: { skip: 0, detach: false, seglen: 100, segrot: 0 },
        style: { paper: "#f2eee4", ink: "#1c1b18", alpha: 0.9, width: 1.1, hue: 0 },
    };
}

/** Evaluate a signal at x (time in steps, or position along the line in 0..1). */
export function signal(s: Signal | undefined, x: number, seed: number, noise: (seed: number, x: number) => number): number {
    if (!s || s[0] === "none") return 0;
    const [kind, amt, per] = s;
    const p = per || 1;
    switch (kind) {
        case "lin": return amt * x / p;
        case "sin": return amt * Math.sin(2 * Math.PI * x / p);
        case "fade": return -Math.min(Math.max(x / p, 0), 1) * amt;
        case "noise": return amt * noise(seed, x / p);
    }
    return 0;
}

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

export type Blend = "over" | "add" | "multiply" | "screen";

/** Cosine palette (Inigo Quilez): colour(x) = a + b·cos(2π(c·x + d)), each a vec3. */
export type Palette = [number, number, number, number, number, number, number, number, number, number, number, number];

export interface Style {
    paper: string;
    paper2: string;     // background gradient: centre = paper, edge = paper2
    grain: number;      // background film grain, 0..1
    ink: string;        // single colour, used when palette is null
    palette: Palette | null;
    spread: number;     // palette cycles along the line
    cycle: number;      // palette cycles over the whole drawing's time
    shift: number;      // palette phase, 0..1
    blend: Blend;
    soft: number;       // glow: soft line edges, 0..1
    alpha: number;
    width: number;      // world units
    hue: number;        // hue shift per step, degrees (single colour only)
}

/** Hand-tuned palettes for the colour designs and the swatch row. */
export const PALETTES: Record<string, Palette> = {
    ember:    [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1.0, 1.0, 1.0, 0.0, 0.10, 0.20],
    aurora:   [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1.0, 1.0, 0.5, 0.80, 0.90, 0.30],
    lagoon:   [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1.0, 0.7, 0.4, 0.0, 0.15, 0.20],
    iris:     [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 2.0, 1.0, 0.0, 0.50, 0.20, 0.25],
    sorbet:   [0.8, 0.5, 0.4, 0.2, 0.4, 0.2, 2.0, 1.0, 1.0, 0.0, 0.25, 0.25],
    prism:    [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1.0, 1.0, 1.0, 0.0, 0.33, 0.67],
    gold:     [0.6, 0.45, 0.2, 0.4, 0.3, 0.15, 1.0, 1.0, 1.0, 0.0, 0.05, 0.10],
    glacier:  [0.55, 0.7, 0.85, 0.35, 0.3, 0.2, 1.0, 1.0, 1.0, 0.55, 0.55, 0.55],
    orchid:   [0.6, 0.4, 0.8, 0.4, 0.35, 0.3, 1.0, 1.0, 1.0, 0.85, 0.0, 0.6],
    neon:     [0.5, 0.5, 0.5, 0.6, 0.6, 0.6, 1.0, 1.0, 1.0, 0.30, 0.20, 0.20],
    moss:     [0.45, 0.6, 0.3, 0.35, 0.3, 0.25, 1.0, 1.0, 1.0, 0.15, 0.25, 0.4],
    dusk:     [0.5, 0.4, 0.6, 0.5, 0.3, 0.4, 1.0, 1.0, 1.0, 0.95, 0.75, 0.55],
};

export interface State {
    v: 1;
    /** the collection number this state was generated from, if any */
    design?: number;
    seed: number;
    steps: number;
    shape: Seed;
    blocks: Block[];
    mark: Mark;
    style: Style;
}

export const WORLD = 1000;

/** The numbered collection: every number from 1 to DESIGNS is one fixed design. */
export const DESIGNS = 100_000;

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

export function defaultStyle(): Style {
    return {
        paper: "#f2eee4", paper2: "#f2eee4", grain: 0, ink: "#1c1b18",
        palette: null, spread: 1, cycle: 0, shift: 0,
        blend: "over", soft: 0, alpha: 0.9, width: 1.1, hue: 0,
    };
}

export function paletteRgb(p: Palette, x: number): [number, number, number] {
    const ch = (k: number) => Math.min(1, Math.max(0, p[k] + p[k + 3] * Math.cos(2 * Math.PI * (p[k + 6] * x + p[k + 9]))));
    return [ch(0), ch(1), ch(2)];
}

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
        style: defaultStyle(),
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

// The engine: a pure, deterministic step function. Each step marks segments
// between born neighbours, then runs the block stack on every born point.
// The renderer, the SVG export and the plot budget all use this.
import { makeRng, type Rng } from "./rng";
import { delays, stepPoint } from "./field";
import type { Seed, State } from "./model";

const DEG = Math.PI / 180;

/** Floats per segment in Engine.segs: x0, y0, x1, y1, u (position along the line, 0..1). */
export const SEG = 5;

export function seedPoints(s: Seed, rng: Rng): { pts: Float64Array; closed: boolean } {
    const n = Math.max(2, Math.round(s.n));
    const pts = new Float64Array(n * 2);
    let closed = true;
    const put = (i: number, x: number, y: number) => { pts[2 * i] = x; pts[2 * i + 1] = y; };

    if (s.kind === "circle") {
        for (let i = 0; i < n; i++) {
            const a = (i / n) * 2 * Math.PI;
            put(i, s.cx + s.r * Math.cos(a), s.cy + s.r * Math.sin(a));
        }
    } else if (s.kind === "polygon") {
        const k = Math.max(3, Math.round(s.sides));
        for (let i = 0; i < n; i++) {
            const f = (i / n) * k;
            const side = Math.floor(f);
            const t = f - side;
            const a0 = (side / k) * 2 * Math.PI - Math.PI / 2;
            const a1 = ((side + 1) / k) * 2 * Math.PI - Math.PI / 2;
            put(i,
                s.cx + s.r * ((1 - t) * Math.cos(a0) + t * Math.cos(a1)),
                s.cy + s.r * ((1 - t) * Math.sin(a0) + t * Math.sin(a1)));
        }
    } else if (s.kind === "lissajous") {
        for (let i = 0; i < n; i++) {
            const a = (i / n) * 2 * Math.PI;
            put(i, s.cx + s.r * Math.sin(s.la * a + Math.PI / 2), s.cy + s.r * Math.sin(s.lb * a));
        }
    } else if (s.kind === "drawn" && s.path && s.path.length >= 4) {
        closed = false;
        resample(s.path, n, pts);
    } else {
        closed = false;
        for (let i = 0; i < n; i++) put(i, s.cx - s.r + (2 * s.r * i) / (n - 1), s.cy);
    }

    if (s.rot) {
        const c = Math.cos(s.rot * DEG), sn = Math.sin(s.rot * DEG);
        for (let i = 0; i < n; i++) {
            const x = pts[2 * i] - s.cx, y = pts[2 * i + 1] - s.cy;
            put(i, s.cx + x * c - y * sn, s.cy + x * sn + y * c);
        }
    }
    for (let k = 0; k < s.shuffle; k++) {
        const i = Math.floor(rng() * n), j = Math.floor(rng() * n);
        const x = pts[2 * i], y = pts[2 * i + 1];
        put(i, pts[2 * j], pts[2 * j + 1]);
        put(j, x, y);
    }
    return { pts, closed };
}

// resample a polyline to n points evenly spaced by arc length
function resample(path: number[], n: number, out: Float64Array) {
    const m = path.length / 2;
    const cum = [0];
    for (let i = 1; i < m; i++) cum.push(cum[i - 1] + Math.hypot(path[2 * i] - path[2 * i - 2], path[2 * i + 1] - path[2 * i - 1]));
    const total = cum[m - 1] || 1;
    let j = 1;
    for (let i = 0; i < n; i++) {
        const d = (i / (n - 1)) * total;
        while (j < m - 1 && cum[j] < d) j++;
        const seg = cum[j] - cum[j - 1] || 1;
        const t = Math.min(1, Math.max(0, (d - cum[j - 1]) / seg));
        out[2 * i] = path[2 * j - 2] + t * (path[2 * j] - path[2 * j - 2]);
        out[2 * i + 1] = path[2 * j - 1] + t * (path[2 * j + 1] - path[2 * j - 1]);
    }
}

export class Engine {
    readonly state: State;
    n = 0;
    pts: Float64Array;
    closed: boolean;
    /** segments from the last step: SEG floats each */
    segs: Float32Array;
    count = 0;
    private rng: Rng;
    private delay: Float64Array;
    private tmp = new Float64Array(2);
    private born: Uint8Array;

    constructor(state: State) {
        this.state = state;
        this.rng = makeRng(state.seed);
        const { pts, closed } = seedPoints(state.shape, this.rng);
        this.pts = pts;
        this.closed = closed;
        const n = pts.length / 2;
        this.segs = new Float32Array(n * SEG * 2);
        this.born = new Uint8Array(n);
        this.delay = new Float64Array(n);
        this.delay = delays(state.blocks, n, state.seed);
    }

    get done() { return this.n > this.state.steps; }

    /** Run one step: mark segments, then move points. Returns the number of segments. */
    step(): number {
        const { pts, born, delay, state, rng } = this;
        const { mark } = state;
        const n = pts.length / 2;
        const t = this.n;
        let c = 0;

        for (let i = 0; i < n; i++) born[i] = t - delay[i] >= 0 ? 1 : 0;

        const emit = (i: number, j: number) => {
            if (!born[i] || !born[j]) return;
            if (mark.skip > 0 && rng() < mark.skip) return;
            let x0 = pts[2 * i], y0 = pts[2 * i + 1], x1 = pts[2 * j], y1 = pts[2 * j + 1];
            if (mark.detach) {
                const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
                const l = mark.seglen / 100, a = mark.segrot * DEG, ca = Math.cos(a), sa = Math.sin(a);
                const hx = ((x1 - x0) / 2) * l, hy = ((y1 - y0) / 2) * l;
                const rx = hx * ca - hy * sa, ry = hx * sa + hy * ca;
                x0 = mx - rx; y0 = my - ry; x1 = mx + rx; y1 = my + ry;
            }
            const o = c * SEG;
            this.segs[o] = x0; this.segs[o + 1] = y0; this.segs[o + 2] = x1; this.segs[o + 3] = y1;
            this.segs[o + 4] = i / n;
            c++;
        };
        for (let i = 1; i < n; i++) emit(i - 1, i);
        if (this.closed) emit(n - 1, 0);
        this.count = c;

        const out = this.tmp;
        for (let i = 0; i < n; i++) {
            if (!born[i]) continue;
            stepPoint(state.blocks, pts[2 * i], pts[2 * i + 1], t - delay[i], i / n, state.seed, rng, out);
            pts[2 * i] = out[0]; pts[2 * i + 1] = out[1];
        }
        this.n++;
        return c;
    }
}

/** Run a whole drawing, calling back with each step's segments. */
export function runAll(state: State, each: (segs: Float32Array, count: number, step: number) => void) {
    const e = new Engine(state);
    while (!e.done) {
        const step = e.n;
        const c = e.step();
        each(e.segs, c, step);
    }
}

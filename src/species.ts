// Species: distinct behaviours for the live simulation, each with its own
// motion, mark and tempo. "flow" and "ink" use the block stack (see sim.ts);
// the others are written here. Each works on the Sim's shared arrays
// (x, y, px, py for every line-head) so the renderer, motion census and plot
// export treat them all the same.
//
// References: orbit (Kepler-like orbits), flock (Craig Reynolds, "Flocks, herds
// and schools", SIGGRAPH 1987), waves (Bridget Riley's wave paintings),
// grid (Agnes Martin's ruled grids), growth (branching growth), pulse
// (expanding rings), constellation (drifting stars joined to near neighbours).
import { noise2, type Rng } from "./rng";
import type { Sim } from "./sim";

export type SpeciesKind = "flow" | "orbit" | "flock" | "waves" | "grid" | "growth" | "pulse" | "constellation" | "ink";

export const SPECIES_INFO: Record<SpeciesKind, { name: string; hint: string }> = {
    flow: { name: "flow", hint: "line-heads drifting through a swirling field" },
    orbit: { name: "orbit", hint: "points circling one or more centres, inner ones faster" },
    flock: { name: "flock", hint: "a murmuration: separation, alignment, cohesion" },
    waves: { name: "waves", hint: "stacked lines rippling in phase" },
    grid: { name: "grid", hint: "quiet ruled lines that barely tremble" },
    growth: { name: "growth", hint: "tips that wander and branch" },
    pulse: { name: "pulse", hint: "rings breathing out from a centre" },
    constellation: { name: "constellation", hint: "drifting stars joined to their neighbours" },
    ink: { name: "ink", hint: "the plotter drawing, replayed" },
};

/** Controls shown in the panel for each behaviour species: [key, label, min, max, step]. */
export const SPECIES_PARAMS: Partial<Record<SpeciesKind, [string, string, number, number, number][]>> = {
    orbit: [["spin", "spin", -3, 3, 0.01], ["rmin", "inner radius", 1, 600, 1], ["rmax", "outer radius", 50, 900, 1], ["ecc", "wobble", 0, 0.5, 0.01], ["lobes", "lobes", 1, 8, 1], ["flat", "flatten", 0.3, 1, 0.01], ["mark", "dots · dashes", 0, 1, 1]],
    flock: [["speed", "speed", 0.2, 8, 0.05], ["view", "sight", 8, 120, 1], ["sep", "personal space", 1, 60, 1], ["align", "alignment", 0, 0.3, 0.005], ["cohere", "cohesion", 0, 0.02, 0.0005], ["separate", "separation", 0, 0.3, 0.005], ["wander", "wander", 0, 1, 0.01]],
    waves: [["rows", "rows", 2, 120, 1], ["amp", "amplitude", 0, 150, 1], ["freq", "waves across", 0.2, 12, 0.05], ["tempo", "tempo", 0, 0.02, 0.0005], ["phase", "row shift", 0, 2, 0.01], ["amp2", "ripple", 0, 40, 1]],
    grid: [["rows", "rows", 2, 120, 1], ["margin", "margin", 0, 0.3, 0.01], ["tremble", "tremble", 0, 6, 0.05], ["drift", "drift", 0, 0.02, 0.0005], ["cross", "verticals", 0, 1, 1]],
    growth: [["seeds", "seeds", 1, 12, 1], ["from", "from: edge · centre · ring", 0, 2, 1], ["len", "step", 0.5, 6, 0.05], ["turn", "bend", 0, 1, 0.01], ["split", "branching", 0, 0.05, 0.0005], ["depth", "depth", 1, 14, 1], ["spread", "spread", 0, 1.5, 0.01]],
    pulse: [["rings", "rings", 1, 60, 1], ["rmax", "reach", 50, 1200, 1], ["speed", "speed", 0.05, 10, 0.05], ["wobble", "wobble", 0, 0.5, 0.01], ["lobes", "lobes", 1, 8, 1]],
    constellation: [["stars", "stars", 20, 800, 1], ["reach", "reach", 10, 250, 1], ["drift", "drift", 0, 5, 0.01]],
};

/** Species implemented here (the rest run the block stack). */
export const BEHAVIOURS = new Set<SpeciesKind>(["orbit", "flock", "waves", "grid", "growth", "pulse", "constellation"]);

export interface Bounds { x0: number; x1: number; y0: number; y1: number }

export interface Behaviour {
    /** how many line-heads it wants, given what the device can carry */
    count(available: number, sp: Record<string, number>): number;
    init(sim: Sim, r: Rng): void;
    step(sim: Sim, r: Rng): void;
}

const P = (sim: Sim, k: string, d: number) => sim.state.sp?.[k] ?? d;
/** A species parameter clamped to a sane range (links are untrusted). */
const Q = (sim: Sim, k: string, d: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, P(sim, k, d)));
const TAU = Math.PI * 2;

// ---------- orbit ----------
const orbit: Behaviour = {
    // fewer, larger bodies read as orbiting points instead of a solid ring
    count: a => Math.min(a, 1400),
    init(sim, r) {
        const k = Math.round(Q(sim, "centres", 1, 1, 4));
        const rmin = Q(sim, "rmin", 40, 1, 600), rmax = Q(sim, "rmax", 380, rmin + 1, 900);
        sim.extra = { k, r: new Float32Array(sim.n), th: new Float32Array(sim.n), w: new Float32Array(sim.n), c: new Uint8Array(sim.n) };
        const e = sim.extra;
        for (let i = 0; i < sim.n; i++) {
            e.c[i] = i % k;
            e.r[i] = rmin + (rmax - rmin) * Math.sqrt(r());
            e.th[i] = r() * TAU;
            // inner orbits faster (Kepler: ω ∝ r^-1.5), direction per centre
            e.w[i] = P(sim, "spin", 1) * Math.pow(150 / e.r[i], 1.5) * (e.c[i] % 2 ? -1 : 1) * (0.85 + 0.3 * r()) * (Math.PI / 180);
            sim.u[i] = (e.r[i] - rmin) / (rmax - rmin);
        }
        place(sim, i => orbitPos(sim, i));
    },
    step(sim) {
        const e = sim.extra;
        for (let i = 0; i < sim.n; i++) e.th[i] += e.w[i];
        move(sim, i => orbitPos(sim, i));
        const dots = P(sim, "mark", 0) < 0.5;
        for (let i = 0; i < sim.n; i++) dots ? sim.emit(sim.x[i], sim.y[i], sim.x[i] + 0.01, sim.y[i], sim.u[i]) : sim.emit(sim.px[i], sim.py[i], sim.x[i], sim.y[i], sim.u[i]);
    },
};
function orbitPos(sim: Sim, i: number): [number, number] {
    const e = sim.extra, j = e.c[i];
    const cx = P(sim, `cx${j}`, 500), cy = P(sim, `cy${j}`, 500);
    const rr = e.r[i] * (1 + P(sim, "ecc", 0) * Math.sin(e.th[i] * P(sim, "lobes", 2) + j));
    return [cx + rr * Math.cos(e.th[i]), cy + rr * Math.sin(e.th[i]) * P(sim, "flat", 1)];
}

// ---------- flock (Boids) ----------
const flock: Behaviour = {
    count: a => Math.min(a, 3000),
    init(sim, r) {
        const b = sim.bounds;
        for (let i = 0; i < sim.n; i++) {
            sim.x[i] = sim.px[i] = b.x0 + r() * (b.x1 - b.x0);
            sim.y[i] = sim.py[i] = b.y0 + r() * (b.y1 - b.y0);
            const a = r() * TAU, s = P(sim, "speed", 2.5);
            sim.vx[i] = Math.cos(a) * s; sim.vy[i] = Math.sin(a) * s;
        }
        sim.extra = { grid: new Map<number, number[]>() };
    },
    step(sim, r) {
        const { n, x, y, vx, vy, bounds: b } = sim;
        const R = Q(sim, "view", 40, 8, 120), sep = Q(sim, "sep", 12, 1, 60), max = Q(sim, "speed", 2.5, 0.2, 8);
        const wa = P(sim, "align", 0.05), wc = P(sim, "cohere", 0.005), ws = P(sim, "separate", 0.08), wander = P(sim, "wander", 0.15);
        // spatial hash so each boid only looks at nearby cells
        const grid: Map<number, number[]> = sim.extra.grid;
        grid.clear();
        const key = (gx: number, gy: number) => gx * 73856093 ^ gy * 19349663;
        for (let i = 0; i < n; i++) {
            const k = key(Math.floor(x[i] / R), Math.floor(y[i] / R));
            let c = grid.get(k); if (!c) grid.set(k, (c = [])); c.push(i);
        }
        for (let i = 0; i < n; i++) {
            let ax = 0, ay = 0, cx = 0, cy = 0, sx = 0, sy = 0, m = 0;
            const gx = Math.floor(x[i] / R), gy = Math.floor(y[i] / R);
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                const c = grid.get(key(gx + dx, gy + dy)); if (!c) continue;
                for (const j of c) {
                    if (j === i) continue;
                    const ex = x[j] - x[i], ey = y[j] - y[i], d2 = ex * ex + ey * ey;
                    if (d2 > R * R) continue;
                    ax += vx[j]; ay += vy[j]; cx += x[j]; cy += y[j]; m++;
                    if (d2 < sep * sep) { const d = Math.sqrt(d2) + 0.01; sx -= ex / d; sy -= ey / d; }
                }
            }
            if (m) {
                vx[i] += (ax / m - vx[i]) * wa + (cx / m - x[i]) * wc;
                vy[i] += (ay / m - vy[i]) * wa + (cy / m - y[i]) * wc;
            }
            vx[i] += sx * ws + (r() - 0.5) * wander;
            vy[i] += sy * ws + (r() - 0.5) * wander;
            sim.pointerForce(i, x[i], y[i]);
            const s = Math.hypot(vx[i], vy[i]) || 1;
            const lim = Math.min(Math.max(s, max * 0.5), max * 1.6) / s;
            vx[i] *= lim; vy[i] *= lim;
        }
        const w = b.x1 - b.x0, h = b.y1 - b.y0;
        for (let i = 0; i < n; i++) {
            sim.px[i] = x[i]; sim.py[i] = y[i];
            x[i] += vx[i]; y[i] += vy[i];
            let wrapped = false;
            if (x[i] < b.x0) { x[i] += w; wrapped = true; } else if (x[i] > b.x1) { x[i] -= w; wrapped = true; }
            if (y[i] < b.y0) { y[i] += h; wrapped = true; } else if (y[i] > b.y1) { y[i] -= h; wrapped = true; }
            if (wrapped) { sim.px[i] = x[i]; sim.py[i] = y[i]; continue; }
            sim.u[i] = (Math.atan2(vy[i], vx[i]) / TAU + 1) % 1; // colour by heading
            sim.emit(sim.px[i], sim.py[i], x[i], y[i], sim.u[i]);
        }
    },
};

// ---------- rows: waves (Riley) and grid (Martin) ----------
function rows(kind: "waves" | "grid"): Behaviour {
    return {
        count: a => Math.min(a, 12000),
        init(sim) {
            const R = Math.round(Q(sim, "rows", 30, 2, 200));
            const C = Math.max(16, Math.floor(sim.n / R));
            sim.extra = { R, C };
            for (let i = 0; i < sim.n; i++) sim.u[i] = Math.floor(i / C) / R;
            place(sim, i => rowPos(sim, i, kind));
        },
        step(sim) {
            move(sim, i => rowPos(sim, i, kind));
            const { R, C } = sim.extra;
            for (let r = 0; r < R; r++) for (let c = 1; c < C; c++) {
                const i = r * C + c; if (i >= sim.n) break;
                sim.emit(sim.x[i - 1], sim.y[i - 1], sim.x[i], sim.y[i], sim.u[i]);
            }
            if (kind === "grid" && P(sim, "cross", 0) > 0.5) {
                // Martin's grids: verticals as well, from the same points
                for (let c = 0; c < C; c += Math.max(1, Math.round(C / R))) for (let r = 1; r < R; r++) {
                    const i = r * C + c, j = (r - 1) * C + c; if (i >= sim.n) break;
                    sim.emit(sim.x[j], sim.y[j], sim.x[i], sim.y[i], sim.u[i]);
                }
            }
        },
    };
}
function rowPos(sim: Sim, i: number, kind: "waves" | "grid"): [number, number] {
    const { R, C } = sim.extra, b = sim.bounds, t = sim.frame;
    const r = Math.floor(i / C), c = i % C;
    const margin = kind === "grid" ? P(sim, "margin", 0.12) : -0.05;
    const x = b.x0 + (b.x1 - b.x0) * (margin + (1 - 2 * margin) * (c / (C - 1)));
    const y0 = b.y0 + (b.y1 - b.y0) * (margin + (1 - 2 * margin) * ((r + 0.5) / R));
    if (kind === "grid") {
        // barely trembling, like a hand-ruled pencil line
        const a = P(sim, "tremble", 1.2);
        return [x, y0 + a * noise2(sim.state.seed, x * 0.01 + r * 7.1, t * P(sim, "drift", 0.002))];
    }
    const amp = P(sim, "amp", 40) * (0.35 + 0.65 * Math.sin(Math.PI * (r + 0.5) / R)); // swell in the middle rows
    const ph = TAU * (P(sim, "freq", 3) * (x / 1000) + P(sim, "tempo", 0.004) * t) + P(sim, "phase", 0.35) * r;
    return [x, y0 + amp * Math.sin(ph) + P(sim, "amp2", 0) * Math.sin(ph * 2.3 + r)];
}

// ---------- growth ----------
const growth: Behaviour = {
    // a readable tree has hundreds of tips, not thousands
    count: a => Math.min(a, 900),
    init(sim, r) {
        sim.extra = { ang: new Float32Array(sim.n), depth: new Uint8Array(sim.n), alive: new Uint8Array(sim.n), active: 0 };
        seedGrowth(sim, r);
    },
    step(sim, r) {
        const e = sim.extra, b = sim.bounds;
        const len = P(sim, "len", 2.2), turn = P(sim, "turn", 0.25), split = P(sim, "split", 0.012), maxDepth = P(sim, "depth", 9);
        const born: number[] = [];
        let alive = 0;
        for (let i = 0; i < e.active; i++) {
            if (!e.alive[i]) continue;
            alive++;
            // branches bend slowly: low-frequency noise, a small turn per step
            e.ang[i] += noise2(sim.state.seed + (i % 97), sim.frame * 0.006, i * 0.37) * turn * 0.12;
            sim.px[i] = sim.x[i]; sim.py[i] = sim.y[i];
            sim.x[i] += Math.cos(e.ang[i]) * len + sim.vx[i];
            sim.y[i] += Math.sin(e.ang[i]) * len + sim.vy[i];
            sim.vx[i] *= 0.9; sim.vy[i] *= 0.9;
            sim.pointerForce(i, sim.x[i], sim.y[i]);
            sim.emit(sim.px[i], sim.py[i], sim.x[i], sim.y[i], e.depth[i] / maxDepth);
            if (sim.x[i] < b.x0 || sim.x[i] > b.x1 || sim.y[i] < b.y0 || sim.y[i] > b.y1 || r() < 0.0004 * (1 + e.depth[i])) e.alive[i] = 0;
            else if (e.depth[i] < maxDepth && r() < split) born.push(i);
        }
        for (const i of born) {
            if (e.active >= sim.n) break;
            const j = e.active++;
            const s = P(sim, "spread", 0.5) * (r() < 0.5 ? -1 : 1);
            sim.x[j] = sim.px[j] = sim.x[i]; sim.y[j] = sim.py[j] = sim.y[i];
            e.ang[j] = e.ang[i] + s; e.ang[i] -= s * 0.4;
            e.depth[j] = e.depth[i] + 1; e.alive[j] = 1;
            sim.u[j] = e.depth[j] / maxDepth;
        }
        // when the tree is done (or full), the next one starts while the old one fades
        if (!alive || (e.active >= sim.n && alive < 3)) seedGrowth(sim, r);
    },
};
function seedGrowth(sim: Sim, r: Rng) {
    const e = sim.extra, b = sim.bounds;
    const k = Math.min(sim.n, Math.round(Q(sim, "seeds", 3, 1, 12))), from = Math.round(Q(sim, "from", 0, 0, 2));
    e.alive.fill(0);
    for (let s = 0; s < k; s++) {
        let x: number, y: number, a: number;
        if (from === 0) { x = b.x0 + (b.x1 - b.x0) * ((s + 0.5) / k + (r() - 0.5) * 0.1); y = b.y1; a = -Math.PI / 2 + (r() - 0.5) * 0.4; }
        else if (from === 1) { x = 500 + (r() - 0.5) * 40; y = 500 + (r() - 0.5) * 40; a = (s / k) * TAU + r() * 0.3; }
        else { const t = (s / k) * TAU; x = 500 + 420 * Math.cos(t); y = 500 + 420 * Math.sin(t); a = t + Math.PI + (r() - 0.5) * 0.5; }
        sim.x[s] = sim.px[s] = x; sim.y[s] = sim.py[s] = y;
        e.ang[s] = a; e.depth[s] = 0; e.alive[s] = 1; sim.u[s] = 0;
    }
    e.active = k;
}

// ---------- pulse ----------
const pulse: Behaviour = {
    count: a => Math.min(a, 8000),
    init(sim) {
        const rings = Math.round(Q(sim, "rings", 10, 1, 60));
        const M = Math.max(24, Math.floor(sim.n / rings));
        sim.extra = { rings, M };
        place(sim, i => pulsePos(sim, i));
    },
    step(sim) {
        move(sim, i => pulsePos(sim, i));
        const { rings, M } = sim.extra;
        for (let k = 0; k < rings; k++) for (let m = 0; m < M; m++) {
            const i = k * M + m, j = k * M + ((m + 1) % M);
            if (j >= sim.n || i >= sim.n) break;
            if (sim.extra.reset?.[k]) continue;
            sim.emit(sim.x[i], sim.y[i], sim.x[j], sim.y[j], sim.u[i]);
        }
    },
};
function pulsePos(sim: Sim, i: number): [number, number] {
    const { rings, M } = sim.extra;
    const k = Math.floor(i / M), m = i % M, t = sim.frame;
    const rmax = Q(sim, "rmax", 480, 50, 1200), speed = Q(sim, "speed", 1.2, 0.05, 10);
    const raw = (k / rings) * rmax + t * speed;
    const rad = raw % rmax;
    sim.extra.reset ??= new Uint8Array(rings);
    sim.extra.reset[k] = rad < speed * 1.5 ? 1 : 0; // don't draw the frame a ring jumps back to the centre
    const centres = Math.round(Q(sim, "centres", 1, 1, 4)), j = Math.floor(raw / rmax + k) % centres;
    const cx = P(sim, `cx${j}`, 500), cy = P(sim, `cy${j}`, 500);
    const a = (m / M) * TAU;
    const wob = 1 + P(sim, "wobble", 0.08) * noise2(sim.state.seed + k, Math.cos(a) * P(sim, "lobes", 2), Math.sin(a) * 2 + t * 0.01);
    sim.u[i] = rad / rmax;
    return [cx + rad * wob * Math.cos(a), cy + rad * wob * Math.sin(a)];
}

// ---------- constellation (rare) ----------
const constellation: Behaviour = {
    count: (a, sp) => Math.min(a, Math.max(20, Math.min(800, Math.round(sp.stars ?? 260)))),
    init(sim, r) {
        const b = sim.bounds;
        for (let i = 0; i < sim.n; i++) {
            sim.x[i] = sim.px[i] = b.x0 + r() * (b.x1 - b.x0);
            sim.y[i] = sim.py[i] = b.y0 + r() * (b.y1 - b.y0);
            sim.u[i] = r();
        }
        sim.extra = { grid: new Map<number, number[]>() };
    },
    step(sim) {
        const { n, x, y, bounds: b } = sim, D = Q(sim, "reach", 90, 10, 250), v = Q(sim, "drift", 0.35, 0, 5), t = sim.frame;
        for (let i = 0; i < n; i++) {
            sim.px[i] = x[i]; sim.py[i] = y[i];
            x[i] += v * noise2(sim.state.seed, i * 0.71, t * 0.004) + sim.vx[i];
            y[i] += v * noise2(sim.state.seed + 9, i * 0.71, t * 0.004) + sim.vy[i];
            sim.vx[i] *= 0.92; sim.vy[i] *= 0.92;
            sim.pointerForce(i, x[i], y[i]);
            if (x[i] < b.x0) x[i] = b.x1; else if (x[i] > b.x1) x[i] = b.x0;
            if (y[i] < b.y0) y[i] = b.y1; else if (y[i] > b.y1) y[i] = b.y0;
            // a star: a short cross, so it reads as a point of light at any line weight
            sim.emit(x[i] - 1.5, y[i], x[i] + 1.5, y[i], sim.u[i]);
            sim.emit(x[i], y[i] - 1.5, x[i], y[i] + 1.5, sim.u[i]);
        }
        const grid: Map<number, number[]> = sim.extra.grid;
        grid.clear();
        const key = (gx: number, gy: number) => gx * 73856093 ^ gy * 19349663;
        for (let i = 0; i < n; i++) { const k = key(Math.floor(x[i] / D), Math.floor(y[i] / D)); let c = grid.get(k); if (!c) grid.set(k, (c = [])); c.push(i); }
        for (let i = 0; i < n; i++) {
            const gx = Math.floor(x[i] / D), gy = Math.floor(y[i] / D);
            for (let dx = 0; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy < 0) continue;
                const c = grid.get(key(gx + dx, gy + dy)); if (!c) continue;
                for (const j of c) if (j > i || dx || dy) {
                    if (j === i) continue;
                    const d = Math.hypot(x[j] - x[i], y[j] - y[i]);
                    if (d < D) sim.emit(x[i], y[i], x[j], y[j], (sim.u[i] + sim.u[j]) / 2);
                }
            }
        }
    },
};

// ---------- helpers for position-driven species ----------
// The viewer pushes these around through an offset that springs back.
function place(sim: Sim, pos: (i: number) => [number, number]) {
    for (let i = 0; i < sim.n; i++) { const [x, y] = pos(i); sim.x[i] = sim.px[i] = x; sim.y[i] = sim.py[i] = y; }
}
function move(sim: Sim, pos: (i: number) => [number, number]) {
    const { ox, oy } = sim;
    for (let i = 0; i < sim.n; i++) {
        const [x, y] = pos(i);
        sim.px[i] = sim.x[i]; sim.py[i] = sim.y[i];
        sim.pointerForce(i, x + ox[i], y + oy[i]);
        ox[i] = (ox[i] + sim.vx[i]) * 0.97; oy[i] = (oy[i] + sim.vy[i]) * 0.97;
        sim.vx[i] *= 0.85; sim.vy[i] *= 0.85;
        sim.x[i] = x + ox[i]; sim.y[i] = y + oy[i];
    }
}

export const BEHAVIOUR: Partial<Record<SpeciesKind, Behaviour>> = {
    orbit, flock, waves: rows("waves"), grid: rows("grid"), growth, pulse, constellation,
};

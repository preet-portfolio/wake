// The science family: real phenomena, simulated from their equations by the
// solver modules in src/science/ (the same code the correctness tests check).
// Each has one "aha" parameter that is read live, so moving its slider
// changes the running system. Gray–Scott runs on the GPU (see grayscott-gl.ts).
import * as L from "./science/lorenz";
import * as DP from "./science/pendulum";
import * as TB from "./science/threebody";
import * as K from "./science/kuramoto";
import * as CH from "./science/chladni";
import type { Rng } from "./rng";
import type { Sim } from "./sim";
import type { Behaviour } from "./species";

const P = (sim: Sim, k: string, d: number) => sim.state.sp?.[k] ?? d;
const Q = (sim: Sim, k: string, d: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, P(sim, k, d)));
const TAU = Math.PI * 2;

// ---------- Lorenz: a billionth becomes everything ----------
// A tight cluster of trajectories, each 10^eps apart, spreads over the
// attractor. The aha control is ρ: below ~13.9 there is no chaos at all.
export const lorenz: Behaviour = {
    count: a => Math.min(a, 1500),
    init(sim) {
        const eps = Math.pow(10, Q(sim, "eps", -9, -14, -2));
        sim.extra = { s: Array.from({ length: sim.n }, (_, i) => [1 + i * eps, 1, 20]), born: 0 };
        for (let i = 0; i < sim.n; i++) sim.u[i] = i / sim.n;
        project(sim);
        for (let i = 0; i < sim.n; i++) { sim.px[i] = sim.x[i]; sim.py[i] = sim.y[i]; }
    },
    step(sim) {
        const p = { ...L.CLASSIC, rho: Q(sim, "rho", 28, 0, 60) };
        const sub = Math.round(Q(sim, "sub", 6, 1, 20));
        for (const s of sim.extra.s) for (let k = 0; k < sub; k++) L.rk4(p, s, 0.005);
        for (let i = 0; i < sim.n; i++) { sim.px[i] = sim.x[i]; sim.py[i] = sim.y[i]; }
        project(sim);
        for (let i = 0; i < sim.n; i++) sim.emit(sim.px[i], sim.py[i], sim.x[i], sim.y[i], sim.u[i]);
        // every so often, gather into a new tight cluster and show it again
        if (sim.frame > 0 && sim.frame % Math.round(Q(sim, "cycle", 2400, 300, 20000)) === 0) lorenz.init(sim, sim.rng);
    },
};
function project(sim: Sim) {
    // a slowly turning view of the 3-D butterfly: x and y around the z axis
    const phi = sim.frame * 0.0015 * Q(sim, "turn", 1, 0, 5), c = Math.cos(phi), s = Math.sin(phi), k = 15;
    sim.extra.s.forEach((v: number[], i: number) => {
        sim.x[i] = 500 + (v[0] * c - v[1] * s) * k;
        sim.y[i] = 500 + (26 - v[2]) * k;
    });
}

// ---------- Double pendulum twins ----------
// A fan of pendulums released from almost the same angle, each 10^eps apart.
export const pendulum: Behaviour = {
    count: a => Math.min(a, 160),
    init(sim) {
        const eps = Math.pow(10, Q(sim, "eps", -9, -14, -2));
        const a1 = Q(sim, "angle", 2.2, 0.5, 3.1);
        sim.extra = { s: Array.from({ length: sim.n }, (_, i) => [a1 + i * eps, a1 + i * eps, 0, 0]) };
        for (let i = 0; i < sim.n; i++) sim.u[i] = i / sim.n;
        bobsTo(sim);
        for (let i = 0; i < sim.n; i++) { sim.px[i] = sim.x[i]; sim.py[i] = sim.y[i]; }
    },
    step(sim) {
        for (const s of sim.extra.s) for (let k = 0; k < 4; k++) DP.rk4(DP.STANDARD, s, 1 / 240);
        for (let i = 0; i < sim.n; i++) { sim.px[i] = sim.x[i]; sim.py[i] = sim.y[i]; }
        bobsTo(sim);
        for (let i = 0; i < sim.n; i++) sim.emit(sim.px[i], sim.py[i], sim.x[i], sim.y[i], sim.u[i]);
        // the rods of the first and last twin, so you can see they started as one
        for (const i of [0, sim.n - 1]) {
            const [x1, y1, x2, y2] = DP.bobs(DP.STANDARD, sim.extra.s[i]);
            sim.emit(500, 330, 500 + x1 * 210, 330 + y1 * 210, sim.u[i]);
            sim.emit(500 + x1 * 210, 330 + y1 * 210, 500 + x2 * 210, 330 + y2 * 210, sim.u[i]);
        }
        if (sim.frame > 0 && sim.frame % 3600 === 0) pendulum.init(sim, sim.rng);
    },
};
function bobsTo(sim: Sim) {
    sim.extra.s.forEach((s: number[], i: number) => {
        const [, , x2, y2] = DP.bobs(DP.STANDARD, s);
        sim.x[i] = 500 + x2 * 210; sim.y[i] = 330 + y2 * 210;
    });
}

// ---------- Figure-eight three-body choreography ----------
// Three equal masses, and ghost copies nudged by up to `nudge`: the
// choreography is stable, so small nudges stay close; large ones break it.
export const threebody: Behaviour = {
    count: a => Math.min(a, 3 * 40),
    init(sim, r) {
        const copies = sim.n / 3, nudge = Q(sim, "nudge", 0.002, 0, 0.3);
        sim.extra = {
            s: Array.from({ length: copies }, (_, c) => {
                const s = TB.figureEight();
                if (c) for (let k = 6; k < 12; k++) s[k] += (r() - 0.5) * 2 * nudge;
                return s;
            }),
        };
        for (let i = 0; i < sim.n; i++) sim.u[i] = (i % 3) / 3 + (Math.floor(i / 3) / copies) * 0.15;
        bodiesTo(sim);
        for (let i = 0; i < sim.n; i++) { sim.px[i] = sim.x[i]; sim.py[i] = sim.y[i]; }
    },
    step(sim) {
        const dt = TB.PERIOD / 600;
        for (const s of sim.extra.s) for (let k = 0; k < 2; k++) TB.verlet(s, dt, 1e-4);
        for (let i = 0; i < sim.n; i++) { sim.px[i] = sim.x[i]; sim.py[i] = sim.y[i]; }
        bodiesTo(sim);
        for (let i = 0; i < sim.n; i++) sim.emit(sim.px[i], sim.py[i], sim.x[i], sim.y[i], sim.u[i]);
    },
};
function bodiesTo(sim: Sim) {
    sim.extra.s.forEach((s: Float64Array, c: number) => {
        for (let b = 0; b < 3; b++) { const i = c * 3 + b; sim.x[i] = 500 + s[2 * b] * 380; sim.y[i] = 500 + s[2 * b + 1] * 380; }
    });
}

// ---------- Kuramoto fireflies ----------
// Each firefly flashes when its phase comes round. The aha control is the
// coupling K: past K_c = 2γ = 1 they suddenly flash together.
export const kuramoto: Behaviour = {
    count: a => Math.min(a, 1500),
    init(sim, r) {
        const b = sim.bounds;
        const w = K.cauchyFrequencies(sim.n, 0.5, TAU * 0.6);
        // shuffle which firefly gets which frequency, so neighbours differ
        for (let i = w.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [w[i], w[j]] = [w[j], w[i]]; }
        sim.extra = { w, th: Float64Array.from({ length: sim.n }, () => r() * TAU), r: 0 };
        for (let i = 0; i < sim.n; i++) {
            sim.x[i] = sim.px[i] = b.x0 + (0.04 + 0.92 * r()) * (b.x1 - b.x0);
            sim.y[i] = sim.py[i] = b.y0 + (0.04 + 0.92 * r()) * (b.y1 - b.y0);
        }
    },
    step(sim) {
        const e = sim.extra;
        K.rk4(e.th, e.w, Q(sim, "K", 0.6, 0, 4), 1 / 60);
        e.r = K.order(e.th).r;
        for (let i = 0; i < sim.n; i++) {
            const glow = Math.cos(e.th[i]);
            if (glow > 0.9) { sim.u[i] = glow; sim.emit(sim.x[i], sim.y[i], sim.x[i] + 0.01, sim.y[i], 0.75 + 0.25 * (glow - 0.9) * 10); }
        }
    },
};

// ---------- Chladni figures ----------
// Grains are thrown about in proportion to how much the plate moves under
// them, so they collect where it doesn't. The aha control picks the mode.
export const CHLADNI_MODES: [number, number][] = [[1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [2, 5], [1, 5], [3, 5], [4, 5], [2, 7], [3, 7], [5, 6]];
export const chladni: Behaviour = {
    count: a => Math.min(a, 8000),
    init(sim, r) {
        for (let i = 0; i < sim.n; i++) {
            sim.x[i] = sim.px[i] = 100 + 800 * r();
            sim.y[i] = sim.py[i] = 100 + 800 * r();
            sim.u[i] = r();
        }
    },
    step(sim, r) {
        const [n, m] = CHLADNI_MODES[Math.round(Q(sim, "mode", 4, 0, CHLADNI_MODES.length - 1))];
        const jump = Q(sim, "jump", 9, 1, 30);
        for (let i = 0; i < sim.n; i++) {
            sim.px[i] = sim.x[i]; sim.py[i] = sim.y[i];
            const a = Math.abs(CH.mode(n, m, (sim.x[i] - 500) / 400, (sim.y[i] - 500) / 400)) / 2;
            const ang = r() * TAU;
            sim.x[i] = Math.min(900, Math.max(100, sim.x[i] + Math.cos(ang) * jump * a + sim.vx[i]));
            sim.y[i] = Math.min(900, Math.max(100, sim.y[i] + Math.sin(ang) * jump * a + sim.vy[i]));
            sim.vx[i] *= 0.9; sim.vy[i] *= 0.9;
            sim.pointerForce(i, sim.x[i], sim.y[i]);
            sim.emit(sim.x[i], sim.y[i], sim.x[i] + 0.01, sim.y[i], sim.u[i]);
        }
    },
};

export const SCIENCE_BEHAVIOURS = { lorenz, pendulum, threebody, kuramoto, chladni };
export type { Rng };

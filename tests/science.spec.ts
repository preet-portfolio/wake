// Correctness of the science species, against published values. Pure Node:
// these test the same solver modules the visuals run.
import { test, expect } from "@playwright/test";
import * as L from "../src/science/lorenz";
import * as DP from "../src/science/pendulum";
import * as TB from "../src/science/threebody";
import * as K from "../src/science/kuramoto";
import * as GS from "../src/science/grayscott";
import * as CH from "../src/science/chladni";

test("Lorenz: largest Lyapunov exponent ≈ 0.9056 (σ=10, ρ=28, β=8/3)", () => {
    const lambda = L.lyapunov(L.CLASSIC, 400, 0.005);
    expect(lambda).toBeGreaterThan(0.85);
    expect(lambda).toBeLessThan(0.96);
});

// Between ρ ≈ 13.93 and 24.74 the system shows transient chaos (Kaplan & Yorke 1979):
// twins can wander apart before settling, even onto different fixed points. So
// the "no chaos" check uses ρ = 10, below that window. (An earlier version of
// this test used ρ = 20 and failed, correctly.)
test("Lorenz: twins 10⁻⁹ apart separate to the size of the attractor at ρ = 28; at ρ = 10 they stay twins", () => {
    const run = (rho: number) => {
        const p = { ...L.CLASSIC, rho };
        const a = [1, 1, 20], b = [1 + 1e-9, 1, 20];
        for (let i = 0; i < 8000; i++) { L.rk4(p, a, 0.005); L.rk4(p, b, 0.005); }
        return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    };
    expect(run(28)).toBeGreaterThan(1);     // chaos: a billionth becomes everything
    expect(run(10)).toBeLessThan(1e-6);     // stable fixed points, no transient chaos: twins stay twins
});

test("double pendulum (RK4): energy drift < 0.1 % over 10,000 steps", () => {
    const s = [2.0, 2.2, 0, 0], e0 = DP.energy(DP.STANDARD, s);
    let worst = 0;
    for (let i = 0; i < 10000; i++) { DP.rk4(DP.STANDARD, s, 1 / 240); worst = Math.max(worst, Math.abs(DP.energy(DP.STANDARD, s) - e0) / Math.abs(e0)); }
    expect(worst).toBeLessThan(1e-3);
});

test("figure-eight (velocity Verlet): energy drift < 0.1 % and the orbit closes after T = 6.32591398", () => {
    const s = TB.figureEight(), start = TB.figureEight(), e0 = TB.energy(s);
    const dt = TB.PERIOD / 10000;
    let worst = 0, halfway = 0;
    for (let i = 1; i <= 10000; i++) {
        TB.verlet(s, dt);
        worst = Math.max(worst, Math.abs(TB.energy(s) - e0) / Math.abs(e0));
        if (i === 5000) halfway = Math.hypot(...Array.from(s.subarray(0, 6), (v, k) => v - start[k]));
    }
    const closes = Math.hypot(...Array.from(s.subarray(0, 6), (v, k) => v - start[k]));
    expect(worst).toBeLessThan(1e-3);
    expect(closes).toBeLessThan(1e-3);      // back where it started after one period
    expect(halfway).toBeGreaterThan(0.5);   // and genuinely elsewhere half way round
});

test("Kuramoto: synchrony switches on at K_c = 2γ and follows r = √(1 − K_c/K)", () => {
    const gamma = 0.5, Kc = 2 * gamma;
    const r = (Kv: number) => {
        const w = K.cauchyFrequencies(2000, gamma);
        const th = new Float64Array(2000).map((_, i) => (i * 2.399963) % (2 * Math.PI));
        for (let i = 0; i < 1500; i++) K.rk4(th, w, Kv, 0.05);
        let sum = 0;
        for (let i = 0; i < 300; i++) { K.rk4(th, w, Kv, 0.05); sum += K.order(th).r; }
        return sum / 300;
    };
    expect(r(0.5 * Kc)).toBeLessThan(0.05);
    for (const Kv of [1.5, 2, 3]) expect(Math.abs(r(Kv) - Math.sqrt(1 - Kc / Kv))).toBeLessThan(0.03);
});

test("Gray-Scott: Pearson's map regions give their patterns (spots, labyrinth, extinction)", () => {
    test.setTimeout(120_000);
    const m = (p: { F: number; k: number }) => { const { v, size } = GS.simulate(p.F, p.k, 128, 6000); return GS.morphology(v, size); };
    const spots = m(GS.PRESETS.spots), stripes = m(GS.PRESETS.stripes), fade = m(GS.PRESETS.fade);
    expect(spots.blobs).toBeGreaterThanOrEqual(15);       // many separate spots
    expect(spots.largestShare).toBeLessThan(0.2);
    expect(stripes.largestShare).toBeGreaterThan(0.8);    // one connected labyrinth
    expect(stripes.coverage).toBeGreaterThan(0.3);
    expect(fade.coverage).toBeLessThan(0.005);            // nothing survives
});

test("Chladni: the mode is zero on its nodal lines (the diagonals for n ≠ m)", () => {
    for (const [n, m] of [[1, 2], [2, 5], [3, 7]]) {
        for (let t = -1; t <= 1; t += 0.1) {
            expect(Math.abs(CH.mode(n, m, t, t))).toBeLessThan(1e-12);     // u(x, x) = 0
            expect(Math.abs(CH.mode(n, m, t, -t))).toBeLessThan(1e-12);    // u(x, −x) = 0
        }
    }
});

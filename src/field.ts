// The block stack as motion: one function moves a point one step. The still
// engine and the live simulation both use it, so a design means the same thing
// in both.
import { curl, noise1, type Rng } from "./rng";
import { signal, WORLD, type Block, type Param } from "./model";

const DEG = Math.PI / 180;

/** A param's value at local time tau (steps since birth) and line position u. */
export function ev(p: Param, tau: number, u: number, seed: number): number {
    if (!p.t && !p.u) return p.b;
    const nz = (s: number, x: number) => noise1(seed + s, x);
    return p.b * (1 + signal(p.t, tau, 1, nz)) * (1 + signal(p.u, u, 2, nz));
}

/**
 * Move (x, y) one step through every enabled block. Writes the result into out[0], out[1].
 * flowTime drives how the curl-noise field evolves: the still engine uses each
 * point's own clock, the live simulation one shared clock so streams stay coherent.
 */
export function stepPoint(blocks: Block[], x: number, y: number, tau: number, u: number, seed: number, rng: Rng, out: Float64Array, flowTime = tau) {
    for (const b of blocks) {
        if (!b.on || b.k === "delay") continue;
        const p = b.p;
        const v = (q: Param) => ev(q, tau, u, seed);
        switch (b.k) {
            case "rotate": {
                const a = v(p.a) * DEG, ox = v(p.ox), oy = v(p.oy);
                const ca = Math.cos(a), sa = Math.sin(a), dx = x - ox, dy = y - oy;
                x = ox + dx * ca - dy * sa; y = oy + dx * sa + dy * ca;
                break;
            }
            case "scale": {
                const s = v(p.s) / 100, sy = v(p.sy), ox = v(p.ox), oy = v(p.oy);
                x = ox + (x - ox) * (1 + s); y = oy + (y - oy) * (1 + s * sy);
                break;
            }
            case "move":
                x += v(p.dx); y += v(p.dy);
                break;
            case "wave": {
                const a = v(p.a) * Math.sin(2 * Math.PI * u * Math.round(v(p.f)));
                const d = v(p.dir) * DEG;
                x += a * Math.cos(d); y += a * Math.sin(d);
                break;
            }
            case "jitter": {
                const a = v(p.a);
                x += (rng() - 0.5) * a; y += (rng() - 0.5) * a;
                break;
            }
            case "swirl": {
                const ox = v(p.ox), oy = v(p.oy), dx = x - ox, dy = y - oy;
                const a = (v(p.k) * DEG) / (1 + Math.hypot(dx, dy) / 100);
                const ca = Math.cos(a), sa = Math.sin(a);
                x = ox + dx * ca - dy * sa; y = oy + dx * sa + dy * ca;
                break;
            }
            case "attract": {
                const k = v(p.k) / 100;
                x += (v(p.x) - x) * k; y += (v(p.y) - y) * k;
                break;
            }
            case "flow": {
                const sc = v(p.s) / WORLD;
                const [fx, fy] = curl(seed, x * sc, y * sc, (flowTime * v(p.v)) / 60);
                const k = v(p.k);
                x += fx * k; y += fy * k;
                break;
            }
        }
    }
    out[0] = x; out[1] = y;
}

/** Each point's start time from the enabled delay blocks (the "every point keeps its own clock" field). */
export function delays(blocks: Block[], n: number, seed: number): Float64Array {
    const d = new Float64Array(n);
    for (const b of blocks) {
        if (!b.on || b.k !== "delay") continue;
        for (let i = 0; i < n; i++) {
            const u = i / n;
            const span = ev(b.p.span, 0, u, seed);
            const shifted = (u + (b.p.shift?.b ?? 0)) % 1;
            d[i] += Math.abs(span) * (span >= 0 ? shifted : 1 - shifted);
        }
    }
    return d;
}

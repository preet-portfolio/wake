// mulberry32 (Tommy Ettinger, public domain): tiny, fast, seedable.
// Every random number in wake comes from here.
export type Rng = () => number;

export function makeRng(seed: number): Rng {
    let a = (seed * 2654435761) >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// smooth 1-D value noise in [-1, 1], deterministic per seed
export function noise1(seed: number, x: number): number {
    const i = Math.floor(x);
    const f = x - i;
    const h = (n: number) => {
        let v = Math.imul((n + seed * 374761393) | 0, 668265263);
        v = Math.imul(v ^ (v >>> 13), 1274126177);
        return (((v ^ (v >>> 16)) >>> 0) / 4294967296) * 2 - 1;
    };
    const s = f * f * (3 - 2 * f);
    return h(i) * (1 - s) + h(i + 1) * s;
}

// 2-D gradient noise (Perlin-style) in about [-1, 1], deterministic per seed.
// Used through curl() so flow fields are divergence-free and swirl.
const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
function hash2(seed: number, x: number, y: number): number {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
}
export function noise2(seed: number, x: number, y: number): number {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const dot = (ix: number, iy: number, dx: number, dy: number) => {
        const g = GRAD[hash2(seed, xi + ix, yi + iy) & 7];
        return g[0] * dx + g[1] * dy;
    };
    const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
    const u = fade(xf), v = fade(yf);
    const a = dot(0, 0, xf, yf), b = dot(1, 0, xf - 1, yf);
    const c = dot(0, 1, xf, yf - 1), d = dot(1, 1, xf - 1, yf - 1);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.4;
}

/**
 * Curl of a noise potential at (x, y), drifting with time t: a 2-D velocity
 * with no sources or sinks, so particles swirl instead of bunching up.
 * (Bridson, Hourihan & Nordenstam, "Curl-noise for procedural fluid flow", 2007.)
 */
export function curl(seed: number, x: number, y: number, t: number): [number, number] {
    const e = 0.01;
    const tx = t * 0.7, ty = t * 0.43; // move the potential through space over time
    const n = (px: number, py: number) => noise2(seed, px + tx, py + ty);
    const dpdx = (n(x + e, y) - n(x - e, y)) / (2 * e);
    const dpdy = (n(x, y + e) - n(x, y - e)) / (2 * e);
    return [dpdy, -dpdx];
}

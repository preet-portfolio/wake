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

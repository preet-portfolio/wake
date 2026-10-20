// Gray–Scott reaction–diffusion (Gray & Scott 1984; patterns mapped by
// Pearson, "Complex Patterns in a Simple System", Science 261, 1993), the
// kind of mechanism Turing proposed for morphogenesis (1952).
//   ∂u/∂t = Dᵤ∇²u − uv² + F(1 − u)
//   ∂v/∂t = Dᵥ∇²v + uv² − (F + k)v
// This CPU version is the reference the GPU shader is tested against: same
// constants, same 3×3 Laplacian (centre −1, edges 0.2, corners 0.05), dt = 1,
// Dᵤ = 1, Dᵥ = 0.5 (Karl Sims's widely used normalisation).
export const DU = 1, DV = 0.5;

/** Named regions of Pearson's (F, k) map, by the morphology they produce. */
export const PRESETS = {
    spots: { F: 0.0367, k: 0.0649, label: "self-replicating spots" },
    stripes: { F: 0.055, k: 0.062, label: "labyrinthine stripes" },
    fade: { F: 0.03, k: 0.075, label: "the pattern dies out" },
} as const;

/** The starting field, shared by the CPU reference and the GPU: u = 1, with a deterministic scatter of 7×7 seeds. */
export function initialField(w: number, h: number, seed = 1, spots = 12) {
    const u = new Float32Array(w * h).fill(1), v = new Float32Array(w * h);
    let s = seed >>> 0 || 1;
    const rand = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
    for (let q = 0; q < spots; q++) {
        const cx = Math.floor(rand() * w), cy = Math.floor(rand() * h);
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
            const i = ((cy + dy + h) % h) * w + ((cx + dx + w) % w);
            u[i] = 0.5; v[i] = 0.25;
        }
    }
    return { u, v };
}

export function simulate(F: number, k: number, size = 128, steps = 10000, seed = 1) {
    let { u, v } = initialField(size, size, seed);
    let nu = new Float32Array(size * size), nv = new Float32Array(size * size);
    const L = (a: Float32Array, x: number, y: number) => {
        const X = (i: number) => (i + size) % size;
        const at = (dx: number, dy: number) => a[X(y + dy) * size + X(x + dx)];
        return -a[y * size + x] + 0.2 * (at(1, 0) + at(-1, 0) + at(0, 1) + at(0, -1)) + 0.05 * (at(1, 1) + at(-1, 1) + at(1, -1) + at(-1, -1));
    };
    for (let t = 0; t < steps; t++) {
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            const i = y * size + x, a = u[i], b = v[i], r = a * b * b;
            nu[i] = a + DU * L(u, x, y) - r + F * (1 - a);
            nv[i] = b + DV * L(v, x, y) + r - (F + k) * b;
        }
        [u, nu] = [nu, u]; [v, nv] = [nv, v];
    }
    return { u, v, size };
}

/** Describe a field: how much is "on" (v > 0.2), in how many separate blobs, and how round they are. */
export function morphology(v: Float32Array, size: number) {
    const on = new Uint8Array(size * size);
    let count = 0;
    for (let i = 0; i < on.length; i++) if (v[i] > 0.2) { on[i] = 1; count++; }
    const seen = new Uint8Array(on.length);
    const blobs: number[] = [];
    for (let i = 0; i < on.length; i++) {
        if (!on[i] || seen[i]) continue;
        let n = 0;
        const stack = [i]; seen[i] = 1;
        while (stack.length) {
            const j = stack.pop()!; n++;
            const x = j % size, y = (j - x) / size;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const k = ((y + dy + size) % size) * size + ((x + dx + size) % size);
                if (on[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
            }
        }
        blobs.push(n);
    }
    blobs.sort((a, b) => b - a);
    return { coverage: count / on.length, blobs: blobs.length, largestShare: count ? (blobs[0] ?? 0) / count : 0, meanBlob: blobs.length ? count / blobs.length : 0 };
}

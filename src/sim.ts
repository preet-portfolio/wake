// The live simulation. Line-heads start on the seed shape, each with its own
// position, velocity and clock, and move through the block stack, which acts
// as a field of forces. Every step leaves a mark on a trail buffer that fades,
// and a line-head that has lived its life goes back to the seed shape, so the
// flow never ends. The viewer is a force too: pointer, touch and tilt.
import { SEG, seedPoints } from "./engine";
import { delays, stepPoint } from "./field";
import { makeRng, type Rng } from "./rng";
import { WORLD, type State } from "./model";

export interface Pointer {
    x: number; y: number;      // world units
    vx: number; vy: number;    // world units per step
    mode: "none" | "stir" | "attract" | "push";
}

const RADIUS = 150;

export class Sim {
    readonly n: number;
    readonly state: State;
    x: Float32Array; y: Float32Array;
    px: Float32Array; py: Float32Array;
    vx: Float32Array; vy: Float32Array;
    age: Float32Array; life: Float32Array;
    gen: Uint32Array;
    home: Float64Array;
    u: Float32Array;
    /** segments from the last step, SEG floats each */
    segs: Float32Array;
    count = 0;
    frame = 0;
    rng: Rng;
    out = new Float64Array(2);

    constructor(state: State, n: number) {
        this.state = state;
        this.n = n;
        const life = makeRng(state.seed * 31 + 7);
        this.rng = makeRng(state.seed);
        this.home = seedPoints({ ...state.shape, n }, makeRng(state.seed)).pts;
        const delay = delays(state.blocks, n, state.seed);
        const A = () => new Float32Array(n);
        this.x = A(); this.y = A(); this.px = A(); this.py = A(); this.vx = A(); this.vy = A();
        this.age = A(); this.life = A(); this.u = A();
        this.gen = new Uint32Array(n);
        this.segs = new Float32Array(n * SEG);
        const rings = state.live.mode === "rings";
        for (let i = 0; i < n; i++) {
            this.x[i] = this.px[i] = this.home[2 * i];
            this.y[i] = this.py[i] = this.home[2 * i + 1];
            this.u[i] = i / n;
            // rings replay the drawing in lockstep; trails get staggered lives so
            // the flow is continuous from the first second
            this.life[i] = rings ? state.steps : state.steps * (0.6 + 0.8 * life());
            this.age[i] = -delay[i] - (rings ? 0 : life() * Math.min(this.life[i], 45));
        }
    }

    private respawn(i: number) {
        this.x[i] = this.px[i] = this.home[2 * i];
        this.y[i] = this.py[i] = this.home[2 * i + 1];
        this.vx[i] = this.vy[i] = 0;
        this.age[i] = 0;
        this.gen[i]++;
    }

    step(pointer: Pointer, gravity: [number, number] = [0, 0]) {
        const { n, x, y, px, py, vx, vy, age, life, u, state, out } = this;
        const blocks = state.blocks, seed = state.seed, skip = state.mark.skip;
        const rings = state.live.mode === "rings";
        const pr2 = RADIUS * RADIUS;
        let c = 0;

        for (let i = 0; i < n; i++) {
            if (age[i] < 0) { age[i]++; continue; }        // not born yet
            if (age[i] > life[i] || x[i] < -WORLD || x[i] > 2 * WORLD || y[i] < -WORLD || y[i] > 2 * WORLD) {
                this.respawn(i);
                continue;
            }
            px[i] = x[i]; py[i] = y[i];
            stepPoint(blocks, x[i], y[i], age[i], u[i], seed, this.rng, out, this.frame);

            // the viewer's forces, plus tilt, act on velocity, which decays
            if (pointer.mode !== "none") {
                const dx = pointer.x - out[0], dy = pointer.y - out[1], d2 = dx * dx + dy * dy;
                if (d2 < 4 * pr2) {
                    const w = Math.exp(-d2 / pr2);
                    if (pointer.mode === "stir") { vx[i] += pointer.vx * w * 0.35; vy[i] += pointer.vy * w * 0.35; }
                    else if (pointer.mode === "attract") { vx[i] += dx * w * 0.012; vy[i] += dy * w * 0.012; }
                    else { const d = Math.sqrt(d2) + 1; vx[i] -= (dx / d) * w * 1.6; vy[i] -= (dy / d) * w * 1.6; }
                }
            }
            vx[i] = (vx[i] + gravity[0]) * 0.9;
            vy[i] = (vy[i] + gravity[1]) * 0.9;
            x[i] = out[0] + vx[i];
            y[i] = out[1] + vy[i];
            age[i]++;

            if (!rings && age[i] > 1 && !(skip > 0 && this.rng() < skip)) {
                const o = c * SEG;
                this.segs[o] = px[i]; this.segs[o + 1] = py[i]; this.segs[o + 2] = x[i]; this.segs[o + 3] = y[i]; this.segs[o + 4] = u[i];
                c++;
            }
        }
        if (rings) {
            // join neighbours that are alive and of the same generation, like the still drawing
            const join = (i: number, j: number) => {
                if (age[i] < 1 || age[j] < 1 || this.gen[i] !== this.gen[j]) return;
                if (skip > 0 && this.rng() < skip) return;
                const o = c * SEG;
                this.segs[o] = x[i]; this.segs[o + 1] = y[i]; this.segs[o + 2] = x[j]; this.segs[o + 3] = y[j]; this.segs[o + 4] = u[i];
                c++;
            };
            for (let i = 1; i < n; i++) join(i - 1, i);
            if (state.shape.kind !== "line" && state.shape.kind !== "drawn") join(n - 1, 0);
        }
        this.count = c;
        this.frame++;
    }

    /**
     * Freeze & plot: from the current moment, trace every line-head through one
     * lifetime with time held still and no viewer forces, as plotter polylines.
     */
    trace(): number[][] {
        const copy: Sim = Object.assign(Object.create(Sim.prototype), this, {
            x: this.x.slice(), y: this.y.slice(), px: this.px.slice(), py: this.py.slice(),
            vx: new Float32Array(this.n), vy: new Float32Array(this.n),
            age: this.age.slice(), gen: this.gen.slice(), segs: new Float32Array(this.segs.length),
            rng: makeRng(this.state.seed + this.frame), out: new Float64Array(2),
        });
        const none: Pointer = { x: 0, y: 0, vx: 0, vy: 0, mode: "none" };
        const steps = Math.ceil(Math.max(...Array.from(this.life.subarray(0, Math.min(this.n, 4000))))) + 1;
        const lines: number[][] = [];
        const open = new Map<number, number[]>();
        for (let s = 0; s < steps; s++) {
            copy.step(none);
            if (this.state.live.mode === "rings") {
                let cur: number[] | null = null;
                for (let k = 0; k < copy.count; k++) {
                    const o = k * SEG;
                    if (cur && cur[cur.length - 2] === copy.segs[o] && cur[cur.length - 1] === copy.segs[o + 1]) cur.push(copy.segs[o + 2], copy.segs[o + 3]);
                    else { cur = [copy.segs[o], copy.segs[o + 1], copy.segs[o + 2], copy.segs[o + 3]]; lines.push(cur); }
                }
            } else {
                for (let i = 0; i < copy.n; i++) {
                    if (copy.age[i] < 2) { if (open.has(i)) { lines.push(open.get(i)!); open.delete(i); } continue; }
                    const l = open.get(i);
                    if (l) l.push(copy.x[i], copy.y[i]);
                    else open.set(i, [copy.px[i], copy.py[i], copy.x[i], copy.y[i]]);
                }
            }
        }
        for (const l of open.values()) lines.push(l);
        return lines.filter(l => l.length >= 4);
    }
}

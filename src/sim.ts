// The live simulation. Line-heads start on the seed shape, each with its own
// position, velocity and clock, and move through the block stack, which acts
// as a field of forces. Every step leaves a mark on a trail buffer that fades,
// and a line-head that has lived its life goes back to the seed shape, so the
// flow never ends. The viewer is a force too: pointer, touch and tilt.
import { SEG, seedPoints } from "./engine";
import { delays, stepPoint } from "./field";
import { makeRng, type Rng } from "./rng";
import { WORLD, type State } from "./model";
import { BEHAVIOUR, type Behaviour, type Bounds } from "./species";

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
    /** the visible world, for species that fill the screen */
    bounds: Bounds;
    /** per-species state */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    extra: any = null;
    /** viewer offsets for position-driven species */
    ox: Float32Array; oy: Float32Array;
    private behaviour: Behaviour | undefined;
    private available: number;

    /**
     * Species keep internal state (trees, flocks), so a plot replays the design
     * deterministically from the start, as far as the live one has run (up to
     * 240 steps), then traces the next stretch into polylines.
     */
    private traceFresh(): number[][] {
        const s = new Sim(this.state, this.available, this.bounds);
        const none: Pointer = { x: 0, y: 0, vx: 0, vy: 0, mode: "none" };
        for (let i = 0; i < Math.min(this.frame, 240); i++) s.step(none);
        const lines: number[][] = [];
        const steps = Math.min(Math.max(30, Math.round(this.state.live.trail)), 160);
        for (let k = 0; k < steps; k++) {
            s.step(none);
            let cur: number[] | null = null;
            for (let m = 0; m < s.count; m++) {
                const o = m * SEG, x0 = s.segs[o], y0 = s.segs[o + 1], x1 = s.segs[o + 2], y1 = s.segs[o + 3];
                if (cur && cur[cur.length - 2] === x0 && cur[cur.length - 1] === y0) cur.push(x1, y1);
                else { cur = [x0, y0, x1, y1]; lines.push(cur); }
            }
        }
        return lines;
    }
    private pointer: Pointer = { x: 0, y: 0, vx: 0, vy: 0, mode: "none" };
    private gravity: [number, number] = [0, 0];

    constructor(state: State, available: number, bounds: Bounds = { x0: 0, x1: WORLD, y0: 0, y1: WORLD }) {
        this.state = state;
        this.bounds = bounds;
        this.behaviour = state.species ? BEHAVIOUR[state.species] : undefined;
        this.available = available;
        const n = this.behaviour ? Math.max(1, this.behaviour.count(available, state.sp ?? {})) : available;
        this.n = n;
        const life = makeRng(state.seed * 31 + 7);
        this.rng = makeRng(state.seed);
        this.home = seedPoints({ ...state.shape, n }, makeRng(state.seed)).pts;
        const delay = delays(state.blocks, n, state.seed);
        const A = () => new Float32Array(n);
        this.x = A(); this.y = A(); this.px = A(); this.py = A(); this.vx = A(); this.vy = A();
        this.age = A(); this.life = A(); this.u = A();
        this.gen = new Uint32Array(n);
        this.segs = new Float32Array(n * SEG * 2);
        this.ox = A(); this.oy = A();
        if (this.behaviour) {
            this.behaviour.init(this, this.rng);
            return;
        }
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

    /** Add a mark for this step (grows the buffer if a species draws more than one per line-head). */
    emit(x0: number, y0: number, x1: number, y1: number, u: number) {
        const o = this.count * SEG;
        if (o + SEG > this.segs.length) { const b = new Float32Array(this.segs.length * 2); b.set(this.segs); this.segs = b; }
        this.segs[o] = x0; this.segs[o + 1] = y0; this.segs[o + 2] = x1; this.segs[o + 3] = y1; this.segs[o + 4] = u;
        this.count++;
    }

    /** The viewer's forces (and tilt) on line-head i at (x, y): they change its velocity, which decays. */
    pointerForce(i: number, x: number, y: number) {
        const p = this.pointer;
        this.vx[i] += this.gravity[0]; this.vy[i] += this.gravity[1];
        if (p.mode === "none") return;
        const dx = p.x - x, dy = p.y - y, d2 = dx * dx + dy * dy, pr2 = RADIUS * RADIUS;
        if (d2 > 4 * pr2) return;
        const w = Math.exp(-d2 / pr2);
        if (p.mode === "stir") { this.vx[i] += p.vx * w * 0.35; this.vy[i] += p.vy * w * 0.35; }
        else if (p.mode === "attract") { this.vx[i] += dx * w * 0.012; this.vy[i] += dy * w * 0.012; }
        else { const d = Math.sqrt(d2) + 1; this.vx[i] -= (dx / d) * w * 1.6; this.vy[i] -= (dy / d) * w * 1.6; }
    }

    step(pointer: Pointer, gravity: [number, number] = [0, 0]) {
        this.pointer = pointer;
        this.gravity = gravity;
        if (this.behaviour) {
            this.count = 0;
            this.behaviour.step(this, this.rng);
            this.frame++;
            return;
        }
        const { n, x, y, px, py, vx, vy, age, life, u, state, out } = this;
        const blocks = state.blocks, seed = state.seed, skip = state.mark.skip;
        const rings = state.live.mode === "rings";
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
            this.pointerForce(i, out[0], out[1]);
            vx[i] *= 0.9;
            vy[i] *= 0.9;
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
        if (this.behaviour) return this.traceFresh();
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

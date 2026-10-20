// The numbered collection. Every number from 1 to DESIGNS is one fixed design:
// one in five is an "ink" piece (paper and pen, within the plot budget), the
// rest are "colour" pieces (light on dark, or pigment on paper).
// Candidates are judged on the CPU only (fill, exposure, plot budget), so a
// number gives the same design on every device.
import { runAll, SEG } from "./engine";
import { Budget } from "./export";
import { makeRng, type Rng } from "./rng";
import { BLOCKS, DESIGNS, PALETTES, WORLD, defaultState, defaultStyle, newBlock, type Block, type BlockKind, type Palette, type SeedKind, type SignalKind, type State } from "./model";

export type Mode = "colour" | "ink";

export const modeOf = (n: number): Mode => (n % 5 === 0 ? "ink" : "colour");

/** A random design number of the given mode. */
export function randomDesign(mode: Mode): number {
    for (;;) {
        const n = 1 + Math.floor(Math.random() * DESIGNS);
        if (modeOf(n) === mode) return n;
    }
}

const DARK = ["#0b0d14", "#0f0f1a", "#0a1220", "#14100e", "#09090b", "#151026", "#0d1512", "#1a0f14"];
const LIGHT = ["#f6f1e7", "#fbf5ef", "#eef1f6", "#f6f2ff", "#f7e15c", "#fff6f2", "#eef4ec"];

function shade(hex: string, k: number): string {
    const v = parseInt(hex.slice(1), 16);
    const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(x => Math.round(Math.min(255, Math.max(0, x * k))));
    return "#" + c.map(x => x.toString(16).padStart(2, "0")).join("");
}

function stack(r: Rng, mode: Mode): State {
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    const between = (a: number, b: number) => a + (b - a) * r();
    const s = defaultState();

    const blocks: Block[] = [];
    if (r() < 0.65) {
        const delay = newBlock("delay");
        delay.p.span.b = Math.round(between(-140, 140));
        blocks.push(delay);
    }
    const scale = newBlock("scale");
    scale.p.s.b = mode === "ink" ? between(-2.2, -0.6) : between(-3, -0.6);
    scale.p.sy.b = r() < 0.25 ? between(0.3, 1.6) : 1;
    scale.p.ox.b = between(350, 650); scale.p.oy.b = between(350, 650);
    blocks.push(scale);
    // curl-noise flow in about half the colour designs: it is what makes the live
    // view feel alive. Ink pieces get it rarely and gently: it tangles lines, and
    // tangled lines over-ink paper.
    if (r() < (mode === "ink" ? 0.2 : 0.5)) {
        const f = newBlock("flow");
        f.p.k.b = mode === "ink" ? between(0.3, 1.0) : between(0.6, 3.5);
        f.p.s.b = between(0.8, 4); f.p.v.b = between(0.1, 1.2);
        blocks.push(f);
    }
    const extras: BlockKind[] = ["rotate", "rotate", "wave", "swirl", "attract", "jitter", "move"];
    for (const k of extras) {
        if (r() > 0.4) continue;
        const b = newBlock(k);
        if (k === "rotate") { b.p.a.b = between(-2.5, 2.5); b.p.ox.b = between(250, 750); b.p.oy.b = between(250, 750); }
        if (k === "wave") { b.p.a.b = between(0.5, 4); b.p.f.b = Math.round(between(2, 18)); b.p.dir.b = Math.round(between(0, 180)); }
        if (k === "swirl") b.p.k.b = between(-5, 5);
        if (k === "attract") { b.p.k.b = between(-1.5, 2.5); b.p.x.b = between(250, 750); b.p.y.b = between(250, 750); }
        if (k === "jitter") b.p.a.b = between(0.1, mode === "ink" ? 0.8 : 2.5);
        if (k === "move") { b.p.dx.b = between(-3, 3); b.p.dy.b = between(-3, 3); }
        if (r() < 0.3) {
            const name = BLOCKS[k].params[0][0];
            b.p[name].t = [pick(["sin", "fade", "noise"] as SignalKind[]), between(0.3, 1), Math.round(between(20, 120))];
        }
        if (r() < 0.15) {
            const name = BLOCKS[k].params[0][0];
            b.p[name].u = [pick(["sin", "noise"] as SignalKind[]), between(0.3, 1), pick([1, 2, 3, 0.5])];
        }
        blocks.splice(Math.floor(r() * (blocks.length + 1)), 0, b);
    }
    s.blocks = blocks;
    s.seed = 1 + Math.floor(r() * 99999);
    s.shape = {
        ...s.shape,
        // ink pieces lean on circles: the plotter series showed they survive paper best
        kind: pick((mode === "ink" ? ["circle", "circle", "circle", "lissajous", "polygon"] : ["circle", "circle", "polygon", "lissajous", "line", "lissajous"]) as SeedKind[]),
        sides: Math.round(between(3, 7)),
        la: Math.round(between(1, 5)), lb: Math.round(between(1, 5)),
        r: Math.round(between(300, 440)),
        rot: Math.round(between(0, 359)),
        // colour pieces are silk, not wireframe: many points, many steps (kept under
        // 150k segments so the whole drawing can redraw every frame while drifting)
        n: mode === "ink" ? 600 : Math.round(between(900, 2200)),
    };
    s.steps = Math.round(mode === "ink" ? between(36, 80) : Math.min(between(70, 170), 145_000 / s.shape.n));
    s.live = {
        mode: r() < 0.3 ? "rings" : "trails",
        trail: Math.round(between(40, 220)),
        speed: +between(0.6, 1.5).toFixed(2),
    };
    if (mode === "colour" && r() < 0.2) {
        s.mark = { skip: between(0, 0.4), detach: true, seglen: between(120, 450), segrot: Math.round(between(0, 90)) };
    } else if (mode === "colour" && r() < 0.15) {
        s.mark = { ...s.mark, skip: between(0.2, 0.6) };
    }
    return s;
}

function colourStyle(r: Rng, s: State) {
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    const between = (a: number, b: number) => a + (b - a) * r();
    const st = defaultStyle();
    const base = PALETTES[pick(Object.keys(PALETTES))];
    // a little variation on the curated palettes keeps 100,000 designs from repeating colours
    const palette = base.map((v, i) => (i >= 9 ? v + between(-0.15, 0.15) : v)) as Palette;
    st.palette = palette;
    st.spread = +between(0.3, 3).toFixed(2);
    st.cycle = +(r() < 0.5 ? between(0, 1.5) : 0).toFixed(2);
    st.shift = +r().toFixed(3);
    if (r() < 0.7) {
        st.paper = pick(DARK);
        st.paper2 = r() < 0.6 ? shade(st.paper, 0.45) : shade(st.paper, 1.8);
        st.blend = r() < 0.75 ? "add" : "screen";
        st.soft = +(r() < 0.6 ? between(0.2, 0.9) : 0).toFixed(2);
        st.width = +between(0.8, s.mark.detach ? 2 : 3).toFixed(2);
    } else {
        st.paper = pick(LIGHT);
        st.paper2 = shade(st.paper, between(0.88, 0.97));
        st.blend = r() < 0.8 ? "multiply" : "over";
        st.soft = +(r() < 0.3 ? between(0.1, 0.5) : 0).toFixed(2);
        st.width = +between(0.9, 2.6).toFixed(2);
    }
    st.grain = +(r() < 0.5 ? between(0.1, 0.7) : 0).toFixed(2);
    s.style = st;
}

/** Fill and density of a state, from the engine alone (no GPU). */
function measure(s: State) {
    const G = 48, cell = WORLD / G;
    const grid = new Float32Array(G * G);
    const budget = new Budget();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    runAll(s, (segs, count) => {
        budget.add(segs, count);
        for (let k = 0; k < count; k++) {
            const o = k * SEG;
            const ax = segs[o], ay = segs[o + 1], bx = segs[o + 2], by = segs[o + 3];
            x0 = Math.min(x0, ax, bx); x1 = Math.max(x1, ax, bx); y0 = Math.min(y0, ay, by); y1 = Math.max(y1, ay, by);
            const cx = Math.floor((ax + bx) / 2 / cell), cy = Math.floor((ay + by) / 2 / cell);
            if (cx >= 0 && cy >= 0 && cx < G && cy < G) grid[cy * G + cx] += Math.hypot(bx - ax, by - ay);
        }
    });
    const w = Math.max(0, Math.min(x1, WORLD) - Math.max(x0, 0)), h = Math.max(0, Math.min(y1, WORLD) - Math.max(y0, 0));
    // ink coverage per cell: line length × width / cell area
    const cov = Array.from(grid, v => (v * s.style.width * (1 + 2 * s.style.soft)) / (cell * cell)).filter(v => v > 0).sort((a, b) => a - b);
    const p97 = cov.length ? cov[Math.floor(cov.length * 0.97)] : 0;
    return { small: Math.min(w, h) / WORLD, occupied: cov.length / (G * G), p97, plot: budget.result() };
}

/** The design with this number. Same number, same design, everywhere. */
export function designFor(n: number): State {
    const mode = modeOf(n);
    let best: State | null = null, bestScore = -Infinity;
    for (let attempt = 0; attempt < (mode === "ink" ? 40 : 24); attempt++) {
        const r = makeRng(n * 7919 + attempt * 104729);
        const s = stack(r, mode);
        if (mode === "colour") colourStyle(r, s);
        const m = measure(s);
        let ok: boolean, score: number;
        if (mode === "colour") {
            // expose for the densest 3 % of the drawing: bright but not blown out
            const target = s.style.blend === "add" || s.style.blend === "screen" ? 1.8 : 1.3;
            s.style.alpha = +Math.min(0.85, Math.max(0.01, target / Math.max(m.p97, 1e-3))).toFixed(4);
            ok = m.small > 0.4 && m.occupied > 0.18;
            score = m.occupied + m.small;
        } else {
            ok = m.plot.pass && m.small > 0.45;
            score = (m.plot.pass ? 1 : 0) + m.small;
        }
        if (ok) { best = s; break; }
        if (score > bestScore) { best = s; bestScore = score; }
    }
    best!.design = n;
    return best!;
}

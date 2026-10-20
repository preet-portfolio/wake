// The numbered collection. Every number from 1 to DESIGNS is one fixed design:
// one in five is an "ink" piece (paper and pen, within the plot budget), the
// rest are "colour" pieces (light on dark, or pigment on paper).
// Candidates are judged on the CPU only (fill, exposure, plot budget), so a
// number gives the same design on every device.
import { runAll, SEG } from "./engine";
import { Budget } from "./export";
import { makeRng, type Rng } from "./rng";
import type { SpeciesKind } from "./species";
import { BLOCKS, DESIGNS, PALETTES, WORLD, defaultState, defaultStyle, newBlock, type Block, type BlockKind, type Palette, type SeedKind, type SignalKind, type State } from "./model";

export type Mode = "colour" | "ink";

export const modeOf = (n: number): Mode => (n % 5 === 0 ? "ink" : "colour");

/** Colour species and their weights: constellation is the rare one. */
export const SPECIES_WEIGHTS: [SpeciesKind, number][] = [
    ["flow", 0.16], ["orbit", 0.15], ["flock", 0.14], ["grid", 0.14],
    ["waves", 0.13], ["pulse", 0.13], ["growth", 0.12], ["constellation", 0.03],
];

/** The species of a number: decided first, from its own random stream. */
export function speciesOf(n: number): SpeciesKind {
    if (modeOf(n) === "ink") return "ink";
    const x = makeRng(n * 2654435 + 17)();
    let acc = 0;
    for (const [k, w] of SPECIES_WEIGHTS) if (x < (acc += w)) return k;
    return "flow";
}

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
    // the census showed contraction in every design was the waterfall; colour
    // flow keeps it only half the time, and sometimes expands instead
    const keepScale = mode === "ink" || r() < 0.5;
    if (!keepScale && r() < 0.4) scale.p.s.b = between(0.3, 1.2);
    if (keepScale || scale.p.s.b > 0) blocks.push(scale);
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

/** Parameters, ground and tempo for one of the behaviour species. */
function speciesDesign(n: number, kind: SpeciesKind): State {
    const r = makeRng(n * 7919 + 31337);
    const between = (a: number, b: number) => a + (b - a) * r();
    const int = (a: number, b: number) => Math.round(between(a, b));
    const s = defaultState();
    s.species = kind;
    s.blocks = [];
    s.seed = 1 + Math.floor(r() * 99999);
    colourStyle(r, s);
    const st = s.style;
    const sp: Record<string, number> = {};
    const centres = (k: number) => {
        sp.centres = k;
        for (let j = 0; j < k; j++) {
            sp[`cx${j}`] = Math.round(k === 1 ? between(420, 580) : between(200, 800));
            sp[`cy${j}`] = Math.round(k === 1 ? between(420, 580) : between(200, 800));
        }
    };
    switch (kind) {
        case "orbit": {
            const k = r() < 0.5 ? 1 : r() < 0.6 ? 2 : 3;
            centres(k);
            Object.assign(sp, { rmin: int(20, 150), rmax: Math.round(int(340, 500) / Math.sqrt(k)), spin: +between(0.3, 1.6).toFixed(2), ecc: +between(0, 0.15).toFixed(2), lobes: int(1, 5), flat: r() < 0.3 ? +between(0.55, 0.9).toFixed(2) : 1, mark: r() < 0.6 ? 0 : 1 });
            // dots keep short tails so they read as points; dashes can draw longer arcs
            s.live = { mode: "trails", trail: sp.mark === 0 ? int(3, 12) : int(10, 50), speed: +between(0.5, 1.4).toFixed(2) };
            st.width = +(sp.mark === 0 ? between(4, 9) : between(1.2, 2.4)).toFixed(2);
            st.soft = +between(0.4, 0.9).toFixed(2);
            break;
        }
        case "flock":
            // murmurations stream: strong alignment, weak cohesion, a wide view
            Object.assign(sp, { speed: +between(1.8, 3.8).toFixed(2), view: int(40, 80), sep: int(10, 20), align: +between(0.06, 0.14).toFixed(3), cohere: +between(0.0005, 0.003).toFixed(4), separate: +between(0.08, 0.15).toFixed(3), wander: +between(0.05, 0.2).toFixed(2) });
            if (r() < 0.8 && st.blend === "multiply") { // murmurations at dusk: mostly dark grounds
                st.paper = ["#0b0d14", "#0f0f1a", "#151026"][int(0, 2)]; st.paper2 = shade(st.paper, 0.5); st.blend = "add";
            }
            s.live = { mode: "trails", trail: int(10, 70), speed: +between(1, 1.8).toFixed(2) };
            st.width = +between(1, 2.2).toFixed(2);
            st.spread = 1; // colour by heading: the whole palette once around
            break;
        case "waves":
            Object.assign(sp, { rows: int(14, 60), amp: int(10, 70), freq: +between(1, 6).toFixed(2), tempo: +between(0.0015, 0.006).toFixed(4), phase: +between(0.1, 0.6).toFixed(2), amp2: r() < 0.4 ? int(2, 15) : 0 });
            s.live = { mode: "trails", trail: int(3, 12), speed: +between(0.6, 1).toFixed(2) };
            st.width = +between(0.8, 2.2).toFixed(2);
            if (r() < 0.35) { // Riley: black and white
                st.palette = null;
                const dark = r() < 0.5;
                st.paper = st.paper2 = dark ? "#0b0b0c" : "#f4f1ea";
                st.ink = dark ? "#f4f1ea" : "#0b0b0c";
                st.blend = "over"; st.soft = 0; st.grain = 0;
            }
            break;
        case "grid":
            Object.assign(sp, { rows: int(18, 70), margin: +between(0.08, 0.18).toFixed(2), tremble: +between(0.4, 2).toFixed(2), drift: +between(0.001, 0.004).toFixed(4), cross: r() < 0.5 ? 1 : 0 });
            s.live = { mode: "trails", trail: int(200, 500), speed: +between(0.2, 0.4).toFixed(2) };
            if (r() < 0.85) { // Martin: pale grounds, graphite or faint colour
                st.paper = ["#f3efe6", "#efe9df", "#f1ede8", "#ece6dc"][int(0, 3)];
                st.paper2 = st.paper;
                st.blend = "multiply";
                if (r() < 0.5) { st.palette = null; st.ink = ["#3b3a36", "#6b6359", "#7a6f8a", "#5d6b78"][int(0, 3)]; }
            }
            st.width = +between(0.6, 1.1).toFixed(2); st.soft = 0; st.grain = +between(0.1, 0.4).toFixed(2);
            break;
        case "growth":
            Object.assign(sp, { seeds: int(2, 6), from: int(0, 2), len: +between(1.8, 3.2).toFixed(2), turn: +between(0.08, 0.3).toFixed(2), split: +between(0.006, 0.016).toFixed(4), depth: int(6, 10), spread: +between(0.3, 0.7).toFixed(2) });
            s.live = { mode: "trails", trail: int(300, 700), speed: +between(1, 1.6).toFixed(2) };
            st.width = +between(0.8, 1.8).toFixed(2);
            break;
        case "pulse": {
            centres(r() < 0.6 ? 1 : r() < 0.6 ? 2 : 3);
            Object.assign(sp, { rings: int(6, 18), rmax: int(350, 600), speed: +between(0.6, 2.2).toFixed(2), wobble: +between(0, 0.2).toFixed(2), lobes: int(1, 4) });
            s.live = { mode: "trails", trail: int(6, 30), speed: +between(0.8, 1.3).toFixed(2) };
            st.width = +between(1, 2.5).toFixed(2);
            break;
        }
        case "constellation":
            Object.assign(sp, { stars: int(160, 380), reach: int(55, 105), drift: +between(0.15, 0.6).toFixed(2) });
            s.live = { mode: "trails", trail: int(2, 6), speed: +between(0.5, 0.8).toFixed(2) };
            st.paper = ["#05060b", "#0a0b14", "#07090f"][int(0, 2)]; st.paper2 = shade(st.paper, 0.5);
            st.blend = "add"; st.width = +between(1.2, 2.5).toFixed(2); st.soft = 0.6;
            break;
    }
    s.sp = sp;
    st.alpha = 0.35; // a starting point: the live view's auto-exposure takes it from here
    s.design = n;
    return s;
}

/** The design with this number. Same number, same design, everywhere. */
export function designFor(n: number): State {
    const kind = speciesOf(n);
    if (kind !== "flow" && kind !== "ink") return speciesDesign(n, kind);
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
    best!.species = kind;
    return best!;
}

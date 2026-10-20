import "./style.css";
import { Engine } from "./engine";
import { Renderer } from "./gl";
import { Sim, type Pointer } from "./sim";
import { hexToRgb, rotateHue } from "./color";
import { SPECIES_WEIGHTS, designFor, modeOf, speciesOf } from "./design";
import { BEHAVIOURS, SPECIES_INFO } from "./species";
import { BLOCKS, DESIGNS, WORLD, type State } from "./model";
import { encode, sanitize, shareUrl, stateFromLocation } from "./state";
import { Budget, budgetLines, download, stamp, svgFromLines, toSVG } from "./export";
import { buildPanel, h, initPanel, resetOpen } from "./panel";
import { report } from "./telemetry";
import { GrayScottGL } from "./grayscott-gl";
import { SCIENCE_CARDS, gsAt } from "./science-cards";
import { SCIENCE } from "./species";
import { morphology } from "./science/grayscott";
import katex from "katex";
import "katex/dist/katex.min.css";

const params = new URLSearchParams(location.search);
const INSTANT = params.has("instant");
/** still: the exact, finished drawing (tests, ?still links, plotting); live: the simulation */
const VIEW: "live" | "still" = INSTANT || params.has("still") ? "still" : "live";
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
if (INSTANT) document.body.classList.add("instant"); // render-only: no controls over the drawing
document.body.classList.add(VIEW); // "live" fills the window; "still" is the square drawing

const fresh = !/(s=[\w-]+|n=\d+)/.test(location.hash);
let state: State = stateFromLocation();
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const canvas = $<HTMLCanvasElement>("#art");
const stage = $<HTMLDivElement>(".stage");
const handles = $<HTMLDivElement>(".handles");
const meter = $<HTMLDivElement>(".budget");
const numberEl = $<HTMLDivElement>(".number");
const panelEl = $<HTMLElement>(".panel");
const renderer = new Renderer(canvas);

let dirty = true;
let paused = reducedMotion && VIEW === "live";
let variant: "" | "edited" = "";
let editing = false;

const dpr = () => Math.min(devicePixelRatio, 2);
/** Canvas size in device pixels: the whole window when live, a square when still. */
const canvasPx = (): [number, number] => {
    const w = Math.max(300, Math.round(canvas.clientWidth * dpr()));
    return VIEW === "live" ? [w, Math.max(300, Math.round(canvas.clientHeight * dpr()))] : [w, w];
};
/** World units (1000 across the shorter side, centred) ⇄ page pixels. */
function worldScale() {
    const r = canvas.getBoundingClientRect();
    return { r, k: Math.min(r.width, r.height) / WORLD, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
}
const style = () => {
    const st = state.style;
    return { c0: hexToRgb(st.paper), c1: hexToRgb(st.paper2) };
};

// ---------- still view: the exact drawing, step by step ----------

let engine: Engine;
let budget: Budget;
let finished = false;
let onFinish: (() => void) | null = null;

function stillRestart() {
    renderer.resize(...canvasPx());
    engine = new Engine(structuredClone(state));
    budget = new Budget();
    const { c0, c1 } = style();
    renderer.clear(c0, c1, state.style.grain, state.seed);
    finished = false;
}

function stillStep() {
    const s = engine.n;
    const c = engine.step();
    budget.add(engine.segs, c);
    const st = state.style;
    const ink = hexToRgb(st.ink);
    renderer.draw(engine.segs, c, {
        ink: st.hue ? rotateHue(ink, st.hue * s) : ink,
        palette: st.palette, spread: st.spread,
        phase: st.shift + (st.cycle * s) / Math.max(1, state.steps),
        blend: st.blend, soft: st.soft, alpha: st.alpha, width: st.width,
    });
}

// a behaviour species has no "finished drawing": its still view is the live
// simulation run for a fixed number of steps, which is deterministic
const STILL_STEPS = 180;
const isBehaviour = () => !!state.species && BEHAVIOURS.has(state.species);

function stillFrame() {
    if (isGS()) {
        if (dirty) {
            dirty = false;
            liveRestart();
            const { F, k } = gsAt(state.sp?.t ?? 0.3);
            gs!.run(2500, F, k);
            gsPresent();
            finished = false;
        }
        if (!finished) { finished = true; onFinish?.(); onFinish = null; }
        return;
    }
    if (isBehaviour()) {
        if (dirty) {
            dirty = false;
            liveRestart();
            // marks older than the trail have faded anyway: simulate those steps
            // without drawing, then draw only the stretch that is still visible
            const drawn = Math.min(STILL_STEPS, Math.max(20, Math.min(90, Math.round(state.live.trail * 1.5))));
            for (let k = 0; k < STILL_STEPS - drawn; k++) sim.step(pointer, gravity);
            for (let k = 0; k < drawn; k++) {
                liveFade(1);
                liveStep();
                if (k % 15 === 14) autoExpose();
            }
            renderer.trailsPresent(state.style.blend === "add" || state.style.blend === "screen");
            finished = false;
        }
        if (!finished) {
            finished = true;
            showBudget(budgetLines(sim.trace()));
            onFinish?.();
            onFinish = null;
        }
        return;
    }
    if (dirty) { stillRestart(); dirty = false; }
    if (!engine.done) {
        const until = performance.now() + (INSTANT ? 1e9 : 9);
        do stillStep(); while (!engine.done && performance.now() < until);
    }
    if (engine.done && !finished) {
        finished = true;
        showBudget(budget.result());
        onFinish?.();
        onFinish = null;
    }
}

// ---------- live view: the simulation ----------
// Particle counts are chosen per device: start from a guess, measure real
// frame time for two seconds, step down while frames are slow, up once if
// they are fast. It never pauses itself: a slow device gets fewer line-heads.

const TIERS = [500, 1000, 2000, 4000, 8000, 16000, 32000];
const coarse = matchMedia("(pointer: coarse)").matches;
let tier = coarse ? 3 : 4;
if (params.has("particles")) tier = Math.max(0, TIERS.indexOf(+params.get("particles")!));
let sim: Sim;
let exposure = 1;
let acc = 0;
let lastTime = performance.now();
let liveFrames = 0;
let tierClock = { start: 0, frames: 0, sum: 0, settled: params.has("particles") };
const pointer: Pointer & { lastMove: number; down: boolean } = { x: 0, y: 0, vx: 0, vy: 0, mode: "none", lastMove: 0, down: false };
let gravity: [number, number] = [0, 0];

// slow tiers draw at a lower resolution: the full-screen passes (fade, present)
// cost more than the line-heads on a device without a fast GPU
const tierScale = () => (tier === 0 ? 0.35 : tier === 1 ? 0.5 : tier === 2 ? 0.75 : 1);

// ---------- Turing patterns: a field on the GPU, not line-heads ----------
const isGS = () => state.species === "grayscott";
let gs: GrayScottGL | null = null;

function gsPresent() {
    const st = state.style;
    gs!.present(renderer.canvas.width, renderer.canvas.height, hexToRgb(st.paper), hexToRgb(st.ink), st.palette, st.shift);
}

function liveRestart() {
    const [w, h] = canvasPx();
    const cs = Math.max(0.5, tierScale()), ts = tierScale();
    renderer.resize(Math.round(w * cs), Math.round(h * cs));
    sim = new Sim(structuredClone(state), isGS() ? 1 : TIERS[tier], renderer.bounds);
    if (isGS()) {
        gs ??= new GrayScottGL(renderer.gl);
        // about one cell per two CSS pixels, fewer on slow devices
        const cap = tier >= 3 ? 512 : 256, k = Math.min(1, cap / Math.max(w, h) * dpr()) / 2;
        gs.reset(Math.max(64, Math.round((w / dpr()) * k * dpr())), Math.max(64, Math.round((h / dpr()) * k * dpr())), state.seed);
        return;
    }
    const { c0, c1 } = style();
    renderer.trailsReset(Math.round(w * ts), Math.round(h * ts), c0, c1, state.style.grain, state.seed);
    acc = 0;
}

function liveFade(steps: number) {
    const { c0, c1 } = style();
    // one fade pass per frame, as strong as `steps` single-step fades
    renderer.trailsFade(1 - Math.exp((-3 * steps) / state.live.trail), c0, c1, state.style.grain, state.seed, sim.frame);
}

function liveStep() {
    const st = state.style;
    sim.step(pointer, gravity);
    const ink = hexToRgb(st.ink);
    renderer.draw(sim.segs, sim.count, {
        ink: st.hue ? rotateHue(ink, st.hue * sim.frame) : ink,
        palette: st.palette, spread: st.spread,
        phase: st.shift + (st.cycle * sim.frame) / Math.max(1, state.steps),
        blend: st.blend, soft: st.soft,
        // fewer line-heads on a slow device would look dimmer; compensate
        alpha: Math.min(1, st.alpha * exposure * Math.sqrt(8000 / TIERS[tier])),
        width: st.width,
    });
}

// Automatic exposure: keep the brightest marks bright (on dark grounds) or
// the darkest marks dark (on light grounds), whatever the design and device.
function autoExpose() {
    const lum = renderer.trailsProbe();
    const sorted = Array.from(lum).sort((a, b) => a - b);
    const N = sorted.length;
    const dark = hexToRgb(state.style.paper).reduce((a, b) => a + b) / 3 < 0.5;
    let k: number;
    if (dark) {
        // percentiles can't tell "slightly" from "far" too bright once pixels clip,
        // so the share of near-white pixels drives it down first
        const clipped = sorted.filter(v => v >= 247).length / N;
        k = clipped > 0.015 ? 0.7 : Math.pow(215 / Math.max(8, sorted[Math.floor(N * 0.97)]), 0.6);
    } else {
        const crushed = sorted.filter(v => v <= 12).length / N;
        k = crushed > 0.015 ? 0.7 : Math.pow((255 - 135) / Math.max(4, 255 - sorted[Math.floor(N * 0.03)]), 0.6);
    }
    // the floor is low: Lorenz twins start thousands-deep on one line
    exposure = Math.min(40, Math.max(0.0003, exposure * Math.min(1.3, Math.max(0.7, k))));
}

function liveFrame(now: number) {
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    if (dirty) { liveRestart(); dirty = false; }
    if (!pointer.down && now - pointer.lastMove > 80) { pointer.vx *= 0.5; pointer.vy *= 0.5; if (pointer.mode === "stir" && Math.abs(pointer.vx) + Math.abs(pointer.vy) < 0.05) pointer.mode = "none"; }
    if (isGS()) {
        if (!paused) {
            const { F, k } = gsAt(state.sp?.t ?? 0.3);
            // touching drops fresh chemical where you are
            const b = renderer.bounds;
            const brush: [number, number, number] | null = pointer.mode !== "none"
                ? [((pointer.x - b.x0) / (b.x1 - b.x0)) * gs!.w, (1 - (pointer.y - b.y0) / (b.y1 - b.y0)) * gs!.h, 4]
                : null;
            // links are untrusted: steps per frame stay within what any GPU can do
            const iters = Math.min(40, Math.max(1, state.sp?.iters ?? 12));
            gs!.run(Math.max(1, Math.round(iters * state.live.speed)), F, k, brush);
            settleTier(now, dt);
        }
        gsPresent();
        updateCardReadout();
        return;
    }
    if (!paused) {
        acc += dt * 60 * state.live.speed;
        // on slow frames, catching up would only make the next frame slower
        const steps = Math.min(dt > 0.05 ? 1 : 4, Math.floor(acc));
        acc = steps ? acc - Math.floor(acc) : acc;
        if (steps) liveFade(steps);
        for (let i = 0; i < steps; i++) liveStep();
        liveFrames++;
        if (liveFrames % (liveFrames < 120 ? 10 : 45) === 0) autoExpose();
        settleTier(now, dt);
    }
    renderer.trailsPresent(state.style.blend === "add" || state.style.blend === "screen");
    updateCardReadout();
}

function settleTier(now: number, dt: number) {
    if (tierClock.settled) return;
    if (!tierClock.start) { tierClock.start = now; return; }
    if (now - tierClock.start < 300) return; // warm-up
    tierClock.frames++;
    tierClock.sum += dt;
    if (now - tierClock.start < 2300) return;
    const avg = (tierClock.sum / tierClock.frames) * 1000;
    if (avg > 24 && tier > 0) { tier--; dirty = true; tierClock = { start: now, frames: 0, sum: 0, settled: false }; }
    else if (avg < 11 && tier < TIERS.length - 1 && !coarse) { tier++; dirty = true; tierClock = { start: 0, frames: 0, sum: 0, settled: true }; }
    else tierClock.settled = true;
    if (tierClock.settled) report({ particles: TIERS[tier], frameMs: avg, renderer: glName() });
}

function glName() {
    const gl = renderer.gl, ext = gl.getExtension("WEBGL_debug_renderer_info");
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
}

// ---------- the loop ----------

function frame(now: number) {
    if (VIEW === "live") liveFrame(now);
    else stillFrame();
    fps.tick();
    requestAnimationFrame(frame);
}

const fps = {
    el: $<HTMLDivElement>(".fps"),
    frames: [] as number[],
    value: 0,
    tick() {
        const now = performance.now();
        this.frames.push(now);
        while (this.frames.length && this.frames[0] < now - 1000) this.frames.shift();
        this.value = this.frames.length;
        if (params.has("fps")) this.el.textContent = VIEW === "live" ? `${this.value} fps · ${TIERS[tier].toLocaleString()} line-heads${tierClock.settled ? "" : " · measuring"}` : `${this.value} fps`;
    },
};
if (params.has("fps")) fps.el.hidden = false;

// ---------- state changes ----------

/**
 * Change the state: the drawing restarts and the URL follows. An untouched
 * collection design gets its short #n= link; anything else the full #s= state.
 */
function commit(rebuildPanel = false, byUser = true) {
    dirty = true;
    if (byUser && state.design) variant = "edited";
    if (state.design && !variant) history.replaceState(null, "", `${location.search}#n=${state.design}`);
    else history.replaceState(null, "", `${location.search}#s=${encode(state)}`);
    if (rebuildPanel && editing) buildPanel();
    placeHandles();
    renderNumber();
    renderCard();
    document.body.style.background = state.style.paper2;
    document.body.classList.toggle("dark", hexToRgb(state.style.paper).reduce((a, b) => a + b) / 3 < 0.5);
}

function showDesign(n: number) {
    state = designFor(n);
    resetOpen();
    variant = "";
    cardOpen = SCIENCE.includes(state.species!); // science opens its card: the point is to understand it
    commit(true, false);
}
// Discovery order: a shuffled bag of species. Every common species comes up
// once per round in random order, the rare one every third round, and the
// first of a round is never the species already on screen.
const ALL_SPECIES = [...SPECIES_WEIGHTS.map(([k]) => k), "ink", ...SCIENCE] as const;
let bag: string[] = [];
let round = 0;
function nextSpecies(current: string | undefined): string {
    if (!bag.length) {
        bag = ALL_SPECIES.filter(k => k !== "constellation" || round % 3 === 0);
        for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
        if (bag[0] === current) bag.push(bag.shift()!);
        round++;
    }
    return bag.shift()!;
}

// species whose first second is nearly still (measured: growth 0.05–1.3 % of pixels
// change, Lorenz 0.3–1.1 %, every other species ≥ 1.4 %): never a visitor's very
// first design, so the page is visibly alive from the start
const CALM = new Set(["growth", "lorenz"]);

/** A random design of the next species in the bag (the opening one always moves visibly). */
function newDesign(opening = false) {
    let want = nextSpecies(state.design ? speciesOf(state.design) : state.species);
    if (opening && CALM.has(want)) { bag.push(want); want = nextSpecies(want); }
    for (;;) {
        const n = 1 + Math.floor(Math.random() * DESIGNS);
        if (speciesOf(n) === want) return showDesign(n);
    }
}

// ---------- the ⓘ card: what you're looking at, and one control that shows it ----------

const cardEl = $<HTMLElement>(".card");
let cardOpen = false;
let readoutEl: HTMLElement | null = null;

function renderCard() {
    const kind = state.species;
    const card = kind ? SCIENCE_CARDS[kind] : undefined;
    $<HTMLButtonElement>("#info").hidden = !kind;
    cardEl.hidden = !(cardOpen && kind);
    if (!kind) return;
    const info = SPECIES_INFO[kind];
    const kids: (Node | string)[] = [h("h3", {}, info.name), h("p", {}, card ? card.sentence : info.hint)];
    readoutEl = null;
    if (card) {
        const eq = h("div", { class: "eq" });
        // the TeX is our own constant (science-cards.ts), never user input
        eq.innerHTML = katex.renderToString(card.tex, { displayMode: true, throwOnError: false, output: "html" });
        const a = card.aha, sp = (state.sp ??= {});
        const out = h("output", {}, a.show(sp[a.key] ?? a.min));
        const input = h("input", { type: "range", min: a.min, max: a.max, step: a.step, value: sp[a.key] ?? a.min, "aria-label": a.key }) as HTMLInputElement;
        input.addEventListener("input", () => {
            const v = +input.value;
            sp[a.key] = v;
            out.textContent = a.show(v);
            if (a.restart) commit();
            else {
                // live: the running system feels the change without starting over
                if (sim?.state.sp) sim.state.sp[a.key] = v;
                variant = "edited";
                history.replaceState(null, "", `${location.search}#s=${encode(state)}`);
                renderNumber();
            }
        });
        readoutEl = kind === "kuramoto" ? h("div", { class: "readout" }) : null;
        kids.push(eq, h("label", { class: "aha" }, input, out), ...(readoutEl ? [readoutEl] : []), h("p", { class: "source" }, card.source));
    }
    cardEl.replaceChildren(...kids);
}

function updateCardReadout() {
    if (!readoutEl || !sim?.extra || state.species !== "kuramoto" || sim.frame % 6) return;
    const r = sim.extra.r as number;
    readoutEl.textContent = `order r = ${r.toFixed(2)} ${"▮".repeat(Math.round(r * 20))}`;
}

$("#info").addEventListener("click", () => { cardOpen = !cardOpen; renderCard(); });

function renderNumber() {
    const n = state.design;
    const sp = state.species ? ` · ${SPECIES_INFO[state.species].name}` : "";
    numberEl.textContent = n ? `No. ${n.toLocaleString("en-US")}${sp}${variant ? " · edited" : ""}` : `your own design${sp}`;
    numberEl.title = n ? `${modeOf(n) === "ink" ? "an ink piece, made for plotting" : "a colour piece"} from a collection of ${DESIGNS.toLocaleString("en-US")}` : "";
}

function showBudget(b: ReturnType<Budget["result"]>) {
    const st = state.style;
    if (!b.pass && (st.palette || st.blend === "add" || st.blend === "screen")) {
        meter.className = "budget screen";
        meter.replaceChildren(h("b", {}, "screen piece"), " made of light");
        meter.title = `As a plot: ${b.minutes.toFixed(0)} min, density ${b.coverage.toFixed(1)} (limits 45 min, 1.5).`;
        return;
    }
    meter.className = `budget ${b.pass ? "ok" : "over"}`;
    meter.replaceChildren(h("b", {}, b.pass ? "plottable" : "too much ink"), ` ${b.minutes.toFixed(0)} min · ${b.metres.toFixed(0)} m · density ${b.coverage.toFixed(1)}`);
    meter.title = "Estimate for A4, 0.3 mm pen. Limits: 45 min and density 1.5. tools/plotcheck.py has the final say.";
}

// ---------- the viewer as a force ----------
// Tap: a new design. Drag: stir. Hold still: pull. Right-drag, shift or two
// fingers: push. Hovering with a mouse stirs gently. Tilting a phone tips the flow.

const toWorld = (e: { clientX: number; clientY: number }): [number, number] => {
    const { k, cx, cy } = worldScale();
    return [WORLD / 2 + (e.clientX - cx) / k, WORLD / 2 + (e.clientY - cy) / k];
};
let press = { t: 0, x: 0, y: 0, moved: 0, id: -1, touches: 0 };
let holdTimer = 0;

function movePointer(e: PointerEvent) {
    const [x, y] = toWorld(e);
    const now = performance.now();
    const dtSteps = Math.max(1, ((now - pointer.lastMove) / 1000) * 60);
    if (pointer.lastMove) { pointer.vx = (x - pointer.x) / dtSteps; pointer.vy = (y - pointer.y) / dtSteps; }
    pointer.x = x; pointer.y = y; pointer.lastMove = now;
}

canvas.addEventListener("pointerdown", e => {
    if (VIEW !== "live" || stage.classList.contains("drawing")) return;
    canvas.setPointerCapture(e.pointerId);
    press = { t: performance.now(), x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId, touches: press.touches + 1 };
    pointer.down = true;
    pointer.lastMove = 0;
    movePointer(e);
    pointer.mode = e.button === 2 || e.shiftKey || press.touches > 1 ? "push" : "stir";
    clearTimeout(holdTimer);
    holdTimer = window.setTimeout(() => { if (pointer.down && press.moved < 10 && pointer.mode !== "push") pointer.mode = "attract"; }, 280);
    askForTilt();
});
canvas.addEventListener("pointermove", e => {
    if (VIEW !== "live") return;
    if (pointer.down) press.moved = Math.max(press.moved, Math.hypot(e.clientX - press.x, e.clientY - press.y));
    movePointer(e);
    if (!pointer.down && e.pointerType === "mouse") pointer.mode = "stir";
    if (pointer.down && pointer.mode === "attract" && press.moved > 10) pointer.mode = "stir";
});
const release = (e: PointerEvent) => {
    if (VIEW !== "live") return;
    press.touches = Math.max(0, press.touches - 1);
    clearTimeout(holdTimer);
    const tap = performance.now() - press.t < 250 && press.moved < 8 && e.pointerId === press.id;
    pointer.down = false;
    pointer.mode = "none";
    if (tap && !editing) newDesign();
};
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);
canvas.addEventListener("pointerleave", () => { if (!pointer.down) pointer.mode = "none"; });
canvas.addEventListener("contextmenu", e => e.preventDefault());

let tiltAsked = false;
function askForTilt() {
    if (tiltAsked || !coarse) return;
    tiltAsked = true;
    const listen = () => addEventListener("deviceorientation", e => {
        if (e.gamma == null || e.beta == null) return;
        gravity = [Math.max(-1, Math.min(1, e.gamma / 45)) * 0.25, Math.max(-1, Math.min(1, (e.beta - 40) / 45)) * 0.25];
    });
    const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof D.requestPermission === "function") D.requestPermission().then(r => r === "granted" && listen()).catch(() => {});
    else listen();
}

addEventListener("keydown", e => {
    if ((e.target as HTMLElement).closest("input, select, textarea, button")) return;
    if (e.code === "Space") { e.preventDefault(); newDesign(); }
    if (e.key === "f") toggleFullscreen();
});

// ---------- direct handles (while editing) ----------

type Handle = { label: string; get: () => [number, number]; set: (x: number, y: number) => void; main?: boolean };

function handleList(): Handle[] {
    const s = state.shape;
    const list: Handle[] = [
        { label: "centre", main: true, get: () => [s.cx, s.cy], set: (x, y) => { s.cx = x; s.cy = y; } },
        { label: "size", main: true, get: () => [s.cx + s.r, s.cy], set: x => { s.r = Math.max(20, Math.round(x - s.cx)); } },
    ];
    state.blocks.forEach(b => {
        if (!b.on) return;
        const xy = b.k === "attract" ? ["x", "y"] : ["ox", "oy"];
        if (!b.p[xy[0]]) return;
        list.push({ label: `${BLOCKS[b.k].label} origin`, get: () => [b.p[xy[0]].b, b.p[xy[1]].b], set: (x, y) => { b.p[xy[0]].b = Math.round(x); b.p[xy[1]].b = Math.round(y); } });
    });
    return list;
}

function placeHandles() {
    if (!editing) { handles.replaceChildren(); return; }
    const base = stage.getBoundingClientRect();
    const at = (x: number, y: number) => {
        const { k, cx, cy } = worldScale();
        return `left:${cx - base.left + (x - WORLD / 2) * k}px;top:${cy - base.top + (y - WORLD / 2) * k}px`;
    };
    handles.replaceChildren(...handleList().map(hd => {
        const el = h("div", { class: `handle${hd.main ? " main" : ""}`, title: `drag: ${hd.label}`, style: at(...hd.get()) }, h("span", {}, hd.label));
        el.addEventListener("pointerdown", e => {
            el.setPointerCapture(e.pointerId);
            const moveTo = (ev: PointerEvent) => {
                hd.set(...toWorld(ev));
                el.setAttribute("style", at(...hd.get()));
                dirty = true;
            };
            el.addEventListener("pointermove", moveTo);
            el.addEventListener("pointerup", () => { el.removeEventListener("pointermove", moveTo); commit(true); }, { once: true });
        });
        return el;
    }));
}

function startDrawing() {
    stage.classList.add("drawing");
    const path: number[] = [];
    const down = (e: PointerEvent) => { canvas.setPointerCapture(e.pointerId); path.push(...toWorld(e)); canvas.addEventListener("pointermove", move); };
    const move = (e: PointerEvent) => path.push(...toWorld(e).map(Math.round));
    const up = () => {
        canvas.removeEventListener("pointerdown", down);
        canvas.removeEventListener("pointermove", move);
        stage.classList.remove("drawing");
        if (path.length >= 8) { state.shape.kind = "drawn"; state.shape.path = path; }
        commit(true);
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointerup", up, { once: true });
}

initPanel({ get state() { return state; }, root: $<HTMLElement>(".panel-body"), commit, startDrawing });

function setEditing(on: boolean) {
    editing = on;
    panelEl.hidden = !on;
    document.body.classList.toggle("editing", on);
    $<HTMLButtonElement>("#edit").setAttribute("aria-pressed", String(on));
    if (on) buildPanel();
    placeHandles();
}

// ---------- actions ----------

function flash(sel: string, text: string) {
    const b = $<HTMLButtonElement>(sel), old = b.textContent;
    b.textContent = text;
    setTimeout(() => (b.textContent = old), 1600);
}

$("#new").addEventListener("click", () => newDesign());

// fullscreen, and controls that step aside when you're just watching
function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
}
$("#full").addEventListener("click", toggleFullscreen);
if (!document.fullscreenEnabled) $("#full").hidden = true; // e.g. iPhone Safari can't fullscreen a page
document.addEventListener("fullscreenchange", () => { $("#full").textContent = document.fullscreenElement ? "exit" : "⤢ full"; dirty = true; });

const bootTime = performance.now();
let idleTimer = 0;
function wake() {
    document.body.classList.remove("idle");
    clearTimeout(idleTimer);
    // always visible for the first 5 s, then hidden after 3 s of stillness
    const wait = Math.max(3000, 5000 - (performance.now() - bootTime));
    idleTimer = window.setTimeout(() => { if (!editing && VIEW === "live") document.body.classList.add("idle"); }, wait);
}
for (const ev of ["pointermove", "pointerdown", "keydown", "touchstart"]) addEventListener(ev, wake, { passive: true });
wake();
$("#edit").addEventListener("click", () => setEditing(!editing));
$("#close").addEventListener("click", () => setEditing(false));
$("#pause").addEventListener("click", () => {
    paused = !paused;
    $("#pause").textContent = paused ? "▶" : "❚❚";
    $("#pause").title = paused ? "play" : "pause";
});
$("#share").addEventListener("click", async () => {
    const url = state.design && !variant ? `${location.origin}${location.pathname}#n=${state.design}` : shareUrl(state);
    await navigator.clipboard?.writeText(url).catch(() => {});
    flash("#share", "copied");
});
$("#png").addEventListener("click", () => canvas.toBlob(b => b && download(`wake-${stamp()}.png`, b)));
$("#plot").addEventListener("click", () => {
    // freeze & plot: hold time still and trace the current line-heads through one lifetime
    const traced = VIEW === "live" || isBehaviour();
    if (VIEW === "live" && !paused) $("#pause").click();
    const lines = traced ? sim.trace() : [];
    const svg = traced ? svgFromLines(lines, state.style.width, shareUrl(state)) : toSVG(state, shareUrl(state));
    download(`wake-${stamp()}.svg`, new Blob([svg], { type: "image/svg+xml" }));
    const b = traced ? budgetLines(lines) : budget.result();
    toast(b.pass
        ? `SVG saved · about ${Math.max(1, Math.round(b.minutes))} min to plot on A4 · density ${b.coverage.toFixed(1)} ✓`
        : `SVG saved · too dense for a pen (density ${b.coverage.toFixed(1)}, limit 1.5) · try a shorter trail or fewer line-heads`);
});
$("#video").addEventListener("click", () => {
    const rec = new MediaRecorder(canvas.captureStream(60), { mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm" });
    const chunks: Blob[] = [];
    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = () => download(`wake-${stamp()}.webm`, new Blob(chunks, { type: "video/webm" }));
    rec.start();
    flash("#video", "● 8 s");
    setTimeout(() => rec.stop(), 8000);
});

let toastTimer = 0;
function toast(text: string) {
    const t = $<HTMLDivElement>(".toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (t.hidden = true), 5000);
}

// ---------- boot ----------

addEventListener("hashchange", () => {
    if (!/(s=[\w-]+|n=\d+)/.test(location.hash)) return;
    const next = stateFromLocation();
    if (encode(next) === encode(state)) return; // our own replaceState echoing back
    state = next;
    variant = "";
    cardOpen = SCIENCE.includes(state.species!);
    commit(true, false);
});
new ResizeObserver(() => { dirty = true; placeHandles(); }).observe(stage);
if (fresh && !INSTANT) newDesign(true); // every visit starts from a new, visibly moving design
else {
    cardOpen = !INSTANT && SCIENCE.includes(state.species!); // a science link opens with its explanation
    commit(false, false);
}
setEditing(params.has("edit"));
if (paused) { $("#pause").textContent = "▶"; $("#pause").title = "play"; }
requestAnimationFrame(frame);

// hooks for tests and the console
declare global { interface Window { wake: unknown } }
window.wake = {
    get state() { return state; },
    set(s: State) { state = sanitize(s); commit(true); },
    newDesign,
    // still view: resolves once fonts have loaded, layout has settled and the drawing is complete
    async whenDone() {
        await document.fonts.ready;
        if (VIEW === "live") { await new Promise(r => setTimeout(r, 300)); return; }
        for (;;) {
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            if (finished && !dirty) return;
            await new Promise<void>(res => (onFinish = res));
        }
    },
    svg: () => (isBehaviour() ? svgFromLines(new Sim(state, 4000).trace(), state.style.width) : toSVG(state)),
    speciesOf,
    // still view: draw a state up to step k right now and return a PNG (for GIFs and docs)
    snapshot(s: State, k: number, px = 360) {
        state = sanitize(s);
        stillRestart();
        while (!engine.done && engine.n <= k) stillStep();
        dirty = true;
        const c = document.createElement("canvas");
        c.width = c.height = px;
        c.getContext("2d")!.drawImage(canvas, 0, 0, px, px);
        return c.toDataURL("image/png");
    },
    budget: () => (VIEW === "live" ? budgetLines(sim.trace()) : budget.result()),
    fps: () => fps.value,
    // motion census: how uniform the direction is (0 = every way, 1 = all one way),
    // how much it streams toward the centre (-1 out, +1 in) and the mean speed in world units per step
    // GPU Gray–Scott on a square grid, read back and described (for the GPU-vs-CPU test)
    grayscott(F: number, k: number, size = 128, steps = 6000) {
        const g = new GrayScottGL(renderer.gl);
        g.reset(size, size, 1, 12); // the CPU reference's exact starting field
        for (let i = 0; i < steps; i += 500) g.run(Math.min(500, steps - i), F, k);
        const v = g.readV();
        dirty = true;
        return { ...morphology(v, size), v: Array.from(v) };
    },
    motion: () => {
        if (VIEW !== "live" || isGS()) return null;
        let sx = 0, sy = 0, inward = 0, speed = 0, n = 0;
        for (let i = 0; i < sim.n; i++) {
            const vx = sim.x[i] - sim.px[i], vy = sim.y[i] - sim.py[i], v = Math.hypot(vx, vy);
            if (!(v > 1e-4) || !isFinite(v)) continue;
            const cx = WORLD / 2 - sim.x[i], cy = WORLD / 2 - sim.y[i], c = Math.hypot(cx, cy) || 1;
            sx += vx / v; sy += vy / v; inward += (vx * cx + vy * cy) / (v * c); speed += v; n++;
        }
        return n ? { uniformity: Math.hypot(sx, sy) / n, inward: inward / n, speed: speed / n, moving: n / sim.n } : { uniformity: 0, inward: 0, speed: 0, moving: 0 };
    },
    live: () => (VIEW === "live" ? { frame: sim.frame, particles: TIERS[tier], settled: tierClock.settled, exposure, paused } : null),
};

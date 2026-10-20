import "./style.css";
import { Engine } from "./engine";
import { Renderer } from "./gl";
import { Sim, type Pointer } from "./sim";
import { hexToRgb, rotateHue } from "./color";
import { designFor, modeOf } from "./design";
import { BLOCKS, DESIGNS, WORLD, type State } from "./model";
import { encode, sanitize, shareUrl, stateFromLocation } from "./state";
import { Budget, budgetLines, download, stamp, svgFromLines, toSVG } from "./export";
import { buildPanel, h, initPanel, resetOpen } from "./panel";
import { report } from "./telemetry";

const params = new URLSearchParams(location.search);
const INSTANT = params.has("instant");
/** still: the exact, finished drawing (tests, ?still links, plotting); live: the simulation */
const VIEW: "live" | "still" = INSTANT || params.has("still") ? "still" : "live";
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
if (INSTANT) document.body.classList.add("instant"); // render-only: no controls over the drawing

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

const canvasPx = () => Math.max(300, Math.round(canvas.clientWidth * Math.min(devicePixelRatio, 2)));
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
    renderer.resize(canvasPx());
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

function stillFrame() {
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

function liveRestart() {
    renderer.resize(Math.round(canvasPx() * Math.max(0.5, tierScale())));
    sim = new Sim(structuredClone(state), TIERS[tier]);
    const px = Math.round(canvasPx() * tierScale());
    const { c0, c1 } = style();
    renderer.trailsReset(px, c0, c1, state.style.grain, state.seed);
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
    exposure = Math.min(40, Math.max(0.01, exposure * Math.min(1.3, Math.max(0.7, k))));
}

function liveFrame(now: number) {
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    if (dirty) { liveRestart(); dirty = false; }
    if (!pointer.down && now - pointer.lastMove > 80) { pointer.vx *= 0.5; pointer.vy *= 0.5; if (pointer.mode === "stir" && Math.abs(pointer.vx) + Math.abs(pointer.vy) < 0.05) pointer.mode = "none"; }
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
    document.body.style.background = state.style.paper2;
    document.body.classList.toggle("dark", hexToRgb(state.style.paper).reduce((a, b) => a + b) / 3 < 0.5);
}

function showDesign(n: number) {
    state = designFor(n);
    resetOpen();
    variant = "";
    commit(true, false);
}
const newDesign = () => showDesign(1 + Math.floor(Math.random() * DESIGNS));

function renderNumber() {
    const n = state.design;
    numberEl.textContent = n ? `No. ${n.toLocaleString("en-US")}${variant ? " · edited" : ""}` : "your own design";
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

const toWorld = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * WORLD, ((e.clientY - r.top) / r.height) * WORLD];
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
    const rect = canvas.getBoundingClientRect(), base = stage.getBoundingClientRect();
    const k = rect.width / WORLD;
    handles.replaceChildren(...handleList().map(hd => {
        const [x, y] = hd.get();
        const el = h("div", { class: `handle${hd.main ? " main" : ""}`, title: `drag: ${hd.label}`, style: `left:${rect.left - base.left + x * k}px;top:${rect.top - base.top + y * k}px` }, h("span", {}, hd.label));
        el.addEventListener("pointerdown", e => {
            el.setPointerCapture(e.pointerId);
            const moveTo = (ev: PointerEvent) => {
                const r = canvas.getBoundingClientRect();
                hd.set(((ev.clientX - r.left) / r.width) * WORLD, ((ev.clientY - r.top) / r.height) * WORLD);
                const [nx, ny] = hd.get();
                el.style.left = `${r.left - base.left + nx * k}px`;
                el.style.top = `${r.top - base.top + ny * k}px`;
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

$("#new").addEventListener("click", newDesign);
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
    let lines: number[][];
    if (VIEW === "live") {
        if (!paused) $("#pause").click();
        lines = sim.trace();
    } else lines = [];
    const svg = VIEW === "live" ? svgFromLines(lines, state.style.width, shareUrl(state)) : toSVG(state, shareUrl(state));
    download(`wake-${stamp()}.svg`, new Blob([svg], { type: "image/svg+xml" }));
    const b = VIEW === "live" ? budgetLines(lines) : budget.result();
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
    commit(true, false);
});
new ResizeObserver(() => { dirty = true; placeHandles(); }).observe(stage);
if (fresh && !INSTANT) newDesign(); // every visit starts from a new design
else commit(false, false);
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
    svg: () => toSVG(state),
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
    live: () => (VIEW === "live" ? { frame: sim.frame, particles: TIERS[tier], settled: tierClock.settled, exposure, paused } : null),
};

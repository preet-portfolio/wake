import "./style.css";
import { Engine } from "./engine";
import { designFor, modeOf, randomDesign } from "./design";
import { Renderer } from "./gl";
import { hexToRgb, rotateHue } from "./color";
import { BLOCKS, DESIGNS, PALETTES, WORLD, newBlock, paletteRgb, type Blend, type Block, type BlockKind, type Palette, type Param, type SeedKind, type SignalKind, type State } from "./model";
import { encode, sanitize, shareUrl, stateFromLocation } from "./state";
import { Budget, download, stamp, toSVG } from "./export";

const params = new URLSearchParams(location.search);
const INSTANT = params.has("instant");

const fresh = !/(s=[\w-]+|n=\d+)/.test(location.hash);
let state: State = stateFromLocation();
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const canvas = $<HTMLCanvasElement>("#art");
const stage = $<HTMLDivElement>(".stage");
const handles = $<HTMLDivElement>(".handles");
const panel = $<HTMLDivElement>(".panel-body");
const meter = $<HTMLDivElement>(".budget");
const renderer = new Renderer(canvas);

// ---------- player ----------

let engine: Engine;
let budget: Budget;
let current: State = state;   // what is on the canvas: the state, or a drifted copy of it
let dirty = true;
let finished = false;
let onFinish: (() => void) | null = null;

// ---------- drift ----------
// A fresh visit gets a new design, and it keeps shifting by itself: every
// parameter breathes slowly around the value you set. Holding it freezes the
// current frame into the state. Shared links open still, exactly as shared.

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let drifting = fresh && !INSTANT && !params.has("still");
let driftHeld = reducedMotion;
let phase = 0;
let lastTime = performance.now();
let lastBudgetShown = 0;
let frameMs = 0;      // smoothed real time between frames while drifting
let driftFrames = 0;

const isDrifting = () => drifting && !driftHeld;

function drifted(s: State, t: number): State {
    const d = structuredClone(s);
    d.blocks.forEach((b, j) => {
        BLOCKS[b.k].params.forEach(([name, , lo, hi], k) => {
            if (name === "f" || name === "dir") return; // integer-ish knobs would pop
            const p = b.p[name];
            const origin = /^(ox|oy|x|y)$/.test(name);
            const amp = origin ? 70 : (k === 0 ? 0.06 : 0.03) * (hi - lo);
            const w = 0.07 + 0.05 * ((j * 7 + k * 3) % 5);
            p.b = Math.min(hi, Math.max(lo, p.b + amp * Math.sin(t * w + j * 1.7 + k * 2.3)));
        });
    });
    d.shape.rot = (s.shape.rot + 25 * Math.sin(t * 0.05)) % 360;
    d.style.shift = s.style.shift + t * 0.015; // colours slowly flow
    d.shape.r = s.shape.r * (1 + 0.04 * Math.sin(t * 0.09 + 1));
    return d;
}

const shown = (): State => (isDrifting() ? drifted(state, phase) : state);

function restart() {
    const px = Math.round(Math.min(stage.clientWidth, stage.clientHeight) * Math.min(devicePixelRatio, 2));
    renderer.resize(Math.max(px, 300));
    current = shown();
    engine = new Engine(structuredClone(current));
    budget = new Budget();
    const st = current.style;
    renderer.clear(hexToRgb(st.paper), hexToRgb(st.paper2), st.grain, current.seed);
    finished = false;
    dirty = false;
}

function stepOnce() {
    const s = engine.n;
    const c = engine.step();
    budget.add(engine.segs, c);
    const st = current.style;
    const ink = hexToRgb(st.ink);
    renderer.draw(engine.segs, c, {
        ink: st.hue ? rotateHue(ink, st.hue * s) : ink,
        palette: st.palette,
        spread: st.spread,
        phase: st.shift + (st.cycle * s) / Math.max(1, current.steps),
        blend: st.blend,
        soft: st.soft,
        alpha: st.alpha,
        width: st.width,
    });
}

function frame(now: number) {
    const raw = now - lastTime;
    const dt = Math.min(0.1, raw / 1000);
    lastTime = now;
    // Drift redraws the whole drawing every frame. If this device can't do that
    // smoothly (slow GPU, software GL, a very heavy design), drift holds itself
    // on the current frame instead of stuttering; "▶ drift" tries again.
    if (isDrifting()) {
        // judge by real frame time (it includes the browser presenting the frame),
        // skipping the first two frames of warm-up
        driftFrames++;
        if (driftFrames > 2) frameMs = driftFrames === 3 ? raw : frameMs * 0.7 + raw * 0.3;
        const slow = driftFrames >= 5 && frameMs > 50; // under ~20 fps
        if (state.shape.n * state.steps > 150_000 || slow) {
            holdDrift();
        } else {
            phase += dt;
            dirty = true;
        }
    }
    if (dirty) restart();
    if (!engine.done) {
        const whole = INSTANT || isDrifting();
        const until = performance.now() + (whole ? 1e9 : 9);
        do stepOnce(); while (!engine.done && performance.now() < until);

    }
    if (engine.done && !finished) {
        finished = true;
        if (!isDrifting() || now - lastBudgetShown > 500) {
            showBudget();
            lastBudgetShown = now;
        }
        onFinish?.();
        onFinish = null;
    }
    fps.tick();
    requestAnimationFrame(frame);
}

/**
 * Change the state: the drawing restarts and the URL follows. A drifting page
 * keeps a clean URL (reloading gives a new design); an untouched collection
 * design gets its short #n= link; anything else gets the full #s= state.
 */
function commit(rebuildPanel = false, byUser = true) {
    dirty = true;
    if (byUser && state.design && !isDrifting()) variant = "edited";
    if (isDrifting()) history.replaceState(null, "", location.pathname + location.search);
    else if (state.design && !variant && !driftHeld) history.replaceState(null, "", `#n=${state.design}`);
    else history.replaceState(null, "", `#s=${encode(state)}`);
    if (rebuildPanel) buildPanel();
    placeHandles();
    renderNumber();
}

const driftButton = $<HTMLButtonElement>(".drift");
const numberEl = $<HTMLDivElement>(".number");
function renderDriftButton() {
    driftButton.hidden = !drifting;
    driftButton.textContent = driftHeld ? "▶ drift" : "❚❚ hold";
    driftButton.title = driftHeld ? "let the drawing shift by itself again" : "freeze this exact drawing";
}
function holdDrift() {
    state = drifted(state, phase); // keep exactly what is on screen
    driftHeld = true;
    renderDriftButton();
    commit(true, false);
}
driftButton.addEventListener("click", () => {
    if (!driftHeld) return holdDrift();
    driftHeld = false;
    phase = 0;
    frameMs = 0;
    driftFrames = 0;
    renderDriftButton();
    commit(true, false);
});

function showBudget() {
    const b = budget.result();
    meter.className = `budget ${b.pass ? "ok" : "over"}`;
    meter.replaceChildren(h("b", {}, b.pass ? "plottable" : "too much ink"), ` ${b.minutes.toFixed(0)} min · ${b.metres.toFixed(0)} m · density ${b.coverage.toFixed(1)}`);
    meter.title = "Estimate for A4, 0.3 mm pen. Limits: 45 min and density 1.5. tools/plotcheck.py has the final say.";
}

// ---------- fps meter (?fps) ----------

const fps = {
    el: $<HTMLDivElement>(".fps"),
    frames: [] as number[],
    value: 0,
    tick() {
        const now = performance.now();
        this.frames.push(now);
        while (this.frames.length && this.frames[0] < now - 1000) this.frames.shift();
        this.value = this.frames.length;
        if (params.has("fps")) this.el.textContent = `${this.value} fps · ${engine.count} segments/step`;
    },
};
if (params.has("fps")) fps.el.hidden = false;

// ---------- panel ----------

const h = (tag: string, attrs: Record<string, unknown> = {}, ...kids: (Node | string)[]) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k.startsWith("on")) el.addEventListener(k.slice(2), v as EventListener);
        else if (k === "class") el.className = String(v);
        else el.setAttribute(k, String(v));
    }
    el.append(...kids);
    return el;
};

function knob(label: string, value: number, min: number, max: number, step: number, set: (v: number) => void, big = false) {
    const out = h("output", {}, fmt(value));
    const input = h("input", { type: "range", min, max, step, value, "aria-label": label }) as HTMLInputElement;
    input.addEventListener("input", () => {
        set(+input.value);
        out.textContent = fmt(+input.value);
        commit();
    });
    return h("label", { class: big ? "knob big" : "knob" }, h("span", {}, label), input, out);
}
const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : +v.toFixed(3) + "");

const SIGNALS: SignalKind[] = ["none", "lin", "sin", "fade", "noise"];
const SIGNAL_LABEL: Record<SignalKind, string> = { none: "steady", lin: "ramp", sin: "wave", fade: "fade", noise: "drift" };

function signalRow(p: Param, axis: "t" | "u") {
    const s = p[axis] ?? ["none", 0.5, axis === "t" ? 60 : 1];
    const sel = h("select", { "aria-label": axis === "t" ? "over time" : "along the line" },
        ...SIGNALS.map(k => h("option", { value: k, ...(k === s[0] ? { selected: "" } : {}) }, SIGNAL_LABEL[k]))) as HTMLSelectElement;
    const amt = h("input", { type: "number", step: 0.05, value: s[1], title: "amount" }) as HTMLInputElement;
    const per = h("input", { type: "number", step: axis === "t" ? 1 : 0.05, value: s[2], title: axis === "t" ? "period in steps" : "period along the line (1 = once around)" }) as HTMLInputElement;
    const update = () => {
        if (sel.value === "none") delete p[axis];
        else p[axis] = [sel.value as SignalKind, +amt.value, +per.value];
        commit();
    };
    [sel, amt, per].forEach(el => el.addEventListener("change", update));
    return h("div", { class: "signal" }, h("span", {}, axis === "t" ? "over time" : "along line"), sel, amt, per);
}

let open = new Set<Block>();

function blockCard(b: Block, idx: number) {
    const spec = BLOCKS[b.k];
    const [main, mainLabel, min, max, step] = spec.params[0];
    const card = h("div", { class: `block${b.on ? "" : " off"}${open.has(b) ? " open" : ""}`, draggable: "true", "data-idx": idx });
    const move = (d: number) => {
        const j = idx + d;
        if (j < 0 || j >= state.blocks.length) return;
        [state.blocks[idx], state.blocks[j]] = [state.blocks[j], state.blocks[idx]];
        commit(true);
    };
    const head = h("div", { class: "block-head" },
        h("span", { class: "grip", title: "drag to reorder" }, "⠿"),
        h("button", { class: "name", title: spec.hint, onclick: () => { open.has(b) ? open.delete(b) : open.add(b); buildPanel(); } }, spec.label,
            Object.values(b.p).some(p => p.t || p.u) ? h("i", { title: "modulated" }, " ∿") : ""),
        h("span", { class: "tools" },
            h("button", { title: "move up", onclick: () => move(-1) }, "↑"),
            h("button", { title: "move down", onclick: () => move(1) }, "↓"),
            h("button", { title: b.on ? "mute" : "unmute", onclick: () => { b.on = !b.on; commit(true); } }, b.on ? "●" : "○"),
            h("button", { title: "remove", onclick: () => { state.blocks.splice(idx, 1); commit(true); } }, "×")));
    card.append(head, knob(mainLabel, b.p[main].b, min, max, step, v => (b.p[main].b = v), true));
    if (open.has(b)) {
        const more = h("div", { class: "more" });
        spec.params.forEach(([name, label, mn, mx, st], k) => {
            if (k > 0) more.append(knob(label, b.p[name].b, mn, mx, st, v => (b.p[name].b = v)));
            more.append(h("div", { class: "signals" }, h("em", {}, label), signalRow(b.p[name], "t"), signalRow(b.p[name], "u")));
        });
        card.append(more);
    }
    card.addEventListener("dragstart", e => e.dataTransfer!.setData("text/plain", String(idx)));
    card.addEventListener("dragover", e => { e.preventDefault(); card.classList.add("over"); });
    card.addEventListener("dragleave", () => card.classList.remove("over"));
    card.addEventListener("drop", e => {
        e.preventDefault();
        const from = +e.dataTransfer!.getData("text/plain");
        const [moved] = state.blocks.splice(from, 1);
        state.blocks.splice(idx, 0, moved);
        commit(true);
    });
    return card;
}

function section(title: string, ...kids: (Node | string)[]) {
    return h("section", {}, h("h3", {}, title), ...kids);
}

function buildPanel() {
    const s = state.shape;
    const kinds: SeedKind[] = ["circle", "polygon", "line", "lissajous", "drawn"];
    const seedKids: (Node | string)[] = [
        h("div", { class: "seg" }, ...kinds.map(k => h("button", {
            class: s.kind === k ? "on" : "",
            onclick: () => { if (k === "drawn") startDrawing(); else { s.kind = k; commit(true); } },
        }, k === "drawn" ? "draw ✎" : k))),
        knob("points", s.n, 50, 20000, 50, v => (s.n = v)),
        knob("size", s.r, 20, 600, 1, v => (s.r = v)),
        knob("turn", s.rot, 0, 359, 1, v => (s.rot = v)),
    ];
    if (s.kind === "polygon") seedKids.push(knob("sides", s.sides, 3, 12, 1, v => (s.sides = v)));
    if (s.kind === "lissajous") seedKids.push(knob("freq a", s.la, 1, 9, 1, v => (s.la = v)), knob("freq b", s.lb, 1, 9, 1, v => (s.lb = v)));
    seedKids.push(knob("tangle", s.shuffle, 0, 200, 1, v => (s.shuffle = v)));

    const stack = h("div", { class: "stack" }, ...state.blocks.map(blockCard));
    const add = h("select", { class: "add", "aria-label": "add block" },
        h("option", { value: "" }, "+ add block"),
        ...(Object.keys(BLOCKS) as BlockKind[]).map(k => h("option", { value: k }, `${BLOCKS[k].label} — ${BLOCKS[k].hint}`))) as HTMLSelectElement;
    add.addEventListener("change", () => {
        if (!add.value) return;
        const b = newBlock(add.value as BlockKind);
        open.add(b);
        state.blocks.push(b);
        commit(true);
    });

    const m = state.mark, st = state.style;
    panel.replaceChildren(
        section("seed", ...seedKids),
        section("stack", h("p", { class: "hint" }, "Runs top to bottom, once per step. Drag or ↑↓ to reorder; mute with ●."), stack, add),
        section("time",
            knob("steps", state.steps, 1, 600, 1, v => (state.steps = v)),
            knob("seed", state.seed, 1, 99999, 1, v => (state.seed = v))),
        section("mark",
            knob("gaps", m.skip, 0, 0.95, 0.01, v => (m.skip = v)),
            h("label", { class: "check" }, Object.assign(h("input", { type: "checkbox", onchange: (e: Event) => { m.detach = (e.target as HTMLInputElement).checked; commit(true); } }), { checked: m.detach }), "separate strokes"),
            ...(m.detach ? [knob("stroke length %", m.seglen, 10, 500, 5, v => (m.seglen = v)), knob("stroke turn", m.segrot, 0, 179, 1, v => (m.segrot = v))] : [])),
        section("colour",
            h("div", { class: "swatches" },
                h("button", { class: `swatch mono${st.palette ? "" : " on"}`, title: "one ink colour", style: `background:${st.ink}`, onclick: () => { st.palette = null; commit(true); } }),
                ...Object.entries(PALETTES).map(([name, p]) => h("button", {
                    class: `swatch${samePalette(st.palette, p) ? " on" : ""}`, title: name, style: `background:${gradient(p)}`,
                    onclick: () => { st.palette = [...p] as Palette; commit(true); },
                }))),
            ...(st.palette
                ? [knob("along line", st.spread, -6, 6, 0.05, v => (st.spread = v)), knob("over time", st.cycle, -6, 6, 0.05, v => (st.cycle = v)), knob("offset", st.shift, 0, 1, 0.01, v => (st.shift = v))]
                : [h("div", { class: "row" }, colour("ink", st.ink, v => (st.ink = v))), knob("hue drift", st.hue, -5, 5, 0.05, v => (st.hue = v))]),
            h("div", { class: "seg" }, ...(["over", "add", "screen", "multiply"] as Blend[]).map(b => h("button", {
                class: st.blend === b ? "on" : "", title: BLEND_HINT[b], onclick: () => { st.blend = b; commit(true); },
            }, b === "over" ? "paint" : b === "add" ? "light" : b))),
            knob("glow", st.soft, 0, 1, 0.01, v => (st.soft = v)),
            knob("weight", st.width, 0.2, 8, 0.1, v => (st.width = v)),
            knob("opacity", st.alpha, 0.005, 1, 0.005, v => (st.alpha = v))),
        section("ground",
            h("div", { class: "row" },
                colour("centre", st.paper, v => (st.paper = v)),
                colour("edge", st.paper2, v => (st.paper2 = v)),
                h("button", { class: "swap", title: "swap ground and ink", onclick: () => { [st.paper, st.ink] = [st.ink, st.paper]; st.paper2 = st.paper; commit(true); } }, "⇄")),
            knob("grain", st.grain, 0, 1, 0.01, v => (st.grain = v))),
    );
}

const BLEND_HINT: Record<Blend, string> = {
    over: "paint: lines cover what is under them",
    add: "light: overlapping lines add up and glow (best on dark grounds)",
    screen: "screen: like light, but softer highlights",
    multiply: "multiply: like inks on paper (best on light grounds)",
};
const samePalette = (a: Palette | null, b: Palette) => !!a && a.every((v, i) => Math.abs(v - b[i]) < 0.2);
function gradient(p: Palette) {
    const stops = [0, 0.25, 0.5, 0.75, 1].map(x => `rgb(${paletteRgb(p, x).map(c => Math.round(c * 255)).join(",")})`);
    return `linear-gradient(90deg,${stops.join(",")})`;
}

function colour(label: string, value: string, set: (v: string) => void) {
    const input = h("input", { type: "color", value }) as HTMLInputElement;
    input.addEventListener("input", () => { set(input.value); commit(); });
    return h("label", { class: "colour" }, input, label);
}

// ---------- the collection ----------

let variant: "" | "edited" = "";

/** Show a design from the collection: a random number of the given mode, or a given number. */
function showDesign(n: number) {
    state = designFor(n);
    open = new Set();
    variant = "";
    if (drifting || fresh) { drifting = true; driftHeld = reducedMotion; phase = 0; frameMs = 0; driftFrames = 0; }
    renderDriftButton();
    commit(true, false);
}

function renderNumber() {
    const n = state.design;
    const tag = !n ? "" : variant === "edited" ? " · edited" : isDrifting() ? " · drifting" : driftHeld && drifting ? " · held" : "";
    numberEl.textContent = n ? `No. ${n.toLocaleString("en-US")}${tag}` : "your own design";
    numberEl.title = n ? `${modeOf(n) === "ink" ? "an ink piece (plottable)" : "a colour piece"} from a collection of ${DESIGNS.toLocaleString("en-US")}` : "";
}

// ---------- direct handles on the canvas ----------

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

// ---------- draw your own seed ----------

function startDrawing() {
    stage.classList.add("drawing");
    const path: number[] = [];
    const toWorld = (e: PointerEvent) => {
        const r = canvas.getBoundingClientRect();
        return [((e.clientX - r.left) / r.width) * WORLD, ((e.clientY - r.top) / r.height) * WORLD];
    };
    const down = (e: PointerEvent) => { canvas.setPointerCapture(e.pointerId); path.push(...toWorld(e)); canvas.addEventListener("pointermove", move); };
    const move = (e: PointerEvent) => path.push(...toWorld(e).map(Math.round));
    const up = () => {
        canvas.removeEventListener("pointerdown", down);
        canvas.removeEventListener("pointermove", move);
        stage.classList.remove("drawing");
        if (path.length >= 8) {
            state.shape.kind = "drawn";
            state.shape.path = path;
        }
        commit(true);
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointerup", up, { once: true });
}

// ---------- actions ----------

$("#share").addEventListener("click", async () => {
    const short = state.design && !variant && !isDrifting() && !driftHeld;
    const url = short ? `${location.origin}${location.pathname}#n=${state.design}` : shareUrl(shown());
    await navigator.clipboard?.writeText(url).catch(() => {});
    flash("#share", "link copied");
});
$("#png").addEventListener("click", () => canvas.toBlob(b => b && download(`wake-${stamp()}.png`, b)));
$("#svg").addEventListener("click", () => download(`wake-${stamp()}.svg`, new Blob([toSVG(shown(), shareUrl(shown()))], { type: "image/svg+xml" })));
$("#video").addEventListener("click", () => {
    const rec = new MediaRecorder(canvas.captureStream(60), { mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm" });
    const chunks: Blob[] = [];
    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = () => download(`wake-${stamp()}.webm`, new Blob(chunks, { type: "video/webm" }));
    rec.start();
    flash("#video", "recording…");
    if (isDrifting()) setTimeout(() => rec.stop(), 8000); // a drifting drawing is recorded for 8 s
    else {
        dirty = true;
        onFinish = () => setTimeout(() => rec.stop(), 600);
    }
});

function flash(sel: string, text: string) {
    const b = $<HTMLButtonElement>(sel), old = b.textContent;
    b.textContent = text;
    setTimeout(() => (b.textContent = old), 1400);
}

// ---------- boot ----------

window.addEventListener("hashchange", () => {
    if (!/(s=[\w-]+|n=\d+)/.test(location.hash)) return;
    state = stateFromLocation();
    variant = "";
    drifting = false; // an opened link shows exactly what was shared
    renderDriftButton();
    commit(true);
});
new ResizeObserver(() => { dirty = true; placeHandles(); }).observe(stage);
$("#new-colour").addEventListener("click", () => showDesign(randomDesign("colour")));
$("#new-ink").addEventListener("click", () => showDesign(randomDesign("ink")));
if (fresh && !INSTANT) showDesign(1 + Math.floor(Math.random() * DESIGNS)); // every visit starts from a new design
renderDriftButton();
buildPanel();
commit(false, false);
requestAnimationFrame(frame);

// hooks for tests and the console
declare global { interface Window { wake: unknown } }
window.wake = {
    get state() { return state; },
    set(s: State) { state = sanitize(s); commit(true); },
    // resolves once fonts have loaded, layout has settled and the drawing is complete
    async whenDone() {
        await document.fonts.ready;
        for (;;) {
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            if (finished && !dirty) return;
            await new Promise<void>(res => (onFinish = res));
        }
    },
    svg: () => toSVG(shown()),
    // draw a state up to step k right now and return a PNG of size px (for GIFs and docs)
    snapshot(s: State, k: number, px = 360) {
        state = sanitize(s);
        restart();
        while (!engine.done && engine.n <= k) stepOnce();
        dirty = true; // the live loop redraws the full drawing afterwards
        const c = document.createElement("canvas");
        c.width = c.height = px;
        c.getContext("2d")!.drawImage(canvas, 0, 0, px, px);
        return c.toDataURL("image/png");
    },
    budget: () => budget.result(),
    fps: () => fps.value,
};

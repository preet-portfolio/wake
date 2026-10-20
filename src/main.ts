import "./style.css";
import { Engine } from "./engine";
import { Renderer } from "./gl";
import { hexToRgb, rotateHue } from "./color";
import { BLOCKS, WORLD, newBlock, type Block, type BlockKind, type Param, type SeedKind, type SignalKind, type State } from "./model";
import { encode, sanitize, shareUrl, stateFromLocation } from "./state";
import { Budget, download, stamp, toSVG } from "./export";
import { makeRng } from "./rng";

const params = new URLSearchParams(location.search);
const INSTANT = params.has("instant");

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
let dirty = true;
let finished = false;
let onFinish: (() => void) | null = null;

function restart() {
    const px = Math.round(Math.min(stage.clientWidth, stage.clientHeight) * Math.min(devicePixelRatio, 2));
    renderer.resize(Math.max(px, 300));
    engine = new Engine(structuredClone(state));
    budget = new Budget();
    renderer.clear(hexToRgb(state.style.paper));
    finished = false;
    dirty = false;
}

function stepOnce() {
    const s = engine.n;
    const c = engine.step();
    budget.add(engine.segs, c);
    const ink = hexToRgb(state.style.ink);
    renderer.draw(engine.segs, c, state.style.hue ? rotateHue(ink, state.style.hue * s) : ink, state.style.alpha, state.style.width);
}

function frame() {
    if (dirty) restart();
    if (!engine.done) {
        const until = performance.now() + (INSTANT ? 1e9 : 9);
        do stepOnce(); while (!engine.done && performance.now() < until);
    } else if (!finished) {
        finished = true;
        showBudget();
        onFinish?.();
        onFinish = null;
    }
    fps.tick();
    requestAnimationFrame(frame);
}

/** Change the state: the drawing restarts and the URL follows. */
function commit(rebuildPanel = false) {
    dirty = true;
    history.replaceState(null, "", `#s=${encode(state)}`);
    if (rebuildPanel) buildPanel();
    placeHandles();
}

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
            h("div", { class: "row" },
                knob("seed", state.seed, 1, 9999, 1, v => (state.seed = v)),
                h("button", { class: "dice", title: "a new random stack", onclick: surprise }, "⚄ surprise"))),
        section("mark",
            knob("gaps", m.skip, 0, 0.95, 0.01, v => (m.skip = v)),
            h("label", { class: "check" }, Object.assign(h("input", { type: "checkbox", onchange: (e: Event) => { m.detach = (e.target as HTMLInputElement).checked; commit(true); } }), { checked: m.detach }), "separate strokes"),
            ...(m.detach ? [knob("stroke length %", m.seglen, 10, 500, 5, v => (m.seglen = v)), knob("stroke turn", m.segrot, 0, 179, 1, v => (m.segrot = v))] : [])),
        section("ink",
            h("div", { class: "row" },
                colour("paper", st.paper, v => (st.paper = v)),
                colour("ink", st.ink, v => (st.ink = v)),
                h("button", { class: "swap", title: "swap paper and ink", onclick: () => { [st.paper, st.ink] = [st.ink, st.paper]; commit(true); } }, "⇄")),
            knob("weight", st.width, 0.2, 8, 0.1, v => (st.width = v)),
            knob("opacity", st.alpha, 0.02, 1, 0.01, v => (st.alpha = v)),
            knob("hue drift", st.hue, -5, 5, 0.05, v => (st.hue = v))),
    );
}

function colour(label: string, value: string, set: (v: string) => void) {
    const input = h("input", { type: "color", value }) as HTMLInputElement;
    input.addEventListener("input", () => { set(input.value); commit(); });
    return h("label", { class: "colour" }, input, label);
}

// a random but tasteful stack: always a contraction or a delay, so it reads as a wake
function surprise() {
    const r = makeRng(Date.now() % 1e9);
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    const between = (a: number, b: number) => a + (b - a) * r();
    const blocks: Block[] = [];
    const delay = newBlock("delay");
    delay.p.span.b = Math.round(between(-120, 120));
    if (r() < 0.7) blocks.push(delay);
    const scale = newBlock("scale");
    scale.p.s.b = between(-3, -0.8);
    scale.p.ox.b = between(350, 650); scale.p.oy.b = between(350, 650);
    blocks.push(scale);
    for (const k of ["rotate", "wave", "swirl", "attract", "jitter"] as BlockKind[]) {
        if (r() > 0.45) continue;
        const b = newBlock(k);
        if (k === "rotate") { b.p.a.b = between(-2, 2); b.p.ox.b = between(300, 700); b.p.oy.b = between(300, 700); }
        if (k === "wave") { b.p.a.b = between(0.5, 3); b.p.f.b = Math.round(between(2, 16)); }
        if (k === "swirl") b.p.k.b = between(-4, 4);
        if (k === "jitter") b.p.a.b = between(0.1, 1);
        if (r() < 0.3) { const name = BLOCKS[k].params[0][0]; b.p[name].t = [pick(["sin", "fade", "noise"] as SignalKind[]), between(0.3, 1), Math.round(between(20, 120))]; }
        blocks.splice(Math.floor(r() * (blocks.length + 1)), 0, b);
    }
    state.blocks = blocks;
    state.seed = Math.floor(between(1, 9999));
    state.steps = Math.round(between(40, 110));
    state.shape.kind = pick(["circle", "circle", "polygon", "lissajous", "line"] as SeedKind[]);
    state.shape.sides = Math.round(between(3, 7));
    open = new Set();
    commit(true);
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
    await navigator.clipboard?.writeText(shareUrl(state)).catch(() => {});
    flash("#share", "link copied");
});
$("#png").addEventListener("click", () => canvas.toBlob(b => b && download(`wake-${stamp()}.png`, b)));
$("#svg").addEventListener("click", () => download(`wake-${stamp()}.svg`, new Blob([toSVG(state, shareUrl(state))], { type: "image/svg+xml" })));
$("#video").addEventListener("click", () => {
    const rec = new MediaRecorder(canvas.captureStream(60), { mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm" });
    const chunks: Blob[] = [];
    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = () => download(`wake-${stamp()}.webm`, new Blob(chunks, { type: "video/webm" }));
    rec.start();
    flash("#video", "recording…");
    dirty = true;
    onFinish = () => setTimeout(() => rec.stop(), 600);
});

function flash(sel: string, text: string) {
    const b = $<HTMLButtonElement>(sel), old = b.textContent;
    b.textContent = text;
    setTimeout(() => (b.textContent = old), 1400);
}

// ---------- boot ----------

window.addEventListener("hashchange", () => { state = stateFromLocation(); commit(true); });
new ResizeObserver(() => { dirty = true; placeHandles(); }).observe(stage);
buildPanel();
commit();
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
    svg: () => toSVG(state),
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

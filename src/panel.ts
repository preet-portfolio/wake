// The editing panel: seed, block stack, time, mark, colour and ground.
// It edits the shared state through ctx and asks the app to commit changes.
import { BLOCKS, PALETTES, newBlock, paletteRgb, type Blend, type Block, type BlockKind, type Palette, type Param, type SeedKind, type SignalKind, type State } from "./model";

export interface PanelCtx {
    readonly state: State;
    root: HTMLElement;
    commit(rebuildPanel?: boolean): void;
    startDrawing(): void;
}

let ctx: PanelCtx;
export function initPanel(c: PanelCtx) { ctx = c; }

export const h = (tag: string, attrs: Record<string, unknown> = {}, ...kids: (Node | string)[]) => {
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
        ctx.commit();
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
        ctx.commit();
    };
    [sel, amt, per].forEach(el => el.addEventListener("change", update));
    return h("div", { class: "signal" }, h("span", {}, axis === "t" ? "over time" : "along line"), sel, amt, per);
}

export let open = new Set<Block>();
export const resetOpen = () => { open = new Set(); };

function blockCard(b: Block, idx: number) {
    const spec = BLOCKS[b.k];
    const [main, mainLabel, min, max, step] = spec.params[0];
    const card = h("div", { class: `block${b.on ? "" : " off"}${open.has(b) ? " open" : ""}`, draggable: "true", "data-idx": idx });
    const move = (d: number) => {
        const j = idx + d;
        if (j < 0 || j >= ctx.state.blocks.length) return;
        [ctx.state.blocks[idx], ctx.state.blocks[j]] = [ctx.state.blocks[j], ctx.state.blocks[idx]];
        ctx.commit(true);
    };
    const head = h("div", { class: "block-head" },
        h("span", { class: "grip", title: "drag to reorder" }, "⠿"),
        h("button", { class: "name", title: spec.hint, onclick: () => { open.has(b) ? open.delete(b) : open.add(b); buildPanel(); } }, spec.label,
            Object.values(b.p).some(p => p.t || p.u) ? h("i", { title: "modulated" }, " ∿") : ""),
        h("span", { class: "tools" },
            h("button", { title: "move up", onclick: () => move(-1) }, "↑"),
            h("button", { title: "move down", onclick: () => move(1) }, "↓"),
            h("button", { title: b.on ? "mute" : "unmute", onclick: () => { b.on = !b.on; ctx.commit(true); } }, b.on ? "●" : "○"),
            h("button", { title: "remove", onclick: () => { ctx.state.blocks.splice(idx, 1); ctx.commit(true); } }, "×")));
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
        const [moved] = ctx.state.blocks.splice(from, 1);
        ctx.state.blocks.splice(idx, 0, moved);
        ctx.commit(true);
    });
    return card;
}

function section(title: string, ...kids: (Node | string)[]) {
    return h("section", {}, h("h3", {}, title), ...kids);
}

export function buildPanel() {
    const s = ctx.state.shape;
    const kinds: SeedKind[] = ["circle", "polygon", "line", "lissajous", "drawn"];
    const seedKids: (Node | string)[] = [
        h("div", { class: "seg" }, ...kinds.map(k => h("button", {
            class: s.kind === k ? "on" : "",
            onclick: () => { if (k === "drawn") ctx.startDrawing(); else { s.kind = k; ctx.commit(true); } },
        }, k === "drawn" ? "draw ✎" : k))),
        knob("points", s.n, 50, 20000, 50, v => (s.n = v)),
        knob("size", s.r, 20, 600, 1, v => (s.r = v)),
        knob("turn", s.rot, 0, 359, 1, v => (s.rot = v)),
    ];
    if (s.kind === "polygon") seedKids.push(knob("sides", s.sides, 3, 12, 1, v => (s.sides = v)));
    if (s.kind === "lissajous") seedKids.push(knob("freq a", s.la, 1, 9, 1, v => (s.la = v)), knob("freq b", s.lb, 1, 9, 1, v => (s.lb = v)));
    seedKids.push(knob("tangle", s.shuffle, 0, 200, 1, v => (s.shuffle = v)));

    const stack = h("div", { class: "stack" }, ...ctx.state.blocks.map(blockCard));
    const add = h("select", { class: "add", "aria-label": "add block" },
        h("option", { value: "" }, "+ add block"),
        ...(Object.keys(BLOCKS) as BlockKind[]).map(k => h("option", { value: k }, `${BLOCKS[k].label} — ${BLOCKS[k].hint}`))) as HTMLSelectElement;
    add.addEventListener("change", () => {
        if (!add.value) return;
        const b = newBlock(add.value as BlockKind);
        open.add(b);
        ctx.state.blocks.push(b);
        ctx.commit(true);
    });

    const m = ctx.state.mark, st = ctx.state.style;
    ctx.root.replaceChildren(
        section("seed", ...seedKids),
        section("stack", h("p", { class: "hint" }, "Forces, applied top to bottom every step. Drag or ↑↓ to reorder; mute with ●."), stack, add),
        section("motion",
            h("div", { class: "seg" }, ...(["trails", "rings"] as const).map(m => h("button", {
                class: ctx.state.live.mode === m ? "on" : "",
                title: m === "trails" ? "each line-head draws its own path" : "neighbours are joined, like the still drawing",
                onclick: () => { ctx.state.live.mode = m; ctx.commit(true); },
            }, m))),
            knob("lifetime", ctx.state.steps, 1, 600, 1, v => (ctx.state.steps = v)),
            knob("trail", ctx.state.live.trail, 4, 600, 1, v => (ctx.state.live.trail = v)),
            knob("speed", ctx.state.live.speed, 0.1, 4, 0.05, v => (ctx.state.live.speed = v)),
            knob("seed", ctx.state.seed, 1, 99999, 1, v => (ctx.state.seed = v))),
        section("mark",
            knob("gaps", m.skip, 0, 0.95, 0.01, v => (m.skip = v)),
            h("label", { class: "check" }, Object.assign(h("input", { type: "checkbox", onchange: (e: Event) => { m.detach = (e.target as HTMLInputElement).checked; ctx.commit(true); } }), { checked: m.detach }), "separate strokes"),
            ...(m.detach ? [knob("stroke length %", m.seglen, 10, 500, 5, v => (m.seglen = v)), knob("stroke turn", m.segrot, 0, 179, 1, v => (m.segrot = v))] : [])),
        section("colour",
            h("div", { class: "swatches" },
                h("button", { class: `swatch mono${st.palette ? "" : " on"}`, title: "one ink colour", style: `background:${st.ink}`, onclick: () => { st.palette = null; ctx.commit(true); } }),
                ...Object.entries(PALETTES).map(([name, p]) => h("button", {
                    class: `swatch${samePalette(st.palette, p) ? " on" : ""}`, title: name, style: `background:${gradient(p)}`,
                    onclick: () => { st.palette = [...p] as Palette; ctx.commit(true); },
                }))),
            ...(st.palette
                ? [knob("along line", st.spread, -6, 6, 0.05, v => (st.spread = v)), knob("over time", st.cycle, -6, 6, 0.05, v => (st.cycle = v)), knob("offset", st.shift, 0, 1, 0.01, v => (st.shift = v))]
                : [h("div", { class: "row" }, colour("ink", st.ink, v => (st.ink = v))), knob("hue drift", st.hue, -5, 5, 0.05, v => (st.hue = v))]),
            h("div", { class: "seg" }, ...(["over", "add", "screen", "multiply"] as Blend[]).map(b => h("button", {
                class: st.blend === b ? "on" : "", title: BLEND_HINT[b], onclick: () => { st.blend = b; ctx.commit(true); },
            }, b === "over" ? "paint" : b === "add" ? "light" : b))),
            knob("glow", st.soft, 0, 1, 0.01, v => (st.soft = v)),
            knob("weight", st.width, 0.2, 8, 0.1, v => (st.width = v)),
            knob("opacity", st.alpha, 0.005, 1, 0.005, v => (st.alpha = v))),
        section("ground",
            h("div", { class: "row" },
                colour("centre", st.paper, v => (st.paper = v)),
                colour("edge", st.paper2, v => (st.paper2 = v)),
                h("button", { class: "swap", title: "swap ground and ink", onclick: () => { [st.paper, st.ink] = [st.ink, st.paper]; st.paper2 = st.paper; ctx.commit(true); } }, "⇄")),
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
    input.addEventListener("input", () => { set(input.value); ctx.commit(); });
    return h("label", { class: "colour" }, input, label);
}


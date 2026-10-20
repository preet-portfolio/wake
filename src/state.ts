// The whole state lives in the URL hash as base64url JSON, so a link is a drawing.
import { BLOCKS, WORLD, defaultState, newBlock, type Block, type Mark, type Param, type Seed, type SeedKind, type Signal, type SignalKind, type State, type Style } from "./model";

export function encode(s: State): string {
    const bytes = new TextEncoder().encode(JSON.stringify(s));
    let bin = "";
    bytes.forEach(b => (bin += String.fromCharCode(b)));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decode(h: string): State | null {
    try {
        const bin = atob(h.replace(/-/g, "+").replace(/_/g, "/"));
        const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
        return sanitize(JSON.parse(new TextDecoder().decode(bytes)));
    } catch {
        return null;
    }
}

// A link is untrusted input. Every field is type-checked and clamped to the
// ranges the UI allows, so a crafted link can't freeze the tab or inject markup.
const num = (v: unknown, lo: number, hi: number, def: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
const hex = (v: unknown, def: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : def);
const SEEDS: SeedKind[] = ["circle", "polygon", "line", "lissajous", "drawn"];
const SIGNAL_KINDS: SignalKind[] = ["none", "lin", "sin", "fade", "noise"];
const MAX_PATH = 4000; // numbers, i.e. 2000 drawn points

function cleanSignal(v: unknown): Signal | undefined {
    if (!Array.isArray(v) || !SIGNAL_KINDS.includes(v[0])) return undefined;
    return [v[0], num(v[1], -100, 100, 0), num(v[2], 0.001, 100000, 1)];
}

function cleanParam(v: unknown, lo: number, hi: number, def: number): Param {
    const r = (v ?? {}) as Partial<Param>;
    const p: Param = { b: num(r.b, lo, hi, def) };
    const t = cleanSignal(r.t), u = cleanSignal(r.u);
    if (t) p.t = t;
    if (u) p.u = u;
    return p;
}

export function sanitize(raw: Partial<State>): State {
    const d = defaultState();
    const r = (raw ?? {}) as Partial<State>;
    const rs = (r.shape ?? {}) as Partial<Seed>;
    const rm = (r.mark ?? {}) as Partial<Mark>;
    const rt = (r.style ?? {}) as Partial<Style>;

    const blocks: Block[] = (Array.isArray(r.blocks) ? r.blocks : d.blocks)
        .slice(0, 32)
        .filter(b => b && typeof b.k === "string" && Object.hasOwn(BLOCKS, b.k))
        .map(b => {
            const fresh = newBlock(b.k);
            for (const [name, , lo, hi, , def] of BLOCKS[b.k].params) fresh.p[name] = cleanParam(b.p?.[name], lo, hi, def);
            fresh.on = b.on !== false;
            return fresh;
        });

    const path = Array.isArray(rs.path)
        ? rs.path.slice(0, MAX_PATH).map(v => num(v, -WORLD, 2 * WORLD, 0))
        : undefined;

    return {
        v: 1,
        seed: Math.round(num(r.seed, 0, 1e9, d.seed)),
        steps: Math.round(num(r.steps, 1, 600, d.steps)),
        shape: {
            kind: SEEDS.includes(rs.kind as SeedKind) ? (rs.kind as SeedKind) : d.shape.kind,
            n: Math.round(num(rs.n, 2, 20000, d.shape.n)),
            r: num(rs.r, 1, 2 * WORLD, d.shape.r),
            cx: num(rs.cx, -WORLD, 2 * WORLD, d.shape.cx),
            cy: num(rs.cy, -WORLD, 2 * WORLD, d.shape.cy),
            rot: num(rs.rot, -360, 360, d.shape.rot),
            sides: Math.round(num(rs.sides, 3, 12, d.shape.sides)),
            la: Math.round(num(rs.la, 1, 9, d.shape.la)),
            lb: Math.round(num(rs.lb, 1, 9, d.shape.lb)),
            shuffle: Math.round(num(rs.shuffle, 0, 200, d.shape.shuffle)),
            ...(path && path.length >= 4 ? { path } : {}),
        },
        blocks,
        mark: {
            skip: num(rm.skip, 0, 0.95, d.mark.skip),
            detach: rm.detach === true,
            seglen: num(rm.seglen, 10, 500, d.mark.seglen),
            segrot: num(rm.segrot, 0, 179, d.mark.segrot),
        },
        style: {
            paper: hex(rt.paper, d.style.paper),
            ink: hex(rt.ink, d.style.ink),
            alpha: num(rt.alpha, 0.02, 1, d.style.alpha),
            width: num(rt.width, 0.2, 8, d.style.width),
            hue: num(rt.hue, -5, 5, d.style.hue),
        },
    };
}

export function stateFromLocation(): State {
    const m = location.hash.match(/s=([\w-]+)/);
    return (m && decode(m[1])) || defaultState();
}

export function shareUrl(s: State): string {
    return `${location.origin}${location.pathname}#s=${encode(s)}`;
}

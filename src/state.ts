// The whole state lives in the URL hash as base64url JSON, so a link is a drawing.
import { BLOCKS, defaultState, newBlock, type Block, type State } from "./model";

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

// fill anything missing from defaults, drop unknown blocks, so old or hand-edited links still load
export function sanitize(raw: Partial<State>): State {
    const d = defaultState();
    const blocks: Block[] = (raw.blocks ?? d.blocks)
        .filter(b => b && b.k in BLOCKS)
        .map(b => {
            const fresh = newBlock(b.k);
            for (const name of Object.keys(fresh.p)) if (b.p?.[name]) fresh.p[name] = b.p[name];
            fresh.on = b.on !== false;
            return fresh;
        });
    return {
        v: 1,
        seed: raw.seed ?? d.seed,
        steps: raw.steps ?? d.steps,
        shape: { ...d.shape, ...raw.shape },
        blocks,
        mark: { ...d.mark, ...raw.mark },
        style: { ...d.style, ...raw.style },
    };
}

export function stateFromLocation(): State {
    const m = location.hash.match(/s=([\w-]+)/);
    return (m && decode(m[1])) || defaultState();
}

export function shareUrl(s: State): string {
    return `${location.origin}${location.pathname}#s=${encode(s)}`;
}

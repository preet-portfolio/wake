// Exports: plotter SVG (merged polylines), a live plot budget, PNG and video.
import { runAll } from "./engine";
import { WORLD, type State } from "./model";

/** Polylines for the whole drawing: consecutive segments that share an endpoint are merged. */
export function polylines(state: State): number[][] {
    const lines: number[][] = [];
    runAll(state, (segs, count) => {
        let cur: number[] | null = null;
        for (let k = 0; k < count; k++) {
            const o = k * 4;
            const x0 = segs[o], y0 = segs[o + 1], x1 = segs[o + 2], y1 = segs[o + 3];
            if (cur && cur[cur.length - 2] === x0 && cur[cur.length - 1] === y0) {
                cur.push(x1, y1);
            } else {
                cur = [x0, y0, x1, y1];
                lines.push(cur);
            }
        }
    });
    return lines;
}

const xmlEscape = (s: string) => s.replace(/[<>&"']/g, c => `&#${c.charCodeAt(0)};`);

export function toSVG(state: State, share = ""): string {
    const f = (v: number) => Number(v).toFixed(2);
    const paths = polylines(state).map(l => {
        let d = `M${f(l[0])} ${f(l[1])}`;
        for (let i = 2; i < l.length; i += 2) d += `L${f(l[i])} ${f(l[i + 1])}`;
        return `<path d="${d}"/>`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WORLD}" height="${WORLD}" viewBox="0 0 ${WORLD} ${WORLD}">
<desc>wake ${xmlEscape(share)}</desc>
<g fill="none" stroke="black" stroke-width="${f(state.style.width)}" stroke-linecap="round" stroke-linejoin="round">
${paths.join("\n")}
</g>
</svg>
`;
}

/**
 * Plot budget, mirroring tools/plotcheck.py: the drawing fitted to 180 mm
 * (A4 with a 15 mm margin), 0.3 mm pen, 50 mm/s pen down, ~0.4 s per lift
 * including travel, coverage per 2 mm cell. It's an estimate; plotcheck.py
 * stays the authority. Fed incrementally so the player can show it live.
 */
export class Budget {
    private static readonly MM = 180 / WORLD;
    private static readonly CELL = 2;
    private cells = Math.ceil((WORLD * Budget.MM) / Budget.CELL);
    private grid = new Float32Array(this.cells * this.cells);
    private down = 0;
    private lifts = 0;

    add(segs: Float32Array, count: number) {
        const mm = Budget.MM;
        let px = NaN, py = NaN;
        for (let k = 0; k < count; k++) {
            const o = k * 4;
            const x0 = segs[o], y0 = segs[o + 1], x1 = segs[o + 2], y1 = segs[o + 3];
            if (x0 !== px || y0 !== py) this.lifts++;
            px = x1; py = y1;
            const len = Math.hypot(x1 - x0, y1 - y0) * mm;
            this.down += len;
            const cx = Math.floor((((x0 + x1) / 2) * mm) / Budget.CELL);
            const cy = Math.floor((((y0 + y1) / 2) * mm) / Budget.CELL);
            if (cx >= 0 && cy >= 0 && cx < this.cells && cy < this.cells) this.grid[cy * this.cells + cx] += len;
        }
    }

    result() {
        let max = 0;
        for (const v of this.grid) if (v > max) max = v;
        const coverage = (max * 0.3) / (Budget.CELL * Budget.CELL);
        const minutes = (this.down / 50 + this.lifts * 0.4) / 60;
        return { minutes, coverage, metres: this.down / 1000, pass: minutes <= 45 && coverage <= 1.5 };
    }
}

export function budget(state: State) {
    const b = new Budget();
    runAll(state, (segs, count) => b.add(segs, count));
    return b.result();
}

export function download(name: string, blob: Blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function stamp() {
    return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

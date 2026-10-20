// hex <-> rgb and a hue rotation for the per-step hue shift
export function hexToRgb(hex: string): [number, number, number] {
    const v = parseInt(hex.replace("#", ""), 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

// rotate hue by `deg` using the YIQ rotation (cheap, no HSL round trip)
export function rotateHue([r, g, b]: [number, number, number], deg: number): [number, number, number] {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const i = 0.596 * r - 0.274 * g - 0.322 * b;
    const q = 0.211 * r - 0.523 * g + 0.312 * b;
    const i2 = i * c - q * s, q2 = i * s + q * c;
    const clamp = (x: number) => Math.min(1, Math.max(0, x));
    return [clamp(y + 0.956 * i2 + 0.621 * q2), clamp(y - 0.272 * i2 - 0.647 * q2), clamp(y - 1.106 * i2 + 1.703 * q2)];
}

export function rgbToCss([r, g, b]: [number, number, number], a = 1): string {
    return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
}

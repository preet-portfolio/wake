// Chladni figures (Chladni, "Entdeckungen über die Theorie des Klanges", 1787):
// sand on a vibrating plate is thrown off the moving parts and comes to rest
// on the nodal lines, where the plate stands still. The standing wave of a
// square plate is approximated by the classic superposition
//   u(x, y) = cos(nπx) cos(mπy) − cos(mπx) cos(nπy),   x, y ∈ [−1, 1]
// (exact free-plate modes need Ritz's method, Annalen der Physik 28, 1909).
export function mode(n: number, m: number, x: number, y: number): number {
    const P = Math.PI;
    return Math.cos(n * P * x) * Math.cos(m * P * y) - Math.cos(m * P * x) * Math.cos(n * P * y);
}

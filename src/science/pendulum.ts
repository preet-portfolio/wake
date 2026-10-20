// The double pendulum (two equal point masses on massless rods), from its
// Lagrangian. Its Hamiltonian is not separable, so plain leapfrog does not
// apply; RK4 with a small step keeps energy within 0.1 % (tested).
export interface PendulumParams { g: number; l1: number; l2: number; m1: number; m2: number }
export const STANDARD: PendulumParams = { g: 9.81, l1: 1, l2: 1, m1: 1, m2: 1 };

/** state = [θ1, θ2, ω1, ω2] → its time derivative */
export function deriv(p: PendulumParams, s: ArrayLike<number>): [number, number, number, number] {
    const [t1, t2, w1, w2] = [s[0], s[1], s[2], s[3]];
    const { g, l1, l2, m1, m2 } = p;
    const d = t1 - t2, den = 2 * m1 + m2 - m2 * Math.cos(2 * d);
    const a1 = (-g * (2 * m1 + m2) * Math.sin(t1) - m2 * g * Math.sin(t1 - 2 * t2) - 2 * Math.sin(d) * m2 * (w2 * w2 * l2 + w1 * w1 * l1 * Math.cos(d))) / (l1 * den);
    const a2 = (2 * Math.sin(d) * (w1 * w1 * l1 * (m1 + m2) + g * (m1 + m2) * Math.cos(t1) + w2 * w2 * l2 * m2 * Math.cos(d))) / (l2 * den);
    return [w1, w2, a1, a2];
}

export function rk4(p: PendulumParams, s: Float64Array | number[], dt: number) {
    const add = (a: ArrayLike<number>, k: number[], h: number) => [a[0] + h * k[0], a[1] + h * k[1], a[2] + h * k[2], a[3] + h * k[3]];
    const k1 = deriv(p, s), k2 = deriv(p, add(s, k1, dt / 2)), k3 = deriv(p, add(s, k2, dt / 2)), k4 = deriv(p, add(s, k3, dt));
    for (let i = 0; i < 4; i++) s[i] += (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
}

/** Total energy (kinetic + potential), for the conservation test. */
export function energy(p: PendulumParams, s: ArrayLike<number>): number {
    const [t1, t2, w1, w2] = [s[0], s[1], s[2], s[3]];
    const { g, l1, l2, m1, m2 } = p;
    const T = 0.5 * m1 * l1 * l1 * w1 * w1 + 0.5 * m2 * (l1 * l1 * w1 * w1 + l2 * l2 * w2 * w2 + 2 * l1 * l2 * w1 * w2 * Math.cos(t1 - t2));
    const V = -(m1 + m2) * g * l1 * Math.cos(t1) - m2 * g * l2 * Math.cos(t2);
    return T + V;
}

/** Positions of both bobs (pivot at the origin, y down). */
export function bobs(p: PendulumParams, s: ArrayLike<number>): [number, number, number, number] {
    const x1 = p.l1 * Math.sin(s[0]), y1 = p.l1 * Math.cos(s[0]);
    return [x1, y1, x1 + p.l2 * Math.sin(s[1]), y1 + p.l2 * Math.cos(s[1])];
}

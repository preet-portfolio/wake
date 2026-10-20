// Lorenz, "Deterministic Nonperiodic Flow", J. Atmos. Sci. 20 (1963).
//   dx/dt = σ(y − x),  dy/dt = x(ρ − z) − y,  dz/dt = xy − βz
// Classic parameters σ = 10, ρ = 28, β = 8/3. Integrated with RK4.
export interface LorenzParams { sigma: number; rho: number; beta: number }
export const CLASSIC: LorenzParams = { sigma: 10, rho: 28, beta: 8 / 3 };

export function deriv(p: LorenzParams, x: number, y: number, z: number): [number, number, number] {
    return [p.sigma * (y - x), x * (p.rho - z) - y, x * y - p.beta * z];
}

/** One RK4 step of size dt, in place on s = [x, y, z]. */
export function rk4(p: LorenzParams, s: Float64Array | number[], dt: number) {
    const [x, y, z] = s;
    const k1 = deriv(p, x, y, z);
    const k2 = deriv(p, x + (dt / 2) * k1[0], y + (dt / 2) * k1[1], z + (dt / 2) * k1[2]);
    const k3 = deriv(p, x + (dt / 2) * k2[0], y + (dt / 2) * k2[1], z + (dt / 2) * k2[2]);
    const k4 = deriv(p, x + dt * k3[0], y + dt * k3[1], z + dt * k3[2]);
    s[0] = x + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    s[1] = y + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    s[2] = z + (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
}

/**
 * Largest Lyapunov exponent by the two-trajectory renormalisation method
 * (Benettin, Galgani, Giorgilli & Strelcyn, Meccanica 15, 1980).
 * Published value for the classic parameters: λ₁ ≈ 0.9056.
 */
export function lyapunov(p: LorenzParams = CLASSIC, T = 400, dt = 0.005, d0 = 1e-8): number {
    const a = [1, 1, 1];
    for (let i = 0; i < 2000; i++) rk4(p, a, dt); // settle onto the attractor
    const b = [a[0] + d0, a[1], a[2]];
    let sum = 0;
    const steps = Math.round(T / dt);
    for (let i = 0; i < steps; i++) {
        rk4(p, a, dt); rk4(p, b, dt);
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
        const d = Math.hypot(dx, dy, dz);
        sum += Math.log(d / d0);
        b[0] = a[0] + (dx * d0) / d; b[1] = a[1] + (dy * d0) / d; b[2] = a[2] + (dz * d0) / d;
    }
    return sum / (steps * dt);
}

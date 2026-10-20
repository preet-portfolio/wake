// Kuramoto (1975): N oscillators with natural frequencies ωᵢ, all coupled.
//   dθᵢ/dt = ωᵢ + (K/N) Σⱼ sin(θⱼ − θᵢ) = ωᵢ + K r sin(ψ − θᵢ)
// with the order parameter r e^{iψ} = (1/N) Σⱼ e^{iθⱼ}. For a Lorentzian
// (Cauchy) frequency spread of half-width γ, synchrony switches on at
// K_c = 2γ and, above it, r = √(1 − K_c/K) exactly (Kuramoto 1984; Strogatz,
// Physica D 143, 2000).

/** Natural frequencies: evenly spaced quantiles of a Cauchy distribution (deterministic). */
export function cauchyFrequencies(n: number, gamma: number, centre = 0): Float64Array {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = centre + gamma * Math.tan(Math.PI * ((i + 0.5) / n - 0.5));
    return w;
}

export function order(theta: ArrayLike<number>): { r: number; psi: number } {
    let c = 0, s = 0;
    for (let i = 0; i < theta.length; i++) { c += Math.cos(theta[i]); s += Math.sin(theta[i]); }
    c /= theta.length; s /= theta.length;
    return { r: Math.hypot(c, s), psi: Math.atan2(s, c) };
}

/** One RK4 step of the mean-field equations, in place. */
export function rk4(theta: Float64Array, omega: Float64Array, K: number, dt: number) {
    const n = theta.length;
    const f = (th: Float64Array, out: Float64Array) => {
        const { r, psi } = order(th);
        for (let i = 0; i < n; i++) out[i] = omega[i] + K * r * Math.sin(psi - th[i]);
    };
    const k1 = new Float64Array(n), k2 = new Float64Array(n), k3 = new Float64Array(n), k4 = new Float64Array(n), t = new Float64Array(n);
    f(theta, k1);
    for (let i = 0; i < n; i++) t[i] = theta[i] + (dt / 2) * k1[i];
    f(t, k2);
    for (let i = 0; i < n; i++) t[i] = theta[i] + (dt / 2) * k2[i];
    f(t, k3);
    for (let i = 0; i < n; i++) t[i] = theta[i] + dt * k3[i];
    f(t, k4);
    for (let i = 0; i < n; i++) theta[i] += (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
}

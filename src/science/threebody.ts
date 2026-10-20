// The figure-eight choreography of three equal masses: found numerically by
// Moore (Phys. Rev. Lett. 70, 1993), proved to exist by Chenciner & Montgomery
// (Annals of Mathematics 152, 2000). Initial conditions and period as computed
// by Carles Simó and given by Chenciner & Montgomery: G = m = 1, T ≈ 6.32591398.
// Gravity's Hamiltonian is separable (kinetic + potential), so velocity Verlet,
// a symplectic integrator (Verlet, Phys. Rev. 159, 1967), conserves energy well.
export const PERIOD = 6.32591398;

/** [x1, y1, x2, y2, x3, y3, vx1, vy1, vx2, vy2, vx3, vy3] */
export function figureEight(): Float64Array {
    const x1 = 0.97000436, y1 = -0.24308753, vx3 = -0.93240737, vy3 = -0.86473146;
    return Float64Array.from([x1, y1, -x1, -y1, 0, 0, -vx3 / 2, -vy3 / 2, -vx3 / 2, -vy3 / 2, vx3, vy3]);
}

function accel(s: Float64Array, a: Float64Array, soft = 0) {
    a.fill(0);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
        const dx = s[2 * j] - s[2 * i], dy = s[2 * j + 1] - s[2 * i + 1];
        const r2 = dx * dx + dy * dy + soft, inv = 1 / (r2 * Math.sqrt(r2));
        a[2 * i] += dx * inv; a[2 * i + 1] += dy * inv;
        a[2 * j] -= dx * inv; a[2 * j + 1] -= dy * inv;
    }
}

const acc = new Float64Array(6);
/** One velocity-Verlet step (kick–drift–kick), in place. */
export function verlet(s: Float64Array, dt: number, soft = 0) {
    accel(s, acc, soft);
    for (let k = 0; k < 6; k++) s[6 + k] += 0.5 * dt * acc[k];
    for (let k = 0; k < 6; k++) s[k] += dt * s[6 + k];
    accel(s, acc, soft);
    for (let k = 0; k < 6; k++) s[6 + k] += 0.5 * dt * acc[k];
}

export function energy(s: Float64Array, soft = 0): number {
    let T = 0, V = 0;
    for (let i = 0; i < 3; i++) T += 0.5 * (s[6 + 2 * i] ** 2 + s[7 + 2 * i] ** 2);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) V -= 1 / Math.sqrt((s[2 * j] - s[2 * i]) ** 2 + (s[2 * j + 1] - s[2 * i + 1]) ** 2 + soft);
    return T + V;
}

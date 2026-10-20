// The ⓘ card of each science species: one sentence, the equation (KaTeX), the
// primary source, and one "aha" control (a species parameter).
import type { SpeciesKind } from "./species";

export interface ScienceCard {
    sentence: string;
    tex: string;
    source: string;
    aha: { key: string; min: number; max: number; step: number; show: (v: number) => string; restart?: boolean };
}

const sup = (s: string) => s.replace(/-/g, "⁻").replace(/\d/g, d => "⁰¹²³⁴⁵⁶⁷⁸⁹"[+d]);

/** Walk Pearson's (F, k) map: spots → labyrinth → extinction. */
export function gsAt(t: number) {
    const pts = [{ F: 0.0367, k: 0.0649 }, { F: 0.055, k: 0.062 }, { F: 0.03, k: 0.075 }];
    const x = Math.min(1, Math.max(0, t)) * 2, i = Math.min(1, Math.floor(x)), f = x - i;
    return { F: pts[i].F + (pts[i + 1].F - pts[i].F) * f, k: pts[i].k + (pts[i + 1].k - pts[i].k) * f };
}

export const SCIENCE_CARDS: Partial<Record<SpeciesKind, ScienceCard>> = {
    lorenz: {
        sentence: "Thousands of weather-like systems start a billionth apart; within seconds they are spread over the whole butterfly, because the system is chaotic.",
        tex: String.raw`\dot x=\sigma(y-x),\;\; \dot y=x(\rho-z)-y,\;\; \dot z=xy-\beta z`,
        source: "E. N. Lorenz, “Deterministic Nonperiodic Flow”, J. Atmos. Sci. 20 (1963)",
        aha: { key: "rho", min: 0, max: 40, step: 0.1, show: v => `ρ = ${v.toFixed(1)}${v < 13.93 ? " · no chaos" : v < 24.74 ? " · transient chaos" : " · chaos"}` },
    },
    pendulum: {
        sentence: "Every pendulum here started from the same angle, give or take a tiny fraction of a radian. Watch how long they stay together.",
        tex: String.raw`L=T-V,\quad V=-(m_1+m_2)\,g\,l_1\cos\theta_1-m_2\,g\,l_2\cos\theta_2`,
        source: "T. Shinbrot, C. Grebogi, J. Wisdom & J. A. Yorke, “Chaos in a double pendulum”, Am. J. Phys. 60 (1992)",
        aha: { key: "eps", min: -14, max: -2, step: 1, show: v => `twins differ by 10${sup(String(v))} rad`, restart: true },
    },
    threebody: {
        sentence: "Three equal masses chase each other forever along a single figure eight: a solution of the three-body problem found in 1993 and proved in 2000.",
        tex: String.raw`\ddot{\mathbf r}_i=\sum_{j\ne i}\frac{\mathbf r_j-\mathbf r_i}{\lvert\mathbf r_j-\mathbf r_i\rvert^{3}},\qquad T\approx 6.3259`,
        source: "A. Chenciner & R. Montgomery, Annals of Mathematics 152 (2000); C. Moore, Phys. Rev. Lett. 70 (1993)",
        aha: { key: "nudge", min: 0, max: 0.3, step: 0.002, show: v => `ghost copies nudged by up to ${v.toFixed(3)}`, restart: true },
    },
    kuramoto: {
        sentence: "Each firefly has its own rhythm and listens to the crowd. Below a critical coupling they flash at random; above it, they suddenly flash together.",
        tex: String.raw`\dot\theta_i=\omega_i+K\,r\sin(\psi-\theta_i),\quad r\,e^{i\psi}=\tfrac1N\textstyle\sum_j e^{i\theta_j},\quad K_c=2\gamma`,
        source: "Y. Kuramoto (1975); S. H. Strogatz, “From Kuramoto to Crawford”, Physica D 143 (2000)",
        aha: { key: "K", min: 0, max: 3, step: 0.01, show: v => `K = ${v.toFixed(2)} · K꜀ = 1${v > 1 ? " · synchrony" : ""}` },
    },
    chladni: {
        sentence: "A vibrating plate throws sand off the parts that move; the sand comes to rest on the lines that stand still.",
        tex: String.raw`u(x,y)=\cos(n\pi x)\cos(m\pi y)-\cos(m\pi x)\cos(n\pi y)`,
        source: "E. F. F. Chladni, Entdeckungen über die Theorie des Klanges (1787); exact free-plate modes: W. Ritz (1909)",
        aha: { key: "mode", min: 0, max: 11, step: 1, show: v => `mode ${v + 1} of 12` },
    },
    grayscott: {
        sentence: "Two chemicals react and spread at different speeds; from a few drops they grow the kind of spots and stripes Turing proposed for animal coats.",
        tex: String.raw`\partial_t u=D_u\nabla^2u-uv^2+F(1-u),\quad \partial_t v=D_v\nabla^2v+uv^2-(F+k)v`,
        source: "J. E. Pearson, “Complex Patterns in a Simple System”, Science 261 (1993); A. M. Turing (1952)",
        aha: { key: "t", min: 0, max: 1, step: 0.01, show: v => (v < 0.35 ? "spots" : v < 0.7 ? "labyrinth" : "dying out") + ` · F ${gsAt(v).F.toFixed(4)}, k ${gsAt(v).k.toFixed(4)}` },
    },
};

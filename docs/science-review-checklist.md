# Science review checklist

For a physicist or mathematician. Please tick, correct, or strike each line. The code is in `src/science/` (solvers) and `src/science-cards.ts` (what visitors read). The automated checks are in `tests/science.spec.ts` and `tests/science-live.spec.ts`.

Reviewer: ____________________  Field: ____________________  Date: __________

## Lorenz attractor (`science/lorenz.ts`)
- [ ] Equations and classic parameters (σ = 10, ρ = 28, β = 8/3) are as in Lorenz (1963).
- [ ] RK4 at dt = 0.005 is an appropriate integrator for display and for the Lyapunov estimate.
- [ ] The Lyapunov method (two trajectories, renormalised every step, after Benettin et al. 1980) is sound. The test measures ≈ 0.90 against the published ≈ 0.9056.
- [ ] The card's ρ thresholds are correct: no chaos below ≈ 13.93; transient chaos (Kaplan & Yorke 1979) up to ≈ 24.06, with chaos coexisting with stable fixed points up to ≈ 24.74; chaos above. *(The card simplifies 24.06–24.74 into "transient chaos". Is that acceptable?)*
- [ ] Card sentence: "Thousands of weather-like systems start a billionth apart…" Is "weather-like" fair for a model of convection?

## Double pendulum (`science/pendulum.ts`)
- [ ] Equations of motion for equal point masses on massless rods are correct.
- [ ] RK4 is a reasonable choice (the Hamiltonian is not separable, so plain leapfrog doesn't apply). Energy drift < 0.1 % over 10,000 steps of 1/240 s (measured ≈ 8 × 10⁻⁶).
- [ ] The card shows the Lagrangian's potential term only. Is the presentation acceptable, or should T be written out?
- [ ] Citation: Shinbrot, Grebogi, Wisdom & Yorke, Am. J. Phys. 60 (1992).

## Figure-eight choreography (`science/threebody.ts`)
- [ ] Initial conditions (Simó's values, as given by Chenciner & Montgomery 2000) and the period T ≈ 6.32591398 are correct.
- [ ] Velocity Verlet is symplectic for this separable Hamiltonian. Energy drift < 0.1 % over one period in 10,000 steps (measured ≈ 2 × 10⁻⁷); the orbit closes to 10⁻⁶.
- [ ] The visual run uses softening 10⁻⁴ so that strongly nudged copies can't blow up; the tests use none. Acceptable?
- [ ] The "nudge" control claims the choreography is stable to small perturbations (it is linearly stable; Simó 2002). Is the wording "small nudges stay close; large ones break it" fair?
- [ ] Credit: Moore (1993) found it numerically; Chenciner & Montgomery (2000) proved it exists.

## Kuramoto fireflies (`science/kuramoto.ts`)
- [ ] Mean-field form and order parameter are correct.
- [ ] For Lorentzian frequencies of half-width γ: K_c = 2γ, and r = √(1 − K_c/K) above it. The tests check this at K = 1.5, 2, 3 with N = 2,000 (to within 0.03) and r < 0.05 at K = K_c/2.
- [ ] Visual: a firefly "flashes" when cos θ > 0.9. Is it fair to call this fireflies? (Real fireflies are pulse-coupled; see Mirollo & Strogatz 1990.) *Suggested wording welcome.*

## Chladni plate (`science/chladni.ts`)
- [ ] The superposition u = cos(nπx)cos(mπy) − cos(mπx)cos(nπy) is a standard *approximation* to square-plate modes, not the exact free-edge solution (Ritz 1909). The card says so in its source line. Is that enough?
- [ ] The sand model (random jumps proportional to |u|) is a caricature of the real mechanism. Is the card sentence "sand comes to rest on the lines that stand still" accurate enough?

## Gray–Scott / Turing patterns (`science/grayscott.ts`, `grayscott-gl.ts`)
- [ ] Equations correct; normalisation Dᵤ = 1, Dᵥ = 0.5, dt = 1, 3×3 Laplacian (after Karl Sims) is a common, valid discretisation.
- [ ] Parameter points: (F, k) = (0.0367, 0.0649) gives self-replicating spots, (0.055, 0.062) a labyrinth, (0.03, 0.075) extinction. *Which of Pearson's Greek-letter classes do these correspond to? I have deliberately not labelled them; please fill in.*
- [ ] The GPU and CPU fields from the same start correlate at 1.0000 after 6,000 steps (tested).
- [ ] The card links this to Turing (1952) on animal coats. Is "the kind of spots and stripes Turing proposed" fair, given that Gray–Scott is not Turing's original model?

## Overall
- [ ] Nothing on any card is wrong.
- [ ] Nothing important is missing that a curious visitor would be misled without.

Notes:

# wake: the model

> A drawing is the wake of a line moving through time: a **seed shape**, an ordered **stack of blocks** that moves it one step, and **time** that runs the stack again and again, leaving every step on the page.

## Objects
- **Seed.** A closed or open polyline of `N` points, which can be a circle, polygon (k sides), line, Lissajous curve, or a hand-drawn path. Point `i` has an arc position `u = i / N` in [0, 1).
- **Clock.** Iteration `n = 0 … T`. Each point also has a **local time** `τᵢ = n − d(u)`, where `d` is a delay field. A point with `τ < 0` hasn't been born yet: it isn't drawn and it doesn't move.
- **Block.** A pure function `(p, ctx) → p'`, where `ctx = {n, τ, u, i, rng}`. Blocks run top to bottom, and the **order is data**. So `scale → rotate` and `rotate → scale` are different drawings.
- **Param.** Every numeric block parameter is a *signal*, not a constant: `v(τ, u) = base · (1 + time(τ)) · (1 + along(u))`. `time` and `along` each take one of these forms: `none | linear(k) | sine(amp, period, phase) | fade(until) | noise(amp, scale)`.
- **Mark.** The step after the stack runs: how this iteration's points become ink. It can be connected, skipped (with a chance), or detached segments (rotated or lengthened).
- **Seeded RNG.** `rng = mulberry32(seed)`, a single stream used in a fixed order. The full state is the seed, the shape, the blocks, the mark and the style, all serialised into the URL.

## Blocks
`rotate(angle, origin)` · `scale(sx, sy, origin)` · `move(dx, dy)` · `wave(ax, ay, period)` · `jitter(amount)` · `delay(span, direction)` (the timeshear generalised: `d(u) = span · u`, or along any signal) · `swirl(strength, origin)` (rotation that varies with radius) · `attract(point, strength)`

Swapping strands is a seed operation (`shuffle(k)`), not a block.

## Every uji capability in this model
| uji option(s) | wake expression |
|---|---|
| shape, radius, center, segments, initial rotation | seed (kind, r, centre, N, angle) |
| expansion h/v, exponential expansion | `scale(sx, sy)` with `time: linear(k)` |
| rotation speed, origin, speedup, period, until | `rotate(angle, origin)` with `time: linear`, `sine` or `fade` |
| translation h/v | `move(dx, dy)` |
| waviness period/amplitude h/v | `wave(ax, ay, period)` (uji's wave runs along `i`, so it's an `along` signal) |
| jitter | `jitter(amount)` (placed *before* scale to reproduce uji's amplified random walk) |
| skip chance, reveal, fade-in, fade-out, sawtooth fade | mark: `skip(chance)`, plus `delay` and visibility signals over `τ` and `u` |
| segment rotation and lengthening | mark: `detached(rotate, length)` |
| line swappiness | seed: `shuffle(k)` |
| iterations | clock `T` |
| colour, opacity, hue shift, thickness, cap, blend mode, glow, background, noise | style (hue shift = colour as a `time` signal) |
| my `timeshear` | `delay(span)` |

uji is a single, fixed stack: `jitter → scale → move → wave → rotate`.

## What wake can do that uji can't
1. **Reorder and repeat blocks.** For example, `rotate → scale → rotate(-)`, which counter-rotates inside the contraction. *Tested caveat:* with small steps, order hardly shows. Two near-identity maps differ only by a second-order term (Baker–Campbell–Hausdorff), so `scale → rotate` and `rotate → scale` look nearly the same even at 5 %/9° per step. Order becomes visible with nonlinear blocks (wave ↔ swirl) and with muting and repeating blocks, so the stack's real value is composition, not order alone.
2. **Modulate any parameter along the line**, not only over time. One parameter can tighten at the top of a ring and loosen at the bottom.
3. **Give every point its own clock** (`delay`), the generalisation of timeshear, and drive the delay field by any signal, such as noise.
4. **Use new blocks**: swirl, attract, and Lissajous or hand-drawn seeds.
5. **Reproduce any state exactly**: the seed is in the URL, and the same URL gives the same pixels and the same SVG.
6. **Plot by design**: SVG export runs the density and time budget I learned from the uji series (≤ 45 min, coverage ≤ 1.5) and warns before you export.

## Where it comes from
- **Harmonograph and Spirograph**: a point moved by summed periodic motions. In wake these are the `sine` signals.
- **Vera Molnár, *(Des)Ordres***: an ordered grid with controlled disorder. In wake this is `jitter` and `skip`.
- **Desmond Paul Henry's drawing machines**: mechanical motion leaving a trace. This is the whole idea of a wake.
- **uji (Noah Doersing)**: the immediate inspiration, credited once. No code, presets, glyphs or layout are taken from it.

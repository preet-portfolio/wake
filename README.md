# wake

An instrument for drawing the trace a line leaves as it moves through time.

A drawing is a **seed shape** plus an **ordered stack of blocks** (rotate, scale, move, wave, jitter, swirl, attract, delay) that runs once per step. Every step stays on the page. Any parameter can drift over time and along the line, and every point keeps its own clock. The whole state lives in the URL, so the same link always gives the same drawing.

- **Model:** [../docs/wake-model.md](../docs/wake-model.md)
- **Case study:** `case.html` (also served at `/case.html`)
- **First-use test plan:** [docs/first-use-test.md](docs/first-use-test.md)

## Live
What visitors see is a simulation. Line-heads (500–32,000, chosen per device from measured frame time) start on the seed shape and move through the block stack as a field of forces, with curl-noise **flow**. They leave marks on a fading trail buffer, and respawn when their life is over. **Drag** to stir, **hold** to pull, **right-drag or shift** to push, and tilt a phone to tip the flow. **✦ new**, a tap or **space** gives a new design. **plot** freezes time and saves the current trails as a plotter SVG. `?still` shows the exact still drawing, `?particles=8000` fixes the count and `?fps` shows the meter.

## A collection of 100,000
Every number from 1 to 100,000 is one fixed design (`#n=48213`). One in five is an **ink** piece (paper and pen, within the plot budget), and the rest are **colour** pieces (cosine-palette gradients, additive glow, soft edges, grain). Candidates are judged on the CPU only, so a number gives the same design on every device. `✦ colour` and `◯ ink` pull a random number; editing turns it into your own `#s=` link.

## Every visit is new
Opening wake without a link shows a random design from the collection, already moving. Links open the same design, also moving. **❚❚** pauses. Visitors who ask for reduced motion start paused.

## Run
```sh
npm install
npx vite            # http://localhost:5173  (add ?fps for the frame meter)
npx vite --host     # to open it on a phone on the same Wi-Fi
npm run build       # static site in dist/
```

## Exports
- **png:** the canvas.
- **svg:** plotter paths, with consecutive segments merged. The live budget in the panel estimates plot time and ink density for A4 with a 0.3 mm pen. `../tools/plotcheck.py` has the final say.
- **video:** a WebM of the drawing being made.

## Checks
```sh
npx playwright test            # still-view regression, determinism, collection, live, 60 s alive checks, videos
npx playwright test alive      # 60 s changed-pixels check on GPU and software rendering → reports/alive.json
npx playwright test video      # first 10 s on desktop and phone → reports/videos/
npx playwright test fps        # phone-emulated fps → reports/fps.json
npm run jscpd                  # copy check against uji's original source → reports/jscpd/
node scripts/gif.mjs           # case-study GIFs (needs `npx vite --port 5179` running)
```

## Credit
Inspired by [uji](https://github.com/doersino/uji) by Noah Doersing. wake shares no code with it (see `reports/jscpd/verdict.json`). The full list of sources, lineage, tools and fonts is in `credits.html`.

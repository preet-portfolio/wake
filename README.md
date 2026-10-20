# wake

An instrument for drawing the trace a line leaves as it moves through time.

A drawing is a **seed shape** plus an **ordered stack of blocks** (rotate, scale, move, wave, jitter, swirl, attract, delay) that runs once per step. Every step stays on the page. Any parameter can drift over time and along the line, and every point keeps its own clock. The whole state lives in the URL, so the same link always gives the same drawing.

- **Model:** [../docs/wake-model.md](../docs/wake-model.md)
- **Case study:** `case.html` (also served at `/case.html`)
- **First-use test plan:** [docs/first-use-test.md](docs/first-use-test.md)

## Every visit is new
Opening wake without a link generates a new stack, and the drawing then **drifts**: every parameter breathes slowly around the value you set, so changing a setting moves the centre it drifts around. **❚❚ hold** freezes the exact frame into a shareable link. Links always open still. Drift is off when the visitor asks for reduced motion, and it holds itself on devices that can't redraw at 20 fps or better. `?still` disables drift.

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
npx playwright test            # visual regression (20 states), determinism, fps
npx playwright test fps        # phone-emulated fps → reports/fps.json
npm run jscpd                  # copy check against uji's original source → reports/jscpd/
node scripts/gif.mjs           # case-study GIFs (needs `npx vite --port 5179` running)
```

## Credit
Inspired by [uji](https://github.com/doersino/uji) by Noah Doersing. wake shares no code with it (see `reports/jscpd/verdict.json`). The full list of sources, lineage, tools and fonts is in `credits.html`.

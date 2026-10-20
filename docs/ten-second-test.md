# The 10-second test: is it alive, and can you get a new one?

**Pass:** at least 4 of 5 people answer *yes* to "Is this alive?" **and** get a new design without help within 10 seconds.

## Who
Five people who haven't seen wake. At least two should use a phone, and at least one should not be a designer.

## Setup
- Open https://wake-black.vercel.app on *their* device (no link with `#n=`), so they see a random design.
- Start a timer when the page appears. Say only: **"Have a look at this."** Then stay silent for 10 seconds.

## Ask, in this order, after 10 seconds
1. **"Is this alive?"** Record yes, no or unsure, plus their words.
2. **"How would you get a different one?"** Record whether they *did* it already within the 10 s (tapped, pressed ✦ new or pressed space), whether they found it now, or whether they didn't find it.
3. **"What happens when you touch it?"** Record whether they discovered stirring or pulling.

## Record per person
| person | device | alive? (yes/no/unsure) | new design within 10 s? | how (✦ / tap / space) | touched it? | their words |
|---|---|---|---|---|---|---|

## After
- Put results in `docs/ten-second-results.md`.
- Each failure becomes one change, and then 5 new people are tested.
- Compare the device column with the frame-time telemetry: anyone who said "no" to *alive* on a slow device points at the tiering, not the design.

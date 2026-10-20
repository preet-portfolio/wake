# Card sort: does the collection have more than one personality?

**Pass:** the median person makes **at least 5 groups**, and **no more than 1 of the 12** designs gets called a waterfall.

## Who
Five people who haven't seen wake.

## Material
Twelve designs, each shown as a 5-second looping clip (not a still: the species differ in how they move). Use the census numbers so the set is reproducible. Take the first 12 numbers of `reports/census/after/census.json` whose species are not all the same, and record which numbers you used.

## Task (say only this)
1. "Put these into groups of ones that feel alike. Make as many or as few groups as you like." Time limit: 5 minutes.
2. Then, for each group: "What would you call this group?"
3. Finally: **"Does any of these look like a waterfall?"** Note which ones.

## Record per person
| person | number of groups | group names (their words) | designs called "waterfall" |
|---|---|---|---|

## Read the results
- Groups that match species (orbit, waves, grid…) mean the behaviours read as different to people, not just to the code.
- If people group by colour instead of motion, the species aren't distinct enough in motion. Strengthen tempo and mark differences first.
- Put results in `docs/card-sort-results.md`.

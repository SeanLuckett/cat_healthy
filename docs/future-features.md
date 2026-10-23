# Future features

Backlog of things deliberately deferred out of MVP (see
`cat-tracker-spec.md` → "Explicitly out of scope for MVP"), plus anything
new that comes up. Nothing here is committed — just tracked so it isn't
forgotten or accidentally reinvented.

Add new ideas at the bottom of the relevant section with a one-line why.
Move an item to "Done" (or delete it) once it ships.

## Data & food model

- **Food-entry UI.** Foods are currently inserted directly via `sqlite3`.
  A simple add/edit screen would remove the need to shell in whenever a
  new food shows up.
- **Kibble-specific portioning** (cup/bag conversions). Data model already
  supports it via `kcal_per_gram`; needs UI only if Mac's diet changes
  from wet-food-only.
- **Multi-food single meal.** A `feeding_events` row is one food + one
  grams amount, so there's no way to log a meal split across two foods
  (e.g. a food-transition period, mixing old and new food in one
  sitting) without either picking one food as a stand-in or logging two
  separate rows under the same meal slot. Came up transitioning Mac from
  Purina OM onto H&G — worked around by hand-computing the per-food
  split and logging a placeholder entry. Probably rare enough not to be
  worth building; flagging as something to evaluate if transitions like
  this keep happening.

## Weight & progress

- **Charts/trendlines** for weight history (Weight screen is list-only
  today).
- **Weight-gain goal support.** `dailyTarget()` has a documented TODO —
  falls through to the maintenance calculation. Needs its own surplus
  factor, ideally confirmed with the vet rather than guessed.
- **Tune `progressFlag` thresholds** (2%/week ceiling, 0.5%/week stalled
  cutoff) with the vet — currently starting points, not verified values.

## Notifications & UX

- **Reminders** for weigh-ins or unlogged meals (e.g. it's evening and no
  feeding logged yet).
- **Delete** for feedings/weight entries in the client. The server already
  has `DELETE /api/feedings/:id` and `DELETE /api/weight/:id`, but no UI
  calls them, so fixing a mistake means shelling into `sqlite3`. Came up
  when a triple-tapped "Log feeding" while the server was asleep produced
  three 17:39 dinners (slots 3–5) that had to be removed by hand.
- **Edit** for feedings/weight entries. Once delete exists, delete-and-relog
  covers it — fine for MVP, mildly annoying if typos are common.
- **Food-category-aware Today screen.** Today screen currently always shows
  both "Log feeding" and "Log treat" sections regardless of the selected
  food. `foods.category` (`wet`/`dry`/`treat`) already exists in the schema
  but isn't read by the client. Selecting a food with `category: 'treat'`
  should show only the treat-logging control (and preset `is_treat: true`);
  selecting `wet`/`dry` should show only meal-logging. Reduces the chance of
  mislogging a treat as a meal (or vice versa) and simplifies the screen.
  Also, when a `treat` food is selected, hide the suggested-grams readout —
  it's currently shown for any selected food, but the suggestion is derived
  from remaining meal budget and doesn't mean anything for a treat.
- **UI/UX pass on the Today screen.** Features have been added one at a
  time with no overall design, and it shows: after the grazing rework
  (`docs/grazing-plan.md`) the screen stacks three near-identical grams
  input + button rows (feeding, treat, put back), each with its own kcal
  preview, under a food picker and two suggestion lines. It's mostly used
  one-handed on a phone while holding a food bowl. Worth a deliberate
  pass on layout and flow — e.g. one grams input with a feeding / treat /
  put-back toggle, clearer hierarchy between the remaining-budget card
  and the suggestions, and larger tap targets. Pairs naturally with the
  food-category-aware item above.

## Done

- **Leftover-food tracking.** Shipped 2026-10-13 as a "Put back" entry
  (`is_put_back`) that gives the kcal of food returned to the fridge back
  to today's budget. See `docs/grazing-plan.md`.
- **Archive/unarchive foods.** Shipped 2026-10-23 as a Foods tab with an
  Archive/Unarchive button per food (`foods.archived`). Archived foods are
  hidden from the Today screen's picker but stay in the database, so past
  feedings keep their names and calories. Came up swapping out treats Mac
  no longer has.

## Out of scope indefinitely (revisit only if constraints change)

- Multi-cat / multi-user support
- Authentication
- Cloud hosting / remote access beyond home WiFi
- Auto-adjusting calorie targets based on `progressFlag` (this is
  intentionally a human-in-the-loop decision, not just deferred — see
  spec's "Safety flag, not auto-correction" section)

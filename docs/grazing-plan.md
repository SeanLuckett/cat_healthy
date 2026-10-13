# Plan: support grazing (multiple feedings, no meal slots)

Written 2026-10-13. Mac eats part of each serving and comes back to the
rest later. Unfinished food is never thrown out — it goes back to the
fridge at the end of the night. Logging "what he ate" by hand-subtracting
leftovers before each entry is error-prone, and the meal-slot model
(`mealsLeftToday = 3 - number of entries`) breaks as soon as a top-up is
logged as its own entry.

New model: **log what goes into the bowl; log what goes back to the fridge.**

Workflow: TDD (failing test first), one branch per step. Each branch is
cut from the previous one (stacked). **Stop after each step** so the work
can be checked by hand in the app before the next one starts.

## Step 1 — kcal preview under the grams field (`feature/kcal-preview`, from `main`)

- Under the feeding and treat grams inputs, show
  `30 g = 36 kcal · leaves 84 kcal today`, computed client-side from
  `grams × selectedFood.kcal_per_gram` and `status.remainingKcal`.
- If the entry would go over the remaining budget, show it in red with
  `… · 12 kcal over today's budget`.
- Hidden when the field is empty or 0.
- Client-only change; tests in `TodayScreen.test.tsx`.

## Step 2 — feedings, not meals (`feature/grazing-feedings`, from step 1)

- Hardcoded `FEEDING_TIMES = ["07:00", "12:00", "18:00"]` (server
  constant, replaces `MEALS_PER_DAY`).
- Pure `feedingsLeft(todaysEvents, now)` in `calorie.ts`:
  - the current window = since the latest feeding time ≤ now (or start
    of day if before the first one)
  - `feedingsLeft = (# feeding times after now) + (1 if no non-treat food
    was logged in the current window, else 0)`
  - so a top-up in the same window doesn't change the next suggestion's
    count of feedings left
- `StatusResponse.mealsLeftToday` → `feedingsLeftToday`;
  `suggestedGramsPerFood` = remaining kcal / feedingsLeft (null when 0).
- Today screen:
  - card: `N feeding(s) left`
  - `Next serving: Z g` (when there's a suggestion) and
    `Rest of today: Y g` (remainingKcal / kcal_per_gram, client-side)
  - tapping the next-serving suggestion fills the grams input
  - history table: drop Breakfast/Lunch/Dinner; type column shows
    `Food` / `Treat`
- Stop writing `meal_slot` (leave the nullable DB column in place, no
  migration); remove `computeMealSlot`, `client/src/mealSlot.ts` and its
  tests, and `meal_slot` from the shared type.
- Update `docs/cat-tracker-spec.md` mentions of meal slots / `MEALS_PER_DAY`.

## Step 3 — "Put back" entry (`feature/put-back`, from step 2)

- New nullable-safe column on `feeding_events`:
  `is_put_back INTEGER NOT NULL DEFAULT 0` (added with an
  `ALTER TABLE` guarded by a column check in `db.ts`).
- A put-back entry records grams of a food returned to the fridge; its
  kcal is **subtracted** from consumed in `remainingBudget`. It does not
  count as a feeding for `feedingsLeft`.
- `POST /api/feedings` accepts `is_put_back: true` (mutually exclusive
  with `is_treat`).
- Today screen: a third input + `Put back` button; history table shows
  type `Put back` with the grams as negative (e.g. `−7`).
- Move "Leftover-food tracking" in `docs/future-features.md` to done.

## Progress

- [x] Step 1 (awaiting manual review)
- [ ] Step 2
- [ ] Step 3

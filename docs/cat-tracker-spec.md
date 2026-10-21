# Cat calorie & weight tracker — implementation spec

## Purpose

A small, local-only web app to track a single cat's (Macchiato, aka "Mac") daily
calorie intake against a computed target, and to track his weight over time as
he works toward a target weight. Single household, single user (occasionally
two — see multi-caregiver note below), no cloud dependency.

## Non-negotiable constraints

- Runs entirely on one laptop. No external hosting, no cloud database.
- Accessible from any device (phone, tablet, other laptop) on the same home
  WiFi network via the laptop's LAN IP or an mDNS hostname.
- No authentication. Trusted home network only.
- Single cat, single user profile. Do not build for multi-cat or multi-user.
- Wet food only for MVP. Do not build kibble-specific UI (e.g. cup-based
  portioning) — the data model already supports it via `kcal_per_gram`, so
  this is a fast follow, not a redesign, if it's ever needed.

## Stack

- **Server**: Node.js + TypeScript + Express. Serves both the built frontend
  (static files) and the JSON API from a single process/port in production.
- **Database**: SQLite via `better-sqlite3`. Single file (`cat.db`), not
  checked into version control.
- **Client**: React + TypeScript, built with Vite.
- **Dev workflow**: Vite dev server (HMR) with `/api` proxied to Express on a
  separate port. Production is a single `npm run build && npm start` that
  serves everything from Express on `0.0.0.0:3000`.
- **Monorepo layout** (npm workspaces):

```
cat-tracker/
├── server/
│   ├── src/
│   │   ├── index.ts          # Express app, binds 0.0.0.0
│   │   ├── db.ts             # better-sqlite3 setup + schema migrations
│   │   ├── calorie.ts        # rer(), dailyTarget(), remainingBudget(),
│   │   │                     # gramsForServing(), weeklyLossRate()
│   │   └── routes/
│   │       ├── foods.ts
│   │       ├── feedings.ts
│   │       ├── weight.ts
│   │       └── status.ts
│   └── tsconfig.json
├── client/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── theme.ts           # Mantine theme tokens — see "UI library" below
│   │   ├── pages/TodayScreen.tsx
│   │   └── pages/WeightScreen.tsx
│   ├── vite.config.ts
│   └── tsconfig.json
├── shared/
│   └── types.ts               # Food, FeedingEvent, WeightLog, CatProfile,
│                               # StatusResponse — imported by both sides
├── cat.db                     # gitignored
└── package.json
```

## UI library

- **Component library**: Mantine (`@mantine/core` + `@mantine/hooks`). Wrap
  the app in `<MantineProvider>` in `client/src/App.tsx`; no CSS modules or
  hand-rolled component CSS beyond layout/spacing.
- **Theme tokens** (`client/src/theme.ts`, passed to `MantineProvider`):
  - `primaryColor`: one accent color for buttons/links/active state — a
    single hue is enough, don't invent a second "brand" color.
  - Use Mantine's default gray scale for background, borders, and body
    text — do not define a custom neutral palette.
  - `progressFlag` banner (Today and Weight screens) uses Mantine's
    built-in `yellow`/`red` via `<Alert color="...">` — do not invent
    custom warning colors. Mapping: `too_fast` and `reversing` both
    render red, `stalled` renders yellow, `null` renders no banner.
    `too_fast` and `reversing` are opposite problems (losing too
    fast vs. not losing at all) and share a color, so distinguish
    them by `Alert` title/icon rather than color:
    - `too_fast` → title "Losing too fast"
    - `reversing` → title "Gaining weight"
    - `stalled` → title "Progress stalled"
- Use Mantine's components directly: `Button`, `TextInput`, `NumberInput`,
  `Select`, `Table`, `Alert`, `Card`. Do not build custom form controls.

## Data model

```sql
CREATE TABLE foods (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kcal_per_gram REAL NOT NULL,
  category TEXT NOT NULL DEFAULT 'wet',  -- 'wet' | 'dry' | 'treat'
  notes TEXT
);

CREATE TABLE weight_log (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,             -- ISO date, YYYY-MM-DD
  weight_kg REAL NOT NULL,
  notes TEXT
);

CREATE TABLE feeding_events (
  id INTEGER PRIMARY KEY,
  timestamp TEXT NOT NULL,        -- ISO datetime
  food_id INTEGER NOT NULL REFERENCES foods(id),
  grams REAL NOT NULL,
  meal_slot INTEGER,              -- legacy, no longer written (see FEEDING_TIMES)
  is_treat INTEGER NOT NULL DEFAULT 0,
  is_put_back INTEGER NOT NULL DEFAULT 0 -- grams returned to the fridge; subtracted from consumed
);

CREATE TABLE cat_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),   -- enforce single row
  target_weight_kg REAL,
  life_stage_factor REAL NOT NULL DEFAULT 1.2,  -- neutered adult default
  goal TEXT NOT NULL DEFAULT 'weight_loss',     -- 'weight_loss' | 'maintenance' | 'weight_gain'
  manual_override_kcal REAL                     -- NULL = use the formula; set = use this instead
);
```

`manual_override_kcal` exists so a human (you, or the vet) can override the
computed target — e.g. "actually feed him 195 today" — without touching code
or waiting on a deploy. It's edited directly via `sqlite3`, same as the rest
of `cat_profile`. This is deliberately a manual lever, not something the app
sets automatically in response to `progressFlag` — see the calorie engine
section below.

`foods` and `cat_profile` are populated directly via `sqlite3 cat.db` for
MVP — no admin UI. Do not build a food-entry screen yet.

`FEEDING_TIMES` (in `calorie.ts`, default `["07:00", "12:00", "18:00"]`) is a
server-side TypeScript constant, not a database value and not
user-configurable in the UI. Mac grazes, so entries aren't tied to meals:
each time opens a window running to the next time (the first also reaches
back to midnight), and everything served in a window — top-ups included —
counts as one feeding. Changing the schedule is a
one-line code edit + restart.

## Calorie engine (`server/src/calorie.ts`)

```ts
function rer(weightKg: number): number {
  return 70 * Math.pow(weightKg, 0.75);
}

const WEIGHT_LOSS_TARGET_FACTOR = 0.8; // applied directly to RER at target weight,
// not stacked on life_stage_factor — see below
const SAFE_FLOOR_FACTOR = 0.7; // never target below 70% of RER at *current* weight;
// going lower risks hepatic lipidosis in cats

interface DailyTargetResult {
  kcal: number;
  belowSafeFloor: boolean; // true if kcal is below SAFE_FLOOR_FACTOR * rer(currentWeightKg)
}

function dailyTarget(
  currentWeightKg: number,
  profile: CatProfile,
): DailyTargetResult {
  let kcal: number;

  if (profile.manual_override_kcal != null) {
    kcal = profile.manual_override_kcal;
  } else if (profile.goal === "weight_loss") {
    // Anchored to goal weight, not current weight — an overweight cat's RER
    // is overestimated by using current weight, since the extra mass isn't
    // metabolically active the way lean mass is. The target stays fixed for
    // the duration of the diet; weigh-ins feed weeklyLossRate() as a safety
    // check, not this formula. See "Weigh-ins and the calorie target" below.
    //
    // Uses WEIGHT_LOSS_TARGET_FACTOR directly against RER at target weight —
    // deliberately does NOT also multiply by life_stage_factor. That factor
    // represents maintenance energy for a healthy-weight cat; stacking it on
    // top of the weight-loss factor compounds two adjustments meant to be
    // alternatives, not multiplicands, and would silently shift the
    // weight-loss target if life_stage_factor is ever retuned for an
    // unrelated reason (e.g. an activity-level change).
    const targetWeight = profile.target_weight_kg ?? currentWeightKg;
    kcal = rer(targetWeight) * WEIGHT_LOSS_TARGET_FACTOR;
  } else if (profile.goal === "weight_gain") {
    // TODO: not yet implemented — falls through to the maintenance
    // calculation below. Needs its own surplus factor (analogous to
    // WEIGHT_LOSS_TARGET_FACTOR) before this goal is usable; confirm the
    // value with the vet rather than guessing one in code.
    kcal = rer(currentWeightKg) * profile.life_stage_factor;
  } else {
    // maintenance
    kcal = rer(currentWeightKg) * profile.life_stage_factor;
  }

  const belowSafeFloor = kcal < SAFE_FLOOR_FACTOR * rer(currentWeightKg);
  return { kcal, belowSafeFloor };
}

function remainingBudget(
  dailyTargetKcal: number,
  todaysEvents: FeedingEvent[],
  foods: Food[],
): number {
  const consumed = todaysEvents.reduce((sum, e) => {
    const food = foods.find((f) => f.id === e.food_id)!;
    return sum + e.grams * food.kcal_per_gram;
  }, 0);
  return dailyTargetKcal - consumed;
}

function gramsForServing(
  remainingKcal: number,
  feedingsLeftToday: number, // from feedingsLeft(todaysEvents, now)
  selectedFood: Food,
): number | null {
  if (feedingsLeftToday <= 0) return null; // no feedings left to suggest a portion for
  if (remainingKcal <= 0) return null; // budget used up
  const kcalThisServing = remainingKcal / feedingsLeftToday;
  return kcalThisServing / selectedFood.kcal_per_gram;
}

/* UI note: when gramsForServing returns `null`, hide the suggested-grams readout on the
Today screen. A treat can still be logged manually with a typed-in grams
value — it just won't have a computed suggestion. */

const EWMA_SPAN_DAYS = 10;
const EWMA_ALPHA = 2 / (EWMA_SPAN_DAYS + 1); // same convention as pandas ewm(span=...)
const TREND_WINDOW_DAYS = 7;
const MIN_TREND_WEIGHIN_DAYS = 4; // warm-up: no rate until there's enough history
const MIN_TREND_SPAN_DAYS = 10;

// Time-aware EWMA: the smoothing factor is compounded over the days since the
// previous weigh-in, so irregular weigh-ins are weighted by elapsed time, not
// by row. With daily weigh-ins this matches pandas ewm(span=10, adjust=False).
// Same-day readings are averaged into one point.
const weightEwma = (logs: WeightLog[]): EwmaPoint[] => {
  // for each date in order:
  //   alpha = 1 - (1 - EWMA_ALPHA) ** daysSincePrevious
  //   ewma  = prevEwma + alpha * (weight - prevEwma)
};

// Fraction of body weight lost per week (negative = gaining), measured as the
// change in the smoothed EWMA over the last 7 days — never between two raw
// weigh-ins, so one noisy reading can't flip the progress flag.
const weeklyLossRate = (logs: WeightLog[]): number | null => {
  const points = weightEwma(logs);
  if (points.length < MIN_TREND_WEIGHIN_DAYS) return null;
  if (span(points) < MIN_TREND_SPAN_DAYS) return null;
  const latest = points.at(-1);
  // EWMA holds between weigh-ins: use the last point on or before latest - 7d
  const base = lastPointOnOrBefore(points, latest.date - TREND_WINDOW_DAYS);
  return (base.ewma - latest.ewma) / base.ewma;
};
```

**Safety flag, not auto-correction**: `weeklyLossRate()` feeds a small
classifier, not just a single threshold check:

```ts
function progressFlag(
  rate: number | null,
  goal: CatProfile["goal"],
): "too_fast" | "stalled" | "reversing" | null {
  if (rate == null || goal !== "weight_loss") return null;
  if (rate > 0.02) return "too_fast"; // losing >2%/week
  if (rate < 0) return "reversing"; // gaining
  if (rate < 0.005) return "stalled"; // <0.5%/week — barely moving
  return null;
}
```

`/api/status` includes `progressFlag` alongside `weeklyLossRate`. The UI
banner (Today and Weight screens) renders for any non-null value —
`too_fast`/`reversing` in red, `stalled` in yellow. There is no "on track"
banner; when no flag is set, the Weight screen shows a dimmed one-line trend
readout instead (or a warm-up note while `weeklyLossRate` is null). Above
the banner/trend line, the Weight screen always shows the latest EWMA value
(`smoothedWeightKg`) as "Avg weight" once there's at least one weigh-in. As with the original
`progressFlag`, the app never auto-adjusts `dailyTarget()` in response;
any of these three states is a cue for the vet or `manual_override_kcal`,
not an if-statement. (0.5%/week as the "stalled" cutoff is a starting
point — worth confirming with the vet, same as the 2% ceiling.)

## Weigh-ins and the calorie target

Weigh-ins do **not** automatically recompute `dailyTarget()`. The formula is
anchored to `target_weight_kg` (goal weight) for the entire weight-loss
period, not to whatever the most recent `weight_log` entry says. This is
intentional: RER computed from an overweight cat's _current_ weight
overestimates his true metabolic need, since excess fat isn't metabolically
active the way lean mass is — the standard approach is to calculate off the
goal weight from day one and hold it there.

New weigh-ins still matter — they feed `weeklyLossRate()`, which is a
monitoring signal, not a formula input. If the observed rate drifts too far
from what the fixed target implies (either too fast or stalled out), that's
a cue for a human to reassess — via a vet visit or by setting
`manual_override_kcal` directly — not something the app should decide on its
own by silently recalculating.

`currentWeightKg` passed into `dailyTarget()` is the most recent
`weight_log` entry by date. If `weight_log` is empty and
`target_weight_kg` is also unset on `cat_profile`, there's nothing to
anchor the weight-loss formula to — the seed script should set
`target_weight_kg` directly, or log an initial weight, before first use.

## Day boundary

All "today" queries filter by calendar date, not a rolling 24-hour window:

```sql
WHERE date(timestamp) = date('now', 'localtime')
```

Single machine, single local clock — no timezone handling needed beyond this.

## Input validation

`POST /api/feedings` and `POST /api/weight` reject non-positive `grams`
/ `weight_kg` and a `food_id` that doesn't exist in `foods`, returning a
400 with a short error message. Nothing fancier needed for MVP — just
enough that a mistyped value doesn't silently corrupt a day's log.

## Multi-caregiver behavior

No client-side caching of `remainingBudget` or any derived value. Every
screen fetches current state from the server on load and re-fetches after
any mutation (logging a feeding, logging a weight). This is required, not
optional — it's what makes it safe for two people to feed Mac from separate
phones without double-feeding him.

## API endpoints

| Method | Path                            | Purpose                                                                        |
| ------ | ------------------------------- | ------------------------------------------------------------------------------ |
| GET    | `/api/foods`                    | List all foods                                                                 |
| GET    | `/api/status`                   | Today's target, remaining budget, feedings left, `weeklyLossRate`, `progressFlag`, `smoothedWeightKg` |
| POST   | `/api/feedings`                 | Log a feeding event (food or treat); returns updated `/api/status`             |
| GET    | `/api/feedings?date=YYYY-MM-DD` | List feeding events for a date (defaults to today)                             |
| GET    | `/api/weight`                   | List weight log entries, most recent first                                     |
| POST   | `/api/weight`                   | Log a new weight entry; returns updated `weeklyLossRate`, `progressFlag`, `smoothedWeightKg` |
| GET    | `/api/profile`                  | Get the (single) cat profile row                                               |
| DELETE | `/api/feedings/:id`             | Delete a mis-logged feeding event; returns updated `/api/status`               |
| DELETE | `/api/weight/:id`               | Delete a mis-logged weight entry; returns updated `weeklyLossRate`             |

No `PUT`/`DELETE` on `foods` or `profile` for MVP — edit via `sqlite3`
directly, these change rarely. `feedings` and `weight_log` get `DELETE`
(above) since hand-typed grams/weights are the likely source of typos, and
losing an evening's log to a fat-fingered entry isn't acceptable. No `PUT`
on either — delete and re-log is simpler than partial-edit UI for MVP.

## UI screens

**Today screen** (primary/default view):

- Remaining calorie budget for the day, and how many feedings are left.
- If `progressFlag` is set, a visible banner with the current rate.
- Food dropdown (from `/api/foods`) → shows "Next serving" grams (remaining
  budget split across feedings left; tapping it fills the grams input) and
  "Rest of today" grams (the whole remaining budget in that food).
- "Log feeding" input: enter grams put in the bowl → posts to
  `/api/feedings`, recalculates and re-displays remaining budget/feedings
  immediately. Top-ups are just more entries. A kcal preview under the
  input shows what the entry is worth and what it leaves for today.
- Separate "log a treat" affordance: same food-picker + grams flow, posts
  with `is_treat: true`.
- "Put back in fridge" affordance: grams of leftovers returned to the
  fridge, posts with `is_put_back: true`. Gives those kcal back to today's
  budget and doesn't count as a feeding. Shown as negative grams in the
  history table.

**Weight screen**:

- Simple list of weight log entries (date, weight, notes) — no charting.
- Form to add a new entry.
- Same `progressFlag` banner if applicable.

## Explicitly out of scope for MVP

- Food-entry UI (direct DB inserts only)
- Kibble-specific portioning (cup/bag conversions)
- Leftover-food tracking (`grams_fed` is treated as `grams_eaten` — revisit
  only if Mac's feeding regimen changes from portion-controlled wet food)
- Multi-cat or multi-user support
- Authentication
- Charts/trendlines
- Notifications/reminders
- Auto-adjusting calorie targets based on the loss-rate flag

## Suggested build order for Claude Code

1. Scaffold the monorepo (npm workspaces, `shared/types.ts`, tsconfig for
   both packages). For `client/`, base the PostCSS config and Mantine
   provider setup on `mantinedev/vite-min-template` rather than configuring
   from scratch — fold it into `client/` as a workspace member, don't treat
   it as the repo root.
2. `server/src/db.ts`: schema creation, seed script for `cat_profile` (one
   row) and a couple of sample `foods` rows for local testing.
3. `server/src/calorie.ts` with unit tests for `rer`, `dailyTarget`,
   `remainingBudget`, `gramsForServing`, `feedingsLeft`, `weeklyLossRate` — these are pure
   functions and the easiest place to catch math errors before they reach
   the UI.
4. API routes, wired to the calorie engine.
5. React `TodayScreen` and `WeightScreen`, Vite dev proxy to Express.
6. Production build path: `vite build` → Express static serving → confirm
   reachable from a phone on the same WiFi via the laptop's LAN IP.

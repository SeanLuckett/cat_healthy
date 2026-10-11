import type { CatProfile, Food, FeedingEvent, WeightLog } from "../../shared/types";

export const rer = (weightKg: number): number => {
  return 70 * Math.pow(weightKg, 0.75);
};

const WEIGHT_LOSS_TARGET_FACTOR = 0.8; // applied directly to RER at target weight,
// not stacked on life_stage_factor — see below
const SAFE_FLOOR_FACTOR = 0.7; // never target below 70% of RER at *current* weight;
// going lower risks hepatic lipidosis in cats

export interface DailyTargetResult {
  kcal: number;
  belowSafeFloor: boolean; // true if kcal is below SAFE_FLOOR_FACTOR * rer(currentWeightKg)
}

export const dailyTarget = (
  currentWeightKg: number,
  profile: CatProfile,
): DailyTargetResult => {
  let kcal: number;

  if (profile.manual_override_kcal != null) {
    kcal = profile.manual_override_kcal;
  } else if (profile.goal === "weight_loss") {
    // Anchored to goal weight, not current weight — an overweight cat's RER
    // is overestimated by using current weight, since the extra mass isn't
    // metabolically active the way lean mass is. The target stays fixed for
    // the duration of the diet; weigh-ins feed weeklyLossRate() as a safety
    // check, not this formula. See "Weigh-ins and the calorie target" in the spec.
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
};

export const remainingBudget = (
  dailyTargetKcal: number,
  todaysEvents: FeedingEvent[],
  foods: Food[],
): number => {
  const consumed = todaysEvents.reduce((sum, e) => {
    const food = foods.find((f) => f.id === e.food_id)!;
    return sum + e.grams * food.kcal_per_gram;
  }, 0);
  return dailyTargetKcal - consumed;
};

export const gramsForMeal = (
  remainingKcal: number,
  mealsLeftToday: number,
  selectedFood: Food,
): number | null => {
  if (mealsLeftToday <= 0) return null; // no meals left to suggest a portion for
  const kcalThisMeal = remainingKcal / mealsLeftToday;
  return kcalThisMeal / selectedFood.kcal_per_gram;
};

/* UI note: when gramsForMeal returns `null`, hide the suggested-grams readout on the
Today screen. A treat can still be logged manually with a typed-in grams
value — it just won't have a computed suggestion. */

export const computeMealSlot = (
  todaysEvents: FeedingEvent[],
  isTreat: boolean,
): number | null => {
  if (isTreat) return null;
  return todaysEvents.filter((e) => !e.is_treat).length + 1;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const EWMA_SPAN_DAYS = 10;
const EWMA_ALPHA = 2 / (EWMA_SPAN_DAYS + 1); // same convention as pandas ewm(span=...)
const TREND_WINDOW_DAYS = 7;
// Warm-up: an EWMA is seeded from its first reading, so with only a handful
// of weigh-ins it mostly echoes the raw values back. Hold off on a rate (and
// therefore any banner) until there's enough history for smoothing to mean
// something.
const MIN_TREND_WEIGHIN_DAYS = 4;
const MIN_TREND_SPAN_DAYS = 10;

const daysBetweenDates = (a: string, b: string): number => {
  return Math.round((Date.parse(b) - Date.parse(a)) / MS_PER_DAY);
};

const shiftDate = (date: string, days: number): string => {
  return new Date(Date.parse(date) + days * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
};

export interface EwmaPoint {
  date: string;
  ewma: number;
}

// Time-aware exponentially weighted moving average of weight. Weigh-ins are
// irregular, so the smoothing factor is compounded over the days elapsed
// since the previous weigh-in instead of applied once per row — with daily
// weigh-ins this matches pandas ewm(span=10, adjust=False), and a reading
// after a long gap pulls the average proportionally harder. Multiple
// readings on the same date are averaged into one.
export const weightEwma = (logs: WeightLog[]): EwmaPoint[] => {
  const readingsByDate = new Map<string, number[]>();
  for (const log of logs) {
    const readings = readingsByDate.get(log.date) ?? [];
    readings.push(log.weight_kg);
    readingsByDate.set(log.date, readings);
  }

  const points: EwmaPoint[] = [];
  for (const date of [...readingsByDate.keys()].sort()) {
    const readings = readingsByDate.get(date)!;
    const weight = readings.reduce((sum, w) => sum + w, 0) / readings.length;
    const prev = points[points.length - 1];
    if (!prev) {
      points.push({ date, ewma: weight });
      continue;
    }
    const alpha =
      1 - Math.pow(1 - EWMA_ALPHA, daysBetweenDates(prev.date, date));
    points.push({ date, ewma: prev.ewma + alpha * (weight - prev.ewma) });
  }
  return points;
};

// Fraction of body weight lost per week (negative = gaining), measured on the
// smoothed EWMA over the last TREND_WINDOW_DAYS rather than between two raw
// weigh-ins, so a single noisy reading can't flip the progress flag.
export const weeklyLossRate = (logs: WeightLog[]): number | null => {
  const points = weightEwma(logs);
  if (points.length < MIN_TREND_WEIGHIN_DAYS) return null;

  const latest = points[points.length - 1];
  if (daysBetweenDates(points[0].date, latest.date) < MIN_TREND_SPAN_DAYS) {
    return null;
  }

  // The EWMA holds its value between weigh-ins, so its value a week ago is
  // the point from the last weigh-in on or before that date.
  const windowStart = shiftDate(latest.date, -TREND_WINDOW_DAYS);
  const base = points.filter((p) => p.date <= windowStart).pop()!;
  return (base.ewma - latest.ewma) / base.ewma;
};

export type ProgressFlag = "too_fast" | "stalled" | "reversing" | null;

export const progressFlag = (
  rate: number | null,
  goal: CatProfile["goal"],
): ProgressFlag => {
  if (rate == null || goal !== "weight_loss") return null;
  if (rate > 0.02) return "too_fast"; // losing >2%/week
  if (rate < 0) return "reversing"; // gaining
  if (rate < 0.005) return "stalled"; // <0.5%/week — barely moving
  return null;
};

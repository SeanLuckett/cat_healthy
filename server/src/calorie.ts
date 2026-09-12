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

const MIN_DAYS_BETWEEN_WEIGHINS = 3; // below this, day-to-day noise swamps the signal

const daysBetweenDates = (a: string, b: string): number => {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(b) - Date.parse(a)) / msPerDay);
};

export const weeklyLossRate = (logs: WeightLog[]): number | null => {
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return null;

  // Walk backward from the latest entry for the most recent prior one at
  // least MIN_DAYS_BETWEEN_WEIGHINS away, rather than always using the
  // immediately-preceding row — keeps a same-week check-in from getting
  // multiplied up into a misleading weekly rate.
  const curr = sorted[sorted.length - 1];
  let prev: WeightLog | undefined;
  for (let i = sorted.length - 2; i >= 0; i--) {
    if (
      daysBetweenDates(sorted[i].date, curr.date) >= MIN_DAYS_BETWEEN_WEIGHINS
    ) {
      prev = sorted[i];
      break;
    }
  }
  if (!prev) return null; // not enough spread between weigh-ins yet

  const daysBetween = daysBetweenDates(prev.date, curr.date);
  const pctChange = (prev.weight_kg - curr.weight_kg) / prev.weight_kg;
  return (pctChange / daysBetween) * 7;
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

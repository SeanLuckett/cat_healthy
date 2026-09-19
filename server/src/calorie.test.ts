import { describe, it, expect } from "vitest";
import {
  rer,
  dailyTarget,
  remainingBudget,
  gramsForMeal,
  computeMealSlot,
  weeklyLossRate,
  progressFlag,
} from "./calorie.js";
import type { CatProfile, Food, FeedingEvent, WeightLog } from "../../shared/types";

const makeProfile = (overrides: Partial<CatProfile> = {}): CatProfile => ({
  id: 1,
  target_weight_kg: 4.5,
  life_stage_factor: 1.2,
  goal: "weight_loss",
  manual_override_kcal: null,
  ...overrides,
});

describe("rer", () => {
  it("computes resting energy requirement", () => {
    // 70 * 5^0.75 ≈ 234.1
    expect(rer(5)).toBeCloseTo(234.08, 1);
  });
});

describe("dailyTarget", () => {
  it("uses manual override when set, ignoring goal", () => {
    const profile = makeProfile({ manual_override_kcal: 195 });
    const result = dailyTarget(6, profile);
    expect(result.kcal).toBe(195);
  });

  it("anchors weight_loss target to target_weight_kg, not current weight", () => {
    const profile = makeProfile({ target_weight_kg: 4.5, goal: "weight_loss" });
    const result = dailyTarget(6, profile); // current weight heavier than target
    expect(result.kcal).toBeCloseTo(rer(4.5) * 0.8, 5);
  });

  it("falls back to current weight for weight_loss if target_weight_kg is unset", () => {
    const profile = makeProfile({ target_weight_kg: null, goal: "weight_loss" });
    const result = dailyTarget(6, profile);
    expect(result.kcal).toBeCloseTo(rer(6) * 0.8, 5);
  });

  it("does not stack life_stage_factor on top of the weight-loss factor", () => {
    const profile = makeProfile({
      target_weight_kg: 4.5,
      goal: "weight_loss",
      life_stage_factor: 1.4,
    });
    const result = dailyTarget(6, profile);
    expect(result.kcal).toBeCloseTo(rer(4.5) * 0.8, 5);
  });

  it("computes maintenance using current weight and life_stage_factor", () => {
    const profile = makeProfile({ goal: "maintenance", life_stage_factor: 1.2 });
    const result = dailyTarget(5, profile);
    expect(result.kcal).toBeCloseTo(rer(5) * 1.2, 5);
  });

  it("weight_gain falls through to maintenance-style calc (not yet implemented)", () => {
    const profile = makeProfile({ goal: "weight_gain", life_stage_factor: 1.2 });
    const result = dailyTarget(5, profile);
    expect(result.kcal).toBeCloseTo(rer(5) * 1.2, 5);
  });

  it("flags belowSafeFloor when target drops below 70% of RER at current weight", () => {
    // Heavy current weight with a much lighter goal weight can push the
    // target below the safe floor computed off current weight.
    const profile = makeProfile({ target_weight_kg: 3.0, goal: "weight_loss" });
    const result = dailyTarget(8, profile);
    expect(result.belowSafeFloor).toBe(true);
  });

  it("does not flag belowSafeFloor for a reasonable maintenance target", () => {
    const profile = makeProfile({ goal: "maintenance" });
    const result = dailyTarget(5, profile);
    expect(result.belowSafeFloor).toBe(false);
  });
});

describe("remainingBudget", () => {
  const foods: Food[] = [
    { id: 1, name: "Wet A", kcal_per_gram: 1.0, category: "wet", notes: null },
    { id: 2, name: "Wet B", kcal_per_gram: 0.8, category: "wet", notes: null },
  ];

  it("subtracts consumed kcal from the daily target", () => {
    const events: FeedingEvent[] = [
      { id: 1, timestamp: "2026-01-01T08:00:00", food_id: 1, grams: 50, meal_slot: 1, is_treat: false },
      { id: 2, timestamp: "2026-01-01T12:00:00", food_id: 2, grams: 25, meal_slot: 2, is_treat: false },
    ];
    // consumed = 50*1.0 + 25*0.8 = 70
    expect(remainingBudget(200, events, foods)).toBeCloseTo(130, 5);
  });

  it("returns the full target when no events logged yet", () => {
    expect(remainingBudget(200, [], foods)).toBe(200);
  });
});

describe("gramsForMeal", () => {
  const food: Food = { id: 1, name: "Wet A", kcal_per_gram: 1.0, category: "wet", notes: null };

  it("splits remaining kcal evenly across meals left", () => {
    expect(gramsForMeal(100, 2, food)).toBeCloseTo(50, 5);
  });

  it("returns null when there are no meals left", () => {
    expect(gramsForMeal(100, 0, food)).toBeNull();
  });
});

describe("computeMealSlot", () => {
  const makeEvent = (overrides: Partial<FeedingEvent> = {}): FeedingEvent => ({
    id: 1,
    timestamp: "2026-01-01T08:00:00",
    food_id: 1,
    grams: 50,
    meal_slot: 1,
    is_treat: false,
    ...overrides,
  });

  it("returns null for a treat, even with existing non-treat events today", () => {
    const todaysEvents = [makeEvent({ id: 1, meal_slot: 1, is_treat: false })];
    expect(computeMealSlot(todaysEvents, true)).toBeNull();
  });

  it("returns 1 for the first non-treat feeding of an empty day", () => {
    expect(computeMealSlot([], false)).toBe(1);
  });

  it("counts only non-treat events when numbering the next meal", () => {
    const todaysEvents = [
      makeEvent({ id: 1, meal_slot: 1, is_treat: false }),
      makeEvent({ id: 2, meal_slot: null, is_treat: true }),
    ];
    expect(computeMealSlot(todaysEvents, false)).toBe(2);
  });

  it("is uncapped — does not clamp to MEALS_PER_DAY", () => {
    const todaysEvents = [
      makeEvent({ id: 1, meal_slot: 1, is_treat: false }),
      makeEvent({ id: 2, meal_slot: 2, is_treat: false }),
      makeEvent({ id: 3, meal_slot: 3, is_treat: false }),
    ];
    expect(computeMealSlot(todaysEvents, false)).toBe(4);
  });
});

describe("weeklyLossRate", () => {
  it("returns null with fewer than 2 entries", () => {
    const logs: WeightLog[] = [
      { id: 1, date: "2026-01-01", weight_kg: 5, notes: null },
    ];
    expect(weeklyLossRate(logs)).toBeNull();
  });

  it("returns null if no prior entry is at least 3 days before the latest", () => {
    const logs: WeightLog[] = [
      { id: 1, date: "2026-01-01", weight_kg: 5.0, notes: null },
      { id: 2, date: "2026-01-02", weight_kg: 4.98, notes: null },
    ];
    expect(weeklyLossRate(logs)).toBeNull();
  });

  it("computes a weekly percentage loss rate from the most recent qualifying pair", () => {
    const logs: WeightLog[] = [
      { id: 1, date: "2026-01-01", weight_kg: 5.0, notes: null },
      { id: 2, date: "2026-01-08", weight_kg: 4.9, notes: null },
    ];
    // pctChange = (5.0-4.9)/5.0 = 0.02 over 7 days -> *7/7 = 0.02/week
    expect(weeklyLossRate(logs)).toBeCloseTo(0.02, 5);
  });

  it("skips a same-week check-in and uses the more distant prior entry", () => {
    const logs: WeightLog[] = [
      { id: 1, date: "2026-01-01", weight_kg: 5.0, notes: null },
      { id: 2, date: "2026-01-08", weight_kg: 4.9, notes: null },
      { id: 3, date: "2026-01-09", weight_kg: 4.89, notes: null }, // only 1 day later
    ];
    // Should use day 1 -> day 9 (8 days), not day 8 -> day 9 (1 day)
    const rate = weeklyLossRate(logs);
    const expectedPct = (5.0 - 4.89) / 5.0;
    expect(rate).toBeCloseTo((expectedPct / 8) * 7, 5);
  });

  it("returns a negative rate when weight increases (reversing)", () => {
    const logs: WeightLog[] = [
      { id: 1, date: "2026-01-01", weight_kg: 5.0, notes: null },
      { id: 2, date: "2026-01-08", weight_kg: 5.1, notes: null },
    ];
    expect(weeklyLossRate(logs)).toBeLessThan(0);
  });
});

describe("progressFlag", () => {
  it("returns null when rate is null", () => {
    expect(progressFlag(null, "weight_loss")).toBeNull();
  });

  it("returns null for non-weight_loss goals regardless of rate", () => {
    expect(progressFlag(0.05, "maintenance")).toBeNull();
    expect(progressFlag(-0.05, "weight_gain")).toBeNull();
  });

  it("flags too_fast above 2%/week", () => {
    expect(progressFlag(0.025, "weight_loss")).toBe("too_fast");
  });

  it("flags reversing for negative rate", () => {
    expect(progressFlag(-0.01, "weight_loss")).toBe("reversing");
  });

  it("flags stalled below 0.5%/week", () => {
    expect(progressFlag(0.002, "weight_loss")).toBe("stalled");
  });

  it("returns null for a healthy rate between 0.5% and 2%", () => {
    expect(progressFlag(0.01, "weight_loss")).toBeNull();
  });
});

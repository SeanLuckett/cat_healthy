import { describe, it, expect } from "vitest";
import {
  rer,
  dailyTarget,
  remainingBudget,
  gramsForServing,
  feedingsLeft,
  weightTrend,
  weightEwma,
  smoothedWeight,
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
    { id: 1, name: "Wet A", kcal_per_gram: 1.0, category: "wet", notes: null, archived: false },
    { id: 2, name: "Wet B", kcal_per_gram: 0.8, category: "wet", notes: null, archived: false },
  ];

  it("subtracts consumed kcal from the daily target", () => {
    const events: FeedingEvent[] = [
      { id: 1, timestamp: "2026-01-01T08:00:00", food_id: 1, grams: 50, is_treat: false, is_put_back: false },
      { id: 2, timestamp: "2026-01-01T12:00:00", food_id: 2, grams: 25, is_treat: false, is_put_back: false },
    ];
    // consumed = 50*1.0 + 25*0.8 = 70
    expect(remainingBudget(200, events, foods)).toBeCloseTo(130, 5);
  });

  it("returns the full target when no events logged yet", () => {
    expect(remainingBudget(200, [], foods)).toBe(200);
  });

  it("gives back the kcal of food put back in the fridge", () => {
    const events: FeedingEvent[] = [
      { id: 1, timestamp: "2026-01-01T18:00:00", food_id: 1, grams: 50, is_treat: false, is_put_back: false },
      { id: 2, timestamp: "2026-01-01T22:00:00", food_id: 1, grams: 7, is_treat: false, is_put_back: true },
    ];
    // consumed = 50 - 7 = 43
    expect(remainingBudget(200, events, foods)).toBeCloseTo(157, 5);
  });
});

describe("gramsForServing", () => {
  const food: Food = { id: 1, name: "Wet A", kcal_per_gram: 1.0, category: "wet", notes: null, archived: false };

  it("splits remaining kcal evenly across feedings left", () => {
    expect(gramsForServing(100, 2, food)).toBeCloseTo(50, 5);
  });

  it("returns null when there are no feedings left", () => {
    expect(gramsForServing(100, 0, food)).toBeNull();
  });

  it("returns null when the day's budget is used up", () => {
    expect(gramsForServing(0, 2, food)).toBeNull();
    expect(gramsForServing(-10, 2, food)).toBeNull();
  });
});

describe("feedingsLeft", () => {
  const times = ["07:00", "12:00", "18:00"];
  const fedAt = (time: string, isTreat = false): FeedingEvent => ({
    id: 1,
    timestamp: `2026-01-01 ${time}:00`,
    food_id: 1,
    grams: 30,
    is_treat: isTreat,
    is_put_back: false,
  });

  it("counts every feeding before the first feeding time", () => {
    expect(feedingsLeft([], "06:00", times)).toBe(3);
  });

  it("counts the current feeding plus later ones when nothing's been served yet", () => {
    expect(feedingsLeft([], "08:00", times)).toBe(3);
    expect(feedingsLeft([fedAt("08:00")], "13:00", times)).toBe(2);
    expect(feedingsLeft([fedAt("08:00"), fedAt("12:30")], "19:00", times)).toBe(1);
  });

  it("drops the current feeding once food has been served in its window", () => {
    expect(feedingsLeft([fedAt("07:30")], "08:00", times)).toBe(2);
  });

  it("doesn't count top-ups in the same window as extra feedings", () => {
    const events = [fedAt("07:10"), fedAt("08:30"), fedAt("10:15")];
    expect(feedingsLeft(events, "11:00", times)).toBe(2);
  });

  it("counts food served early (before the first time) toward the first feeding", () => {
    expect(feedingsLeft([fedAt("06:30")], "06:45", times)).toBe(2);
    expect(feedingsLeft([fedAt("06:30")], "08:00", times)).toBe(2);
  });

  it("doesn't count a put-back as serving a feeding", () => {
    const putBack = { ...fedAt("07:30"), is_put_back: true };
    expect(feedingsLeft([putBack], "08:00", times)).toBe(3);
  });

  it("ignores treats", () => {
    expect(feedingsLeft([fedAt("07:30", true)], "08:00", times)).toBe(3);
  });

  it("is 0 after the last feeding has been served", () => {
    expect(feedingsLeft([fedAt("18:05")], "21:00", times)).toBe(0);
  });

  it("still offers the last feeding late at night if it was never served", () => {
    expect(feedingsLeft([], "23:30", times)).toBe(1);
  });
});

const makeLogs = (entries: Array<[string, number]>): WeightLog[] =>
  entries.map(([date, weight_kg], i) => ({ id: i + 1, date, weight_kg, notes: null }));

// Daily weigh-ins losing a steady `perDay` kg, starting at `start` kg.
const dailyLogs = (days: number, start: number, perDay: number): WeightLog[] =>
  makeLogs(
    Array.from({ length: days }, (_, i) => [
      `2026-01-${String(i + 1).padStart(2, "0")}`,
      start - perDay * i,
    ]),
  );

describe("weightEwma", () => {
  const alpha = 2 / 11; // span=10

  it("seeds from the first reading", () => {
    const points = weightEwma(makeLogs([["2026-01-01", 5.0]]));
    expect(points).toEqual([{ date: "2026-01-01", ewma: 5.0 }]);
  });

  it("matches a per-row EWMA (pandas adjust=False) for daily weigh-ins", () => {
    const points = weightEwma(
      makeLogs([
        ["2026-01-01", 5.0],
        ["2026-01-02", 4.9],
        ["2026-01-03", 5.1],
      ]),
    );
    const e2 = 5.0 + alpha * (4.9 - 5.0);
    const e3 = e2 + alpha * (5.1 - e2);
    expect(points.map((p) => p.ewma)).toEqual([
      5.0,
      expect.closeTo(e2, 10),
      expect.closeTo(e3, 10),
    ]);
  });

  it("compounds the smoothing factor across a multi-day gap", () => {
    const points = weightEwma(
      makeLogs([
        ["2026-01-01", 5.0],
        ["2026-01-05", 4.8],
      ]),
    );
    const a = 1 - Math.pow(1 - alpha, 4);
    expect(points).toHaveLength(2);
    expect(points[1].ewma).toBeCloseTo(5.0 + a * (4.8 - 5.0), 10);
  });

  it("averages multiple readings on the same date", () => {
    const points = weightEwma(
      makeLogs([
        ["2026-01-01", 5.0],
        ["2026-01-02", 4.8],
        ["2026-01-02", 5.0],
      ]),
    );
    expect(points).toHaveLength(2);
    expect(points[1].ewma).toBeCloseTo(5.0 + alpha * (4.9 - 5.0), 10);
  });

  it("sorts input by date", () => {
    const points = weightEwma(
      makeLogs([
        ["2026-01-03", 4.9],
        ["2026-01-01", 5.0],
      ]),
    );
    expect(points.map((p) => p.date)).toEqual(["2026-01-01", "2026-01-03"]);
  });
});

describe("smoothedWeight", () => {
  it("returns null with no weigh-ins", () => {
    expect(smoothedWeight([])).toBeNull();
  });

  it("returns the latest EWMA point", () => {
    const logs = makeLogs([
      ["2026-01-03", 4.9],
      ["2026-01-01", 5.0],
      ["2026-01-02", 5.1],
    ]);
    const points = weightEwma(logs);
    expect(smoothedWeight(logs)).toBe(points[points.length - 1].ewma);
  });
});

// Mac's real weigh-ins, Oct 9 – Nov 10 2026. The old 7-day EWMA rule called
// this "stalled" (0.27%/week); the last two weeks are flatter still but too
// noisy to rule out a healthy rate.
const MAC_OCT_NOV_2026 = makeLogs([
  ["2026-10-09", 8.35],
  ["2026-10-11", 8.18],
  ["2026-10-14", 8.395],
  ["2026-10-18", 8.205],
  ["2026-10-21", 8.105],
  ["2026-10-25", 8.145],
  ["2026-10-28", 8.055],
  ["2026-11-02", 7.97],
  ["2026-11-04", 7.965],
  ["2026-11-06", 8.015],
  ["2026-11-07", 7.99],
  ["2026-11-08", 8.007],
  ["2026-11-09", 7.965],
  ["2026-11-10", 8.02],
]);

// Like dailyLogs, but each reading is pushed ±`noise` kg, alternating.
const noisyDailyLogs = (
  days: number,
  start: number,
  perDay: number,
  noise: number,
): WeightLog[] =>
  dailyLogs(days, start, perDay).map((log, i) => ({
    ...log,
    weight_kg: log.weight_kg + (i % 2 === 0 ? noise : -noise),
  }));

describe("weightTrend", () => {
  it("returns null with fewer than 4 weigh-in days", () => {
    const logs = makeLogs([
      ["2026-01-01", 5.0],
      ["2026-01-08", 4.95],
      ["2026-01-15", 4.9],
    ]);
    expect(weightTrend(logs)).toBeNull();
  });

  it("returns null when weigh-ins span fewer than 10 days", () => {
    expect(weightTrend(dailyLogs(10, 5.0, 0.01))).toBeNull(); // Jan 1–10 = 9 days
    expect(weightTrend(dailyLogs(11, 5.0, 0.01))).not.toBeNull();
  });

  it("returns null for two weigh-ins two days apart (the Oct 9/11 case)", () => {
    const logs = makeLogs([
      ["2026-10-09", 8.35],
      ["2026-10-11", 8.18],
    ]);
    expect(weightTrend(logs)).toBeNull();
  });

  it("recovers a steady loss rate exactly, with no margin", () => {
    // 0.005 kg/day = 0.035 kg/week, as a fraction of the window's mean weight
    const logs = dailyLogs(30, 5.0, 0.005);
    const window = logs.slice(-15); // last 14 days inclusive of both ends
    const mean = window.reduce((s, l) => s + l.weight_kg, 0) / window.length;
    const trend = weightTrend(logs)!;
    expect(trend.rate).toBeCloseTo(0.035 / mean, 10);
    expect(trend.margin).toBeCloseTo(0, 10);
  });

  it("only uses the last 14 days", () => {
    // Fast loss for 20 days, then flat for 22: the old loss is out of window.
    const logs = makeLogs([
      ...Array.from({ length: 20 }, (_, i): [string, number] => [
        `2026-01-${String(i + 1).padStart(2, "0")}`,
        5.0 - 0.02 * i,
      ]),
      ...Array.from({ length: 22 }, (_, i): [string, number] => [
        `2026-02-${String(i + 1).padStart(2, "0")}`,
        4.5,
      ]),
    ]);
    expect(weightTrend(logs)!.rate).toBeCloseTo(0, 10);
  });

  it("averages multiple readings on the same date", () => {
    const logs = dailyLogs(14, 5.0, 0.01);
    const latest = logs[logs.length - 1];
    logs.push({ ...latest, id: 99, weight_kg: latest.weight_kg + 0.1 });
    logs.push({ ...latest, id: 100, weight_kg: latest.weight_kg - 0.1 });
    expect(weightTrend(logs)!.rate).toBeCloseTo(
      weightTrend(dailyLogs(14, 5.0, 0.01))!.rate,
      10,
    );
  });

  it("widens the margin as readings get noisier", () => {
    const quiet = weightTrend(noisyDailyLogs(21, 5.0, 0.005, 0.01))!;
    const loud = weightTrend(noisyDailyLogs(21, 5.0, 0.005, 0.05))!;
    expect(loud.margin).toBeGreaterThan(quiet.margin);
  });

  it("returns a negative rate when weight increases", () => {
    expect(weightTrend(dailyLogs(14, 5.0, -0.01))!.rate).toBeLessThan(0);
  });

  it("finds Mac's last two weeks slow but with a range reaching past 0.5%", () => {
    const trend = weightTrend(MAC_OCT_NOV_2026)!;
    expect(trend.rate).toBeGreaterThan(0);
    expect(trend.rate).toBeLessThan(0.005);
    expect(trend.rate + trend.margin).toBeGreaterThan(0.005);
  });
});

describe("progressFlag", () => {
  const trend = (rate: number, margin = 0) => ({ rate, margin });

  it("returns null when there's no trend", () => {
    expect(progressFlag(null, "weight_loss")).toBeNull();
  });

  it("returns null for non-weight_loss goals regardless of rate", () => {
    expect(progressFlag(trend(0.05), "maintenance")).toBeNull();
    expect(progressFlag(trend(-0.05), "weight_gain")).toBeNull();
  });

  it("flags too_fast when the whole range is above 2%/week", () => {
    expect(progressFlag(trend(0.025, 0.004), "weight_loss")).toBe("too_fast");
    expect(progressFlag(trend(0.025, 0.006), "weight_loss")).toBeNull();
  });

  it("flags reversing when the whole range is gaining", () => {
    expect(progressFlag(trend(-0.01, 0.009), "weight_loss")).toBe("reversing");
  });

  it("flags stalled when the whole range is below 0.5%/week", () => {
    expect(progressFlag(trend(0.002, 0.002), "weight_loss")).toBe("stalled");
    expect(progressFlag(trend(-0.001, 0.003), "weight_loss")).toBe("stalled");
  });

  it("holds off when the range straddles a threshold", () => {
    expect(progressFlag(trend(0.002, 0.004), "weight_loss")).toBeNull();
    expect(progressFlag(trend(0.004, 0.004), "weight_loss")).toBeNull();
  });

  it("returns null for a healthy rate between 0.5% and 2%", () => {
    expect(progressFlag(trend(0.01, 0.003), "weight_loss")).toBeNull();
  });

  it("doesn't flag Mac's Oct–Nov data as stalled", () => {
    expect(progressFlag(weightTrend(MAC_OCT_NOV_2026), "weight_loss")).toBeNull();
  });
});

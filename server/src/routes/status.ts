import { Router } from "express";
import { db } from "../db.js";
import {
  dailyTarget,
  remainingBudget,
  gramsForMeal,
  weeklyLossRate,
  progressFlag,
} from "../calorie.js";
import type {
  CatProfile,
  Food,
  FeedingEvent,
  WeightLog,
  StatusResponse,
} from "../../../shared/types";

const MEALS_PER_DAY = 3;

export const getAllFoods = (): Food[] => {
  return db.prepare("SELECT * FROM foods").all() as Food[];
};

export const getProfile = (): CatProfile => {
  const row = db
    .prepare("SELECT * FROM cat_profile WHERE id = 1")
    .get() as CatProfile | undefined;
  if (!row) {
    throw new Error(
      "cat_profile has no row yet — run the seed script before first use",
    );
  }
  return row;
};

export const getAllWeightLogs = (): WeightLog[] => {
  return db
    .prepare("SELECT * FROM weight_log ORDER BY date DESC")
    .all() as WeightLog[];
};

export const getLatestWeight = (): WeightLog | null => {
  const row = db
    .prepare("SELECT * FROM weight_log ORDER BY date DESC LIMIT 1")
    .get() as WeightLog | undefined;
  return row ?? null;
};

export const getTodaysFeedingEvents = (): FeedingEvent[] => {
  const rows = db
    .prepare(
      "SELECT * FROM feeding_events WHERE date(timestamp) = date('now', 'localtime')",
    )
    .all() as Array<Omit<FeedingEvent, "is_treat"> & { is_treat: number }>;
  return rows.map((r) => ({ ...r, is_treat: Boolean(r.is_treat) }));
};

export const computeStatus = (): StatusResponse => {
  const profile = getProfile();
  const latestWeight = getLatestWeight();
  // Bootstrap fallback: before any weigh-in is logged, anchor off
  // target_weight_kg so the app is usable from the first day. See the
  // spec's "Weigh-ins and the calorie target" section — this is a stopgap,
  // not the steady-state path (the seed script should set target_weight_kg
  // or an initial weigh-in should be logged before first use).
  const currentWeightKg = latestWeight?.weight_kg ?? profile.target_weight_kg;
  if (currentWeightKg == null) {
    throw new Error(
      "No weight_log entry and no target_weight_kg set on cat_profile — log an initial weight or set target_weight_kg before first use",
    );
  }

  const { kcal: dailyTargetKcal, belowSafeFloor } = dailyTarget(
    currentWeightKg,
    profile,
  );
  const foods = getAllFoods();
  const todaysEvents = getTodaysFeedingEvents();
  const remainingKcal = remainingBudget(dailyTargetKcal, todaysEvents, foods);
  const mealsEaten = todaysEvents.filter((e) => !e.is_treat).length;
  const mealsLeftToday = Math.max(0, MEALS_PER_DAY - mealsEaten);

  const suggestedGramsPerFood: Record<number, number | null> = {};
  for (const food of foods) {
    suggestedGramsPerFood[food.id] = gramsForMeal(
      remainingKcal,
      mealsLeftToday,
      food,
    );
  }

  const allWeightLogs = getAllWeightLogs();
  const lossRate = weeklyLossRate(allWeightLogs);
  const flag = progressFlag(lossRate, profile.goal);

  return {
    dailyTargetKcal,
    belowSafeFloor,
    remainingKcal,
    mealsLeftToday,
    suggestedGramsPerFood,
    weeklyLossRate: lossRate,
    progressFlag: flag,
    currentWeightKg,
  };
};

export const statusRouter = Router();

statusRouter.get("/api/status", (_req, res) => {
  try {
    res.json(computeStatus());
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

statusRouter.get("/api/profile", (_req, res) => {
  try {
    res.json(getProfile());
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

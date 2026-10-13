export interface Food {
  id: number;
  name: string;
  kcal_per_gram: number;
  category: "wet" | "dry" | "treat";
  notes: string | null;
}

export interface WeightLog {
  id: number;
  date: string; // ISO date, YYYY-MM-DD
  weight_kg: number;
  notes: string | null;
}

export interface FeedingEvent {
  id: number;
  timestamp: string; // ISO datetime
  food_id: number;
  grams: number;
  is_treat: boolean;
  is_put_back: boolean; // grams returned to the fridge; subtracts from consumed
}

export type Goal = "weight_loss" | "maintenance" | "weight_gain";

export interface CatProfile {
  id: 1;
  target_weight_kg: number | null;
  life_stage_factor: number;
  goal: Goal;
  manual_override_kcal: number | null;
}

export type ProgressFlag = "too_fast" | "stalled" | "reversing" | null;

export interface StatusResponse {
  dailyTargetKcal: number;
  belowSafeFloor: boolean;
  remainingKcal: number;
  feedingsLeftToday: number;
  suggestedGramsPerFood: Record<number, number | null>;
  weeklyLossRate: number | null;
  progressFlag: ProgressFlag;
  currentWeightKg: number | null;
}

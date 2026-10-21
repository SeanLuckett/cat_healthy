import { Router } from "express";
import { db } from "../db.js";
import { weeklyLossRate, progressFlag, smoothedWeight } from "../calorie.js";
import { getAllWeightLogs, getProfile } from "./status.js";

export const weightRouter = Router();

const progressSummary = () => {
  const logs = getAllWeightLogs();
  const rate = weeklyLossRate(logs);
  return {
    weeklyLossRate: rate,
    progressFlag: progressFlag(rate, getProfile().goal),
    smoothedWeightKg: smoothedWeight(logs),
  };
};

weightRouter.get("/api/weight", (_req, res) => {
  res.json(getAllWeightLogs());
});

weightRouter.post("/api/weight", (req, res) => {
  const { date, weight_kg, notes } = req.body ?? {};

  if (typeof weight_kg !== "number" || weight_kg <= 0) {
    return res
      .status(400)
      .json({ error: "weight_kg must be a positive number" });
  }
  if (typeof date !== "string" || date.length === 0) {
    return res.status(400).json({ error: "date is required" });
  }

  db.prepare(
    "INSERT INTO weight_log (date, weight_kg, notes) VALUES (?, ?, ?)",
  ).run(date, weight_kg, notes ?? null);

  res.json(progressSummary());
});

weightRouter.delete("/api/weight/:id", (req, res) => {
  db.prepare("DELETE FROM weight_log WHERE id = ?").run(req.params.id);
  res.json(progressSummary());
});

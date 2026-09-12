import { Router } from "express";
import { db } from "../db.js";
import { weeklyLossRate, progressFlag } from "../calorie.js";
import { getAllWeightLogs, getProfile } from "./status.js";

export const weightRouter = Router();

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

  const logs = getAllWeightLogs();
  const rate = weeklyLossRate(logs);
  res.json({ weeklyLossRate: rate, progressFlag: progressFlag(rate, getProfile().goal) });
});

weightRouter.delete("/api/weight/:id", (req, res) => {
  db.prepare("DELETE FROM weight_log WHERE id = ?").run(req.params.id);
  const logs = getAllWeightLogs();
  const rate = weeklyLossRate(logs);
  res.json({ weeklyLossRate: rate, progressFlag: progressFlag(rate, getProfile().goal) });
});

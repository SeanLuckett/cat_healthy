import { Router } from "express";
import { db } from "../db.js";
import { computeStatus, getAllFoods } from "./status.js";

export const feedingsRouter = Router();

feedingsRouter.get("/api/feedings", (req, res) => {
  const date = typeof req.query.date === "string" ? req.query.date : null;
  const rows = date
    ? db
        .prepare(
          "SELECT * FROM feeding_events WHERE date(timestamp) = ? ORDER BY timestamp ASC",
        )
        .all(date)
    : db
        .prepare(
          "SELECT * FROM feeding_events WHERE date(timestamp) = date('now', 'localtime') ORDER BY timestamp ASC",
        )
        .all();
  res.json(
    (rows as Array<{ is_treat: number }>).map((r) => ({
      ...r,
      is_treat: Boolean(r.is_treat),
    })),
  );
});

feedingsRouter.post("/api/feedings", (req, res) => {
  const { food_id, grams, meal_slot, is_treat } = req.body ?? {};

  if (typeof grams !== "number" || grams <= 0) {
    return res.status(400).json({ error: "grams must be a positive number" });
  }

  const foodExists = getAllFoods().some((f) => f.id === food_id);
  if (!foodExists) {
    return res.status(400).json({ error: `food_id ${food_id} does not exist` });
  }

  db.prepare(
    `INSERT INTO feeding_events (timestamp, food_id, grams, meal_slot, is_treat)
     VALUES (datetime('now', 'localtime'), ?, ?, ?, ?)`,
  ).run(food_id, grams, meal_slot ?? null, is_treat ? 1 : 0);

  try {
    res.json(computeStatus());
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

feedingsRouter.delete("/api/feedings/:id", (req, res) => {
  db.prepare("DELETE FROM feeding_events WHERE id = ?").run(req.params.id);
  try {
    res.json(computeStatus());
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

import { Router } from "express";
import { db } from "../db.js";
import { getAllFoods } from "./status.js";

export const foodsRouter = Router();

foodsRouter.get("/api/foods", (_req, res) => {
  res.json(getAllFoods());
});

// Archiving hides a food from the picker without deleting it, so past
// feedings that reference it keep their name and calories.
foodsRouter.patch("/api/foods/:id", (req, res) => {
  const { archived } = req.body ?? {};

  if (typeof archived !== "boolean") {
    return res.status(400).json({ error: "archived must be a boolean" });
  }

  const result = db
    .prepare("UPDATE foods SET archived = ? WHERE id = ?")
    .run(archived ? 1 : 0, req.params.id);
  if (result.changes === 0) {
    return res
      .status(404)
      .json({ error: `food_id ${req.params.id} does not exist` });
  }

  res.json(getAllFoods());
});

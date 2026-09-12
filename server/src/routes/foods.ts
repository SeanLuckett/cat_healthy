import { Router } from "express";
import { getAllFoods } from "./status.js";

export const foodsRouter = Router();

foodsRouter.get("/api/foods", (_req, res) => {
  res.json(getAllFoods());
});

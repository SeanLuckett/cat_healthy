import { db } from "./db.js";

const profileExists = db
  .prepare("SELECT 1 FROM cat_profile WHERE id = 1")
  .get();

if (!profileExists) {
  db.prepare(
    `INSERT INTO cat_profile (id, target_weight_kg, life_stage_factor, goal, manual_override_kcal)
     VALUES (1, 4.5, 1.2, 'weight_loss', NULL)`,
  ).run();
  console.log("Seeded cat_profile (target_weight_kg=4.5kg, goal=weight_loss)");
} else {
  console.log("cat_profile already exists, skipping");
}

const foodCount = db.prepare("SELECT COUNT(*) AS n FROM foods").get() as {
  n: number;
};

if (foodCount.n === 0) {
  const insertFood = db.prepare(
    `INSERT INTO foods (name, kcal_per_gram, category, notes) VALUES (?, ?, ?, ?)`,
  );
  insertFood.run("Tiki Cat Wet Food", 1.0, "wet", "sample food for local testing");
  insertFood.run("Weruva Wet Food", 0.95, "wet", "sample food for local testing");
  console.log("Seeded 2 sample foods");
} else {
  console.log(`foods table already has ${foodCount.n} rows, skipping`);
}

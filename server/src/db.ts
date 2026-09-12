import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "..", "cat.db");

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS foods (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kcal_per_gram REAL NOT NULL,
    category TEXT NOT NULL DEFAULT 'wet',
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS weight_log (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    weight_kg REAL NOT NULL,
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS feeding_events (
    id INTEGER PRIMARY KEY,
    timestamp TEXT NOT NULL,
    food_id INTEGER NOT NULL REFERENCES foods(id),
    grams REAL NOT NULL,
    meal_slot INTEGER,
    is_treat INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS cat_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    target_weight_kg REAL,
    life_stage_factor REAL NOT NULL DEFAULT 1.2,
    goal TEXT NOT NULL DEFAULT 'weight_loss',
    manual_override_kcal REAL
  );
`);

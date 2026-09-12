import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { foodsRouter } from "./routes/foods.js";
import { feedingsRouter } from "./routes/feedings.js";
import { weightRouter } from "./routes/weight.js";
import { statusRouter } from "./routes/status.js";
import "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

const app = express();
app.use(cors());
app.use(express.json());

app.use(foodsRouter);
app.use(feedingsRouter);
app.use(weightRouter);
app.use(statusRouter);

const clientDist = path.join(__dirname, "..", "..", "client", "dist");
app.use(express.static(clientDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`cat-tracker server listening on http://0.0.0.0:${PORT}`);
});

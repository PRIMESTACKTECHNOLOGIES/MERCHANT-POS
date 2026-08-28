import express from "express";
import cors from "cors";
import { pos2013OfflineRouter } from "./domain/pos2013/pos2013Offline.router";
import { authRouter } from "./domain/auth/auth.router";
import { settingsRouter } from "./domain/settings/settings.router";
import { batchesRouter } from "./domain/batches/batches.router";
import myfatoorah2013Router from "./domain/myfatoorah/myfatoorah2013.router";
import directPaymentRouter from "./domain/myfatoorah/directPayment.router";
import { initDatabase } from "./init_db";
import path from "path";
import fs from "fs";

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Initialize Database Tables
initDatabase();

// IMPORTANT: Serve static files before anything else
const distPath = path.join(process.cwd(), "client/dist");

if (fs.existsSync(distPath)) {
  console.log("[Backend] Dashboard active at:", distPath);
  app.use(express.static(distPath));
}

// Register the API routers
app.use("/auth", authRouter);
app.use("/merchant", pos2013OfflineRouter);
app.use("/merchant", settingsRouter);
app.use("/merchant", batchesRouter);
app.use("/merchant/v1/myfatoorah", myfatoorah2013Router);
app.use("/api/myfatoorah", directPaymentRouter);

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// The "catchall" handler for the visual dashboard (Express v5 safe)
app.get(/^(?!\/(auth|merchant|api)).*$/, (req, res) => {
  if (fs.existsSync(path.join(distPath, "index.html"))) {
    return res.sendFile(path.join(distPath, "index.html"));
  }

  return res.status(404).json({
    error: "Dashboard UI not found",
    current_dir: process.cwd(),
    expected_path: distPath
  });
});

app.listen(Number(port), "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
});

export default app;

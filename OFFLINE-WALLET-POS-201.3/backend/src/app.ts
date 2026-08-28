import express from "express";
import cors from "cors";
import { terminalsRouter } from "./domain/terminals/terminals.router";
import { transactionsRouter } from "./domain/transactions/transactions.router";
import { authRouter } from "./domain/auth/auth.router";
import { settingsRouter } from "./domain/settings/settings.router";
import { batchesRouter } from "./domain/batches/batches.router";
import { paymentsRouter } from "./domain/payments/payments.router";
import { receiptsRouter } from "./domain/receipts/receipts.router";
import { myFatoorahRouter } from "./domain/myfatoorah/myfatoorah.router";

export const app = express();

// Enable CORS for all origins (Android app needs this)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Signature', 'X-Merchant-Id', 'X-Terminal-Id']
}));

// Handle preflight requests
app.options('*', cors());

app.use(express.json());

// Public routes
app.use("/auth", authRouter);

// Merchant API test endpoint
app.get("/merchant/v1", (req, res) => {
  res.json({ 
    status: "ok", 
    message: "Merchant API v1 is running",
    endpoints: [
      "POST /merchant/v1/terminal/verify",
      "POST /merchant/v1/terminal/register",
      "GET /merchant/v1/terminals"
    ]
  });
});

// GET test for terminal verify (for connectivity check)
app.get("/merchant/v1/terminal/verify", (req, res) => {
  res.json({ 
    status: "ok", 
    message: "Terminal verify endpoint is reachable. Use POST to verify credentials.",
    timestamp: new Date().toISOString(),
    expectedBody: {
      merchantId: "MRC-1001",
      terminalId: "T2013-001",
      secretKey: "secret_term_001"
    }
  });
});

// Protected routes (add middleware later or just group them)
app.use("/merchant/v1", terminalsRouter);
app.use("/merchant/v1", transactionsRouter);
app.use("/merchant/v1", settingsRouter);
app.use("/merchant/v1", batchesRouter);
app.use("/merchant/v1", paymentsRouter);
app.use("/merchant/v1/receipts", receiptsRouter);
app.use("/merchant/v1", myFatoorahRouter);

app.get("/", (req, res) => {
  res.send("POS 201.3 Backend Running");
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

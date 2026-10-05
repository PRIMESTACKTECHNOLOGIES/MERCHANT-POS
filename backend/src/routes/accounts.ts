import { Router, Request, Response } from "express";
import { db } from "../config/db";

export const accountsRouter = Router();

accountsRouter.get("/", async (_req: Request, res: Response) => {
  const r = await db.query("SELECT * FROM accounts", []);
  return res.json(
    r.rows.map((row: any) => ({
      id: row.id,
      currency: row.currency,
      bic: row.bic,
      iban: row.iban,
      bank_name: row.bank_name,
      balance: Number(row.balance),
      meta: row.meta ? JSON.parse(row.meta) : null,
    }))
  );
});

accountsRouter.patch("/:id", async (req: Request, res: Response) => {
  const { bic, iban, bank_name, meta } = req.body;
  const existing = await db.query("SELECT * FROM accounts WHERE id = ?", [req.params.id]);
  const current = existing.rows[0];

  const newBic = bic !== undefined ? (bic || null) : (current?.bic || null);
  const newIban = iban !== undefined ? (iban || null) : (current?.iban || null);
  const newBankName = bank_name !== undefined ? (bank_name || null) : (current?.bank_name || null);
  const newMeta = meta !== undefined
    ? (typeof meta === "string" ? meta : JSON.stringify(meta || null))
    : (current?.meta || null);

  await db.query(
    `UPDATE accounts SET bic = ?, iban = ?, bank_name = ?, meta = ? WHERE id = ?`,
    [newBic, newIban, newBankName, newMeta, req.params.id]
  );
  const r = await db.query("SELECT * FROM accounts WHERE id = ?", [
    req.params.id,
  ]);
  const row = r.rows[0];
  if (!row) return res.status(404).json(null);
  return res.json({
    id: row.id,
    currency: row.currency,
    bic: row.bic,
    iban: row.iban,
    bank_name: row.bank_name,
    balance: Number(row.balance),
    meta: row.meta ? JSON.parse(row.meta) : null,
  });
});

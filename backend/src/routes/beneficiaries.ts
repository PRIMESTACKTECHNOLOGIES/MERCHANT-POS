import { Router, Request, Response } from "express";
import { db } from "../config/db";
import { v4 as uuidv4 } from "uuid";

export const beneficiariesRouter = Router();

beneficiariesRouter.post("/", async (req: Request, res: Response) => {
  const id = uuidv4();
  const b = req.body;
  await db.query(
    `INSERT INTO beneficiaries (
       id, name, type,
       bank_swift_bic, bank_account_number, bank_country,
       address_line1, address_city, address_postal_code, address_country,
       metadata
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      b.name,
      b.type || "corporate",
      b.bank?.swift_bic ?? b.swift_bic,
      b.bank?.account_number ?? b.account_number,
      b.bank?.country ?? b.bank_country ?? b.country,
      b.address?.line1 || b.address_line1 || null,
      b.address?.city || b.address_city || null,
      b.address?.postal_code || b.address_postal_code || null,
      b.address?.country || b.address_country || b.bank?.country || b.country || null,
      JSON.stringify(b.metadata || {}),
    ]
  );
  const r = await db.query("SELECT * FROM beneficiaries WHERE id = ?", [id]);
  const row = r.rows[0];
  return res.status(201).json({
    id: row.id,
    name: row.name,
    type: row.type,
    bank_swift_bic: row.bank_swift_bic,
    bank_account_number: row.bank_account_number,
    bank_country: row.bank_country,
    address_line1: row.address_line1,
    address_city: row.address_city,
    address_postal_code: row.address_postal_code,
    address_country: row.address_country,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
    created_at: row.created_at,
  });
});

beneficiariesRouter.get("/:id", async (req: Request, res: Response) => {
  const r = await db.query("SELECT * FROM beneficiaries WHERE id = ?", [
    req.params.id,
  ]);
  if (!r.rows[0]) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Beneficiary not found" });
  }
  const row = r.rows[0];
  return res.json({
    id: row.id,
    name: row.name,
    type: row.type,
    bank_swift_bic: row.bank_swift_bic,
    bank_account_number: row.bank_account_number,
    bank_country: row.bank_country,
    address_line1: row.address_line1,
    address_city: row.address_city,
    address_postal_code: row.address_postal_code,
    address_country: row.address_country,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
    created_at: row.created_at,
  });
});

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { SECRET_KEY } from "../domain/auth/auth.service";
import { extractToken } from "./auth.middleware";

/**
 * Customer portal authentication.
 *
 * Verifies a JWT that was issued by the customer-auth login flow and REQUIRES
 * the `role` claim to be 'customer'. Merchant/admin tokens (which carry no role
 * or a different role) are rejected here, so a merchant session can never be
 * used to reach customer-portal endpoints, and vice-versa.
 *
 * On success the authenticated customer id is attached as `req.customer`.
 */
export const authenticateCustomer = (req: Request, res: Response, next: NextFunction) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: "Unauthorized: Missing customer token" });
  }

  jwt.verify(token, SECRET_KEY as string, (err: any, payload: any) => {
    if (err) {
      return res.status(403).json({ error: "Forbidden: Invalid customer token" });
    }
    if (!payload || payload.role !== "customer" || !payload.sub) {
      return res.status(403).json({ error: "Forbidden: Not a customer session" });
    }
    (req as any).customer = { id: String(payload.sub), walletCode: payload.wallet_code || null };
    next();
  });
};

import { Request, Response, NextFunction } from "express";
import { pos2013TerminalsService } from "./pos2013Terminals.service";

export class Pos2013TerminalsController {
  async verifyTerminal(req: Request, res: Response, next: NextFunction) {
    try {
      const { merchantId, terminalId, secretKey } = req.body || {};
      if (!merchantId || !terminalId || !secretKey) {
        return res.status(400).json({ valid: false, error: "Missing merchantId, terminalId, or secretKey" });
      }
      const valid = await pos2013TerminalsService.verifyTerminal(merchantId, terminalId, secretKey);
      if (!valid) {
        return res.status(401).json({ valid: false, error: "Invalid terminal credentials" });
      }
      return res.status(200).json({ valid: true, merchantId, terminalId });
    } catch (err) {
      next(err);
    }
  }

  async getTerminals(req: Request, res: Response, next: NextFunction) {
    try {
      // Get merchantId from JWT token (set by authenticateToken middleware)
      const user = (req as any).user;
      console.log("[getTerminals] JWT user:", user);
      
      const merchantId = user?.merchantId || user?.merchant_id || "MRC-1001";
      console.log("[getTerminals] Using merchantId:", merchantId);
      
      const terminals = await pos2013TerminalsService.getTerminals(merchantId);
      console.log("[getTerminals] Found terminals:", terminals.length);
      
      res.status(200).json(terminals);
    } catch (err) {
      console.error("[getTerminals] Error:", err);
      next(err);
    }
  }

  async getAllTransactions(req: Request, res: Response, next: NextFunction) {
    try {
      // Get merchantId from JWT token
      const merchantId = (req as any).user?.merchantId || (req as any).user?.merchant_id || "MRC-1001";
      const transactions = await pos2013TerminalsService.getAllTransactions(merchantId);
      res.status(200).json(transactions);
    } catch (err) {
      next(err);
    }
  }

  async registerTerminal(req: Request, res: Response, next: NextFunction) {
    try {
      // Get merchantId from JWT token
      const merchantId = (req as any).user?.merchantId || (req as any).user?.merchant_id || "MRC-1001";
      const { terminalName } = req.body;
      const terminal = await pos2013TerminalsService.registerTerminal(merchantId, terminalName);
      res.status(200).json(terminal);
    } catch (err) {
      next(err);
    }
  }

  async regenerateSecret(req: Request, res: Response, next: NextFunction) {
    try {
      const { merchantId, terminalId } = req.body;
      const result = await pos2013TerminalsService.regenerateTerminalSecret(merchantId, terminalId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async forceReboot(req: Request, res: Response, next: NextFunction) {
    try {
      const { merchantId, terminalId } = req.body;
      const result = await pos2013TerminalsService.forceRemoteReboot(merchantId, terminalId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const pos2013TerminalsController = new Pos2013TerminalsController();

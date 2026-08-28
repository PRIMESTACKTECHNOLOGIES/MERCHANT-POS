import { Request, Response } from "express";
import { transactionsService } from "./transactions.service";

export class TransactionsController {
  async list(req: Request, res: Response) {
    try {
      const data = await transactionsService.getTransactions();
      res.json(data);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
}

export const transactionsController = new TransactionsController();

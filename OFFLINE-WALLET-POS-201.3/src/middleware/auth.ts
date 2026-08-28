import { Request, Response, NextFunction } from "express";

export const merchantAuth = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers["x-api-key"];

  // In a real app, check this against a database of merchant keys
  const validApiKey = "MERCHANT-SECRET-KEY-2013"; 

  if (!apiKey || apiKey !== validApiKey) {
    return res.status(401).json({ error: "Unauthorized: Invalid or missing API Key" });
  }

  next();
};

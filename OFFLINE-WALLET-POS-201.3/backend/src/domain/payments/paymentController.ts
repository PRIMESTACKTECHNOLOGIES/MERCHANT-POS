import { Request, Response } from "express";
import { executeMyFatoorahPayment } from "./paymentService";

export interface SettleTransactionRequest {
  amount: number;
  cardNumber: string;
  expiryMonth: string;
  expiryYear: string;
  cvv: string;
  localTxnId: string;
}

export interface SettleTransactionResponse {
  success: boolean;
  localTxnId: string;
  status: string;
  invoiceId?: number;
  paymentId?: string;
  authCode?: string;
  cardBrand?: string;
  amount?: number;
  error?: any;
}

export async function settleTransaction(req: Request, res: Response) {
  try {
    const {
      amount,
      cardNumber,
      expiryMonth,
      expiryYear,
      cvv,
      localTxnId
    }: SettleTransactionRequest = req.body;

    const result = await executeMyFatoorahPayment({
      amount,
      cardNumber,
      expiryMonth,
      expiryYear,
      cvv
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        localTxnId,
        status: "declined",
        error: result.error
      } as SettleTransactionResponse);
    }

    const mf = result.data.Data;

    return res.json({
      success: true,
      localTxnId,
      status: mf.InvoiceStatus,
      invoiceId: mf.InvoiceId,
      paymentId: mf.PaymentId,
      authCode: mf.AuthorizationCode,
      cardBrand: mf.CardInfo,
      amount
    } as SettleTransactionResponse);

  } catch (err: any) {
    return res.status(500).json({
      success: false,
      status: "error",
      error: err.message
    } as SettleTransactionResponse);
  }
}
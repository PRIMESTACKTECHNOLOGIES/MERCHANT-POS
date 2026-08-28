import { Request, Response } from "express"; 
import { decryptCardData } from "../../utils/crypto"; 
import { myfatoorahService } from "./myfatoorah.service"; 
 
 export async function settleTransaction(req: Request, res: Response) { 
   try { 
     const { 
       localTxnId, 
       amount, 
       encryptedPan, 
       encryptedExpMonth, 
       encryptedExpYear, 
       encryptedCvv, 
       aesKey,
       paymentMethodId
     } = req.body; 
 
     // 🔓 Decrypt card data (each field has its own ciphertext, IV, and tag)
     const cardNumber = decryptCardData(encryptedPan.ciphertext, aesKey, encryptedPan.iv, encryptedPan.tag); 
     const expiryMonth = decryptCardData(encryptedExpMonth.ciphertext, aesKey, encryptedExpMonth.iv, encryptedExpMonth.tag); 
     const expiryYear = decryptCardData(encryptedExpYear.ciphertext, aesKey, encryptedExpYear.iv, encryptedExpYear.tag); 
     const cvv = decryptCardData(encryptedCvv.ciphertext, aesKey, encryptedCvv.iv, encryptedCvv.tag); 
 
     // 💳 Execute payment 
     const result = await myfatoorahService.executeDirectPayment({ 
       localTxnId,
       amount, 
       cardNumber, 
       expiryMonth, 
       expiryYear, 
       cvv,
       paymentMethodId
     }); 
 
     if (!result.success) { 
       return res.status(400).json({ 
         success: false, 
         localTxnId, 
         status: "declined", 
         error: result.error 
       }); 
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
     }); 
 
   } catch (err: any) { 
     return res.status(500).json({ 
       success: false, 
       status: "error", 
       error: err.message 
     }); 
   } 
 } 

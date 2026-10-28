import express, { Router, Request, Response } from 'express';

const router: Router = express.Router();

// Wise USD receiving account details
const WISE_USD_ACCOUNT = {
  payeeName: 'Wise US Inc',
  currency: 'USD',
  bankName: 'JPMORGAN CHASE BANK',
  bankAddress: '270 Park Avenue, New York, NY 10017',
  bankPhone: '+1 212 270 6000',
  routingNumber: '021000021',
  accountNumber: '205756130',
  accountType: 'Checking / Business Checking',
  referenceCode: 'P201006522', // IMPORTANT: Must be included in transfer reason
  companyAddress: '30 W 26th Street, Floor 6, New York, NY 10010',
};

/**
 * GET /bank-transfer/wise-usd-details
 * Return Wise USD bank details for customers to make wire transfers
 */
router.get('/wise-usd-details', (req: Request, res: Response) => {
  return res.json({
    success: true,
    paymentMethod: 'Wire Transfer (USD)',
    bankDetails: WISE_USD_ACCOUNT,
    instructions: {
      steps: [
        'Log into your bank account',
        'Select "Send Wire Transfer" or "International Transfer"',
        'Choose "Domestic USD Transfer" (not international)',
        'Enter the bank details below',
        'IMPORTANT: In the "Reference" or "Reason" field, enter ONLY: P201006522',
        'Enter amount: 117,123.08 USD or partial amount',
        'Review and confirm transfer',
        'You will receive a confirmation email within 1-2 business days',
      ],
      important: [
        'Reference code MUST be included as: P201006522',
        'This is a LOCAL USD transfer (not international)',
        'Partial payments accepted - send in stages if needed',
        'Allow 1-2 business days for settlement',
      ],
    },
    limitations: {
      currency: 'USD only',
      minAmount: 0.01,
      maxAmount: null, // Unlimited, but Wise may have limits
      processingTime: '1-2 business days',
    },
  });
});

/**
 * POST /bank-transfer/verify-reference
 * Verify that a customer has correct reference code
 */
router.post('/verify-reference', (req: Request, res: Response) => {
  const { referenceCode } = req.body;

  if (!referenceCode) {
    return res.status(400).json({
      valid: false,
      message: 'Reference code is required',
    });
  }

  const isValid = referenceCode.trim() === WISE_USD_ACCOUNT.referenceCode;

  return res.json({
    valid: isValid,
    correctCode: WISE_USD_ACCOUNT.referenceCode,
    message: isValid
      ? 'Reference code is correct'
      : 'Reference code is incorrect - please double-check',
  });
});

/**
 * POST /bank-transfer/payment-received
 * Admin endpoint to log incoming wire transfer
 * (Called by webhook or manual entry)
 */
router.post('/payment-received', async (req: Request, res: Response) => {
  try {
    const {
      customerId,
      amount,
      currency,
      senderName,
      senderBank,
      transactionId,
      referenceCode,
      receiptDate,
    } = req.body;

    // Validate required fields
    if (!customerId || !amount || !currency) {
      return res.status(400).json({
        error: 'Missing required fields: customerId, amount, currency',
      });
    }

    // Verify reference code matches
    if (referenceCode && referenceCode !== WISE_USD_ACCOUNT.referenceCode) {
      return res.status(400).json({
        error: 'Invalid reference code',
        expectedCode: WISE_USD_ACCOUNT.referenceCode,
      });
    }

    // TODO: Store payment record in database
    // TODO: Update customer balance
    // TODO: Create transaction record
    // TODO: Send confirmation email to customer

    return res.json({
      success: true,
      message: 'Wire transfer payment recorded',
      payment: {
        customerId,
        amount,
        currency,
        senderName,
        transactionId,
        receivedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'Failed to record payment',
      details: error.message,
    });
  }
});

export default router;

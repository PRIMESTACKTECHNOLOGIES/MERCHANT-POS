import express, { Router, Request, Response } from 'express';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

const router: Router = express.Router();

interface WisePaymentRequest {
  customerId: string;
  amount: number;
  currency: string;
  targetAccountId: string;
  recipientIban: string;
  recipientName: string;
  purpose: string;
}

interface WiseTransfer {
  id: string;
  transferId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  amount: number;
  currency: string;
  customerId: string;
  createdAt: string;
  updatedAt: string;
}

// Initialize Wise API client
const getWiseClient = () => {
  const apiToken = process.env.WISE_API_TOKEN || '';
  const isProduction = process.env.NODE_ENV === 'production';
  const baseURL = isProduction
    ? 'https://api.wise.com'
    : 'https://api.sandbox.wise.com';

  return axios.create({
    baseURL,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
  });
};

/**
 * POST /wise/create-recipient
 * Create a SEPA recipient account for payment
 */
router.post('/create-recipient', async (req: Request, res: Response) => {
  try {
    const { accountHolder, iban, currency, email } = req.body;

    if (!accountHolder || !iban || !currency) {
      return res.status(400).json({
        error: 'Missing required fields: accountHolder, iban, currency',
      });
    }

    const client = getWiseClient();

    const response = await client.post('/v1/accounts', {
      accountHolderName: accountHolder,
      currency,
      type: 'sepa',
      details: {
        iban,
        email,
      },
    });

    return res.json({
      success: true,
      recipientId: response.data.id,
      accountDetails: response.data,
    });
  } catch (error: any) {
    console.error('Wise recipient creation error:', error.message);
    return res.status(500).json({
      error: 'Failed to create recipient',
      details: error.response?.data?.message || error.message,
    });
  }
});

/**
 * POST /wise/initiate-payment
 * Initiate a single SEPA transfer
 */
router.post('/initiate-payment', async (req: Request, res: Response) => {
  try {
    const {
      customerId,
      amount,
      currency,
      targetAccountId,
      recipientIban,
      recipientName,
      purpose,
    } = req.body as WisePaymentRequest;

    if (
      !customerId ||
      !amount ||
      !currency ||
      !targetAccountId ||
      !recipientIban ||
      !recipientName
    ) {
      return res.status(400).json({
        error:
          'Missing required fields: customerId, amount, currency, targetAccountId, recipientIban, recipientName',
      });
    }

    const client = getWiseClient();

    // Step 1: Create quote for exchange rate
    const quoteResponse = await client.post('/v2/quotes', {
      sourceCurrency: 'EUR', // Assuming EUR source for SEPA
      targetCurrency: currency,
      sourceAmount: amount,
    });

    const quoteId = quoteResponse.data.id;

    // Step 2: Create transfer
    const transferResponse = await client.post('/v1/transfers', {
      quoteUuid: quoteId,
      targetAccountId,
      customerTransactionId: uuidv4(),
      details: {
        reference: `PAY-${customerId}-${Date.now()}`,
      },
    });

    const transferId = transferResponse.data.id;

    // Step 3: Fund the transfer (using account balance)
    await client.post(`/v1/transfers/${transferId}/payments`, {
      type: 'balance',
    });

    const transfer: WiseTransfer = {
      id: uuidv4(),
      transferId,
      status: 'processing',
      amount,
      currency,
      customerId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return res.json({
      success: true,
      transfer,
      message: 'Payment initiated successfully',
    });
  } catch (error: any) {
    console.error('Wise payment initiation error:', error.message);
    return res.status(500).json({
      error: 'Failed to initiate payment',
      details: error.response?.data?.message || error.message,
    });
  }
});

/**
 * GET /wise/transfer-status/:transferId
 * Check transfer status
 */
router.get('/transfer-status/:transferId', async (req: Request, res: Response) => {
  try {
    const { transferId } = req.params;

    if (!transferId) {
      return res.status(400).json({ error: 'transferId is required' });
    }

    const client = getWiseClient();
    const response = await client.get(`/v1/transfers/${transferId}`);

    return res.json({
      success: true,
      transferId,
      status: response.data.status,
      details: {
        amount: response.data.sourceValue,
        currency: response.data.sourceCurrency,
        recipient: response.data.recipientId,
      },
    });
  } catch (error: any) {
    console.error('Wise status check error:', error.message);
    return res.status(500).json({
      error: 'Failed to check transfer status',
      details: error.response?.data?.message || error.message,
    });
  }
});

/**
 * POST /wise/cancel-payment/:transferId
 * Cancel a pending transfer
 */
router.post('/cancel-payment/:transferId', async (req: Request, res: Response) => {
  try {
    const { transferId } = req.params;

    if (!transferId) {
      return res.status(400).json({ error: 'transferId is required' });
    }

    const client = getWiseClient();
    await client.put(`/v1/transfers/${transferId}/cancel`);

    return res.json({
      success: true,
      message: 'Transfer cancelled successfully',
      transferId,
    });
  } catch (error: any) {
    console.error('Wise cancellation error:', error.message);
    return res.status(500).json({
      error: 'Failed to cancel transfer',
      details: error.response?.data?.message || error.message,
    });
  }
});

/**
 * GET /wise/exchange-rate
 * Get real-time exchange rates
 */
router.get('/exchange-rate', async (req: Request, res: Response) => {
  try {
    const { source, target } = req.query;

    if (!source || !target) {
      return res
        .status(400)
        .json({ error: 'Missing query params: source, target' });
    }

    const client = getWiseClient();
    const response = await client.get('/v2/rates', {
      params: { source, target },
    });

    return res.json({
      success: true,
      source: source as string,
      target: target as string,
      rate: response.data.rate,
    });
  } catch (error: any) {
    console.error('Wise exchange rate error:', error.message);
    return res.status(500).json({
      error: 'Failed to fetch exchange rate',
      details: error.response?.data?.message || error.message,
    });
  }
});

/**
 * Webhook handler for Wise payment status updates
 * POST /wise/webhooks
 */
router.post('/webhooks', async (req: Request, res: Response) => {
  try {
    const event = req.body;

    console.log('Wise webhook received:', event.type, event.data?.id);

    // Handle different webhook events
    switch (event.type) {
      case 'transfer.completed':
        console.log('Transfer completed:', event.data.id);
        // TODO: Update transfer status in database
        break;
      case 'transfer.failed':
        console.log('Transfer failed:', event.data.id);
        // TODO: Update transfer status and store error
        break;
      case 'transfer.cancelled':
        console.log('Transfer cancelled:', event.data.id);
        // TODO: Update transfer status
        break;
      default:
        console.log('Unhandled event type:', event.type);
    }

    return res.json({ success: true });
  } catch (error: any) {
    console.error('Webhook processing error:', error.message);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;

/**
 * PAYOUT API ROUTES
 * 
 * Endpoints for processing payouts from merchant ledger to customers
 */

import { Router } from 'express';
import { payoutProcessorService } from '../domain/wallets/payout-processor.service';

const router = Router();

/**
 * POST /api/payouts/crypto
 * 
 * Process crypto payout
 * 
 * Body:
 * {
 *   customer_id: string,
 *   amount: number,
 *   currency: string,
 *   crypto_address: string
 * }
 */
router.post('/crypto', async (req, res) => {
  try {
    const { customer_id, amount, currency, crypto_address } = req.body;

    if (!customer_id || !amount || !currency || !crypto_address) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: customer_id, amount, currency, crypto_address'
      });
    }

    const result = await payoutProcessorService.payoutCrypto(
      customer_id,
      amount,
      currency,
      crypto_address
    );

    return res.status(result.success ? 200 : 400).json(result);

  } catch (error: any) {
    console.error('[PayoutAPI] Crypto payout error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/payouts/bank
 * 
 * Process bank payout
 * 
 * Body:
 * {
 *   customer_id: string,
 *   amount: number,
 *   currency: string,
 *   bank_account_id: string
 * }
 */
router.post('/bank', async (req, res) => {
  try {
    const { customer_id, amount, currency, bank_account_id } = req.body;

    if (!customer_id || !amount || !currency || !bank_account_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: customer_id, amount, currency, bank_account_id'
      });
    }

    const result = await payoutProcessorService.payoutBank(
      customer_id,
      amount,
      currency,
      bank_account_id
    );

    return res.status(result.success ? 200 : 400).json(result);

  } catch (error: any) {
    console.error('[PayoutAPI] Bank payout error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/payouts/process
 * 
 * Generic payout endpoint
 * 
 * Body:
 * {
 *   customer_id: string,
 *   amount: number,
 *   currency: string,
 *   method: 'crypto' | 'bank',
 *   destination: string (crypto address or bank account ID)
 * }
 */
router.post('/process', async (req, res) => {
  try {
    const { customer_id, amount, currency, method, destination } = req.body;

    if (!customer_id || !amount || !currency || !method || !destination) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: customer_id, amount, currency, method, destination'
      });
    }

    const result = await payoutProcessorService.processPayout({
      customer_id,
      amount,
      currency,
      method,
      destination
    });

    return res.status(result.success ? 200 : 400).json(result);

  } catch (error: any) {
    console.error('[PayoutAPI] Process payout error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;

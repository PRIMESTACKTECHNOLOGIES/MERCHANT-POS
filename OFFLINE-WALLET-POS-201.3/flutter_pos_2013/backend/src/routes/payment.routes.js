const express = require('express');
const router = express.Router();
const paymentService = require('../services/payment.service');
const { get, all } = require('../models/database');

// POST /api/payments/charge
router.post('/charge', async (req, res) => {
  try {
    const { idempotency_key, amount, currency, card, metadata } = req.body;

    // Validation
    if (!idempotency_key || !amount || !currency || !card) {
      return res.status(400).json({
        status: 'FAILED',
        error_code: 'MISSING_FIELDS',
        error_message: 'Required fields: idempotency_key, amount, currency, card'
      });
    }

    if (!card.number || !card.expiry_month || !card.expiry_year || !card.cvv) {
      return res.status(400).json({
        status: 'FAILED',
        error_code: 'INVALID_CARD_DATA',
        error_message: 'Card must have number, expiry_month, expiry_year, cvv'
      });
    }

    // Process payment
    const result = await paymentService.processCharge(req.body);

    // Return appropriate status code
    if (result.status === 'SUCCESS') {
      res.status(200).json(result);
    } else if (result.status === 'FAILED') {
      res.status(400).json(result);
    } else {
      // ERROR - retryable
      res.status(503).json(result);
    }

  } catch (error) {
    console.error('Charge error:', error);
    res.status(500).json({
      status: 'ERROR',
      error_code: 'PROCESSING_ERROR',
      error_message: error.message
    });
  }
});

// GET /api/payments/status?idempotency_key=xxx
router.get('/status', async (req, res) => {
  try {
    const { idempotency_key, local_txn_id } = req.query;
    const key = idempotency_key || local_txn_id;

    if (!key) {
      return res.status(400).json({
        status: 'ERROR',
        error_code: 'MISSING_KEY',
        error_message: 'Provide idempotency_key or local_txn_id'
      });
    }

    const txn = await paymentService.getTransactionStatus(key);
    
    if (!txn) {
      return res.status(404).json({
        status: 'UNKNOWN',
        error_code: 'NOT_FOUND',
        error_message: 'Transaction not found'
      });
    }

    res.json({
      status: txn.status,
      local_txn_id: txn.local_txn_id,
      gateway_txn_id: txn.gateway_txn_id,
      amount_cents: txn.amount_cents,
      currency: txn.currency,
      auth_code: txn.auth_code,
      error_code: txn.error_code,
      error_message: txn.error_message,
      created_at: txn.created_at
    });

  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({
      status: 'ERROR',
      error_code: 'QUERY_ERROR',
      error_message: error.message
    });
  }
});

// GET /api/payments/stats
router.get('/stats', async (req, res) => {
  try {
    const stats = await paymentService.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      error_message: error.message
    });
  }
});

// GET /api/payments/transactions
router.get('/transactions', async (req, res) => {
  try {
    const { status, limit = 100 } = req.query;
    
    let query = 'SELECT * FROM transactions';
    const params = [];
    
    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit));
    
    const rows = await all(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      error_message: error.message
    });
  }
});

module.exports = router;

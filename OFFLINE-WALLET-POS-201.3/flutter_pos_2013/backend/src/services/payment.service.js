const { v4: uuidv4 } = require('uuid');
const { run, get } = require('../models/database');

// Mock payment gateway integration
// Replace with real Stripe/Adyen/MyFatoorah integration
class PaymentService {
  
  async processCharge(request) {
    const { 
      idempotency_key, 
      amount, 
      currency, 
      card, 
      metadata 
    } = request;

    // Check idempotency
    const existing = await this.checkIdempotency(idempotency_key);
    if (existing) {
      console.log(`Idempotency hit for key: ${idempotency_key}`);
      return existing;
    }

    // Validate card (basic Luhn check)
    if (!this.validateCardNumber(card.number)) {
      const error = {
        status: 'FAILED',
        error_code: 'INVALID_CARD',
        error_message: 'Card number is invalid'
      };
      await this.cacheIdempotency(idempotency_key, error);
      return error;
    }

    // Simulate gateway processing
    const result = await this.callMockGateway(request);

    // Store transaction
    await this.storeTransaction(request, result);

    // Cache result for idempotency
    await this.cacheIdempotency(idempotency_key, result);

    return result;
  }

  async callMockGateway(request) {
    // Simulate processing delay
    await this.delay(500);

    // Mock success/failure logic
    const { card, amount } = request;
    
    // Decline specific test cards
    if (card.number === '4000000000000002') {
      return {
        status: 'FAILED',
        error_code: 'CARD_DECLINED',
        error_message: 'Card was declined'
      };
    }

    if (card.number === '4000000000000127') {
      return {
        status: 'FAILED',
        error_code: 'INSUFFICIENT_FUNDS',
        error_message: 'Insufficient funds'
      };
    }

    if (card.number === '4000000000000119') {
      return {
        status: 'ERROR',
        error_code: 'GATEWAY_TIMEOUT',
        error_message: 'Upstream timeout, please retry'
      };
    }

    // Success
    const gatewayTxnId = `gw_${uuidv4().replace(/-/g, '')}`;
    const authCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    return {
      status: 'SUCCESS',
      gateway_txn_id: gatewayTxnId,
      authorized_amount: amount,
      currency: request.currency,
      auth_code: authCode,
      created_at: new Date().toISOString()
    };
  }

  async storeTransaction(request, result) {
    const { idempotency_key, amount, currency, card, metadata } = request;
    
    // Mask card number
    const masked = this.maskCardNumber(card.number);
    
    await run(`
      INSERT INTO transactions (
        local_txn_id, gateway_txn_id, amount_cents, currency,
        card_number_masked, cardholder_name, status, auth_code,
        error_code, error_message, idempotency_key, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      metadata?.local_txn_id || idempotency_key,
      result.gateway_txn_id || null,
      amount,
      currency,
      masked,
      card.cardholder_name || null,
      result.status,
      result.auth_code || null,
      result.error_code || null,
      result.error_message || null,
      idempotency_key,
      JSON.stringify(metadata)
    ]);
  }

  async checkIdempotency(key) {
    const row = await get(
      'SELECT response FROM idempotency_cache WHERE key = ?',
      [key]
    );
    return row ? JSON.parse(row.response) : null;
  }

  async cacheIdempotency(key, response) {
    try {
      await run(
        'INSERT INTO idempotency_cache (key, response) VALUES (?, ?)',
        [key, JSON.stringify(response)]
      );
    } catch (err) {
      // Ignore duplicate key errors
    }
  }

  async getTransactionStatus(localTxnId) {
    return await get(
      'SELECT * FROM transactions WHERE local_txn_id = ?',
      [localTxnId]
    );
  }

  async getStats() {
    const { run, get } = require('../models/database');
    
    const pending = await get(`
      SELECT COUNT(*) as count FROM transactions WHERE status IN ('PENDING', 'RETRY')
    `);
    
    const success = await get(`
      SELECT COUNT(*) as count FROM transactions WHERE status = 'SUCCESS'
    `);
    
    const failed = await get(`
      SELECT COUNT(*) as count FROM transactions WHERE status = 'FAILED'
    `);

    return {
      pending: pending?.count || 0,
      success: success?.count || 0,
      failed: failed?.count || 0
    };
  }

  validateCardNumber(number) {
    // Luhn algorithm
    let sum = 0;
    let isEven = false;
    
    for (let i = number.length - 1; i >= 0; i--) {
      let digit = parseInt(number[i], 10);
      
      if (isEven) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      
      sum += digit;
      isEven = !isEven;
    }
    
    return sum % 10 === 0;
  }

  maskCardNumber(number) {
    if (number.length < 4) return number;
    const first4 = number.substring(0, 4);
    const last4 = number.substring(number.length - 4);
    return `${first4}********${last4}`;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new PaymentService();

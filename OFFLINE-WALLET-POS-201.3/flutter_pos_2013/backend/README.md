# POS 201.3 Backend API

Technical implementation of payment processing backend.

## API Endpoints

### POST /api/payments/charge
Process a card payment.

**Request:**
```json
{
  "idempotency_key": "TXN-123456",
  "amount": 5000,
  "currency": "USD",
  "card": {
    "number": "4111111111111111",
    "expiry_month": 12,
    "expiry_year": 2028,
    "cvv": "123",
    "cardholder_name": "John Doe"
  },
  "metadata": {
    "local_txn_id": "TXN-123456",
    "pos_id": "POS-01"
  }
}
```

**Success Response:**
```json
{
  "status": "SUCCESS",
  "gateway_txn_id": "gw_abc123",
  "authorized_amount": 5000,
  "currency": "USD",
  "auth_code": "A1B2C3",
  "created_at": "2024-03-24T12:00:00Z"
}
```

**Failed Response:**
```json
{
  "status": "FAILED",
  "error_code": "CARD_DECLINED",
  "error_message": "Card was declined"
}
```

### GET /api/payments/status?idempotency_key=xxx
Check transaction status.

### GET /api/payments/stats
Get transaction statistics.

### GET /api/payments/transactions?status=PENDING
List transactions.

## Test Cards

| Card Number | Result |
|-------------|--------|
| 4111111111111111 | Success |
| 4000000000000002 | Declined |
| 4000000000000127 | Insufficient funds |
| 4000000000000119 | Gateway timeout (retry) |

## Deployment to Render

1. Push to GitHub
2. Create Web Service on Render
3. Set build command: `npm install`
4. Set start command: `npm start`
5. Deploy

## Local Development

```bash
npm install
npm run dev
```

Server runs on http://localhost:3000

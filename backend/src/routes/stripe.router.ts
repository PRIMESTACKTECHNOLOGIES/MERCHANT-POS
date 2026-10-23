import { Router, Request, Response } from 'express';
import { getStripe, getPublishableKey, getWebhookSecret } from '../config/stripe';
import { db } from '../config/db';
import { v4 as uuidv4 } from 'uuid';
import express from 'express';

export const stripeRouter = Router();

// Raw body capture middleware for Stripe webhooks
export const stripeWebhookRawParser = express.raw({ type: 'application/json' });

// GET /api/stripe/publishable-key — public, returns the publishable key for the client
stripeRouter.get('/publishable-key', (_req: Request, res: Response) => {
  try {
    const key = getPublishableKey();
    res.json({ publishableKey: key });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

// POST /api/stripe/payment-intents — authenticated, creates a PaymentIntent
stripeRouter.post('/payment-intents', async (req: Request, res: Response) => {
  try {
    const { amount, currency = 'usd', customerId, description, metadata = {} } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number (in smallest currency unit, e.g. cents)' });
    }

    const stripe = getStripe();

    const paymentIntentParams: any = {
      amount: Math.round(amount),
      currency: String(currency).toLowerCase(),
      description: description || 'POS ORGINAL payment',
      payment_method_types: ['card'],
      metadata: {
        source: 'pos_orginal',
        customerId: customerId || '',
        ...metadata,
      },
    };

    const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

    try {
      await db.query(
        `INSERT INTO stripe_payment_intents (id, customer_id, amount, currency, status, client_secret, description, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_at = datetime('now')`,
        [paymentIntent.id, customerId || null, amount, paymentIntent.currency, paymentIntent.status, paymentIntent.client_secret, description || null, JSON.stringify(metadata)]
      );
    } catch (e: any) {
      console.warn('[Stripe] Failed to log payment intent:', e.message);
    }

    res.json({
      clientSecret: paymentIntent.client_secret,
      id: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      status: paymentIntent.status,
    });
  } catch (e: any) {
    console.error('[Stripe] PaymentIntent error:', e.message);
    res.status(500).json({ error: e.message, type: e.type, stripeCode: e.code });
  }
});

// GET /api/stripe/payment-intents/:id — retrieve a PaymentIntent
stripeRouter.get('/payment-intents/:id', async (req: Request, res: Response) => {
  try {
    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.retrieve(req.params.id);
    res.json({
      id: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      status: paymentIntent.status,
      client_secret: paymentIntent.client_secret,
      created: paymentIntent.created,
    });
  } catch (e: any) {
    res.status(404).json({ error: e.message });
  }
});

// GET /api/stripe/balance — check Stripe account balance (authenticated)
stripeRouter.get('/balance', async (_req: Request, res: Response) => {
  try {
    const stripe = getStripe();
    const balance = await stripe.balance.retrieve();
    res.json({
      available: balance.available.map((b: any) => ({ amount: b.amount, currency: b.currency })),
      pending: balance.pending.map((b: any) => ({ amount: b.amount, currency: b.currency })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/stripe/webhook — Stripe sends events here (raw body required for signature verification)
stripeRouter.post('/webhook', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;
  const rawBody = (req as any).rawBody as Buffer | undefined;

  if (!sig) {
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }
  if (!rawBody || rawBody.length === 0) {
    return res.status(400).json({ error: 'Missing raw body — ensure stripeWebhookRawParser middleware is mounted before this route' });
  }

  let event: any;

  try {
    const webhookSecret = getWebhookSecret();
    event = getStripe().webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (e: any) {
    console.error('[Stripe Webhook] Signature verification failed:', e.message);
    return res.status(400).json({ error: `Webhook signature verification failed: ${e.message}` });
  }

  console.log(`[Stripe Webhook] Event type: ${event.type}, id: ${event.id}`);

  try {
    await db.query(
      `INSERT INTO stripe_webhook_log (event_id, event_type, api_version, raw_payload, processed_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(event_id) DO UPDATE SET processed_at = datetime('now')`,
      [event.id, event.type, event.api_version, JSON.stringify(event).substring(0, 8000)]
    );
  } catch (e: any) {
    console.warn('[Stripe Webhook] Failed to log event:', e.message);
  }

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi: any = event.data.object;
      console.log(`[Stripe Webhook] PaymentIntent succeeded: ${pi.id}, amount: ${pi.amount} ${pi.currency}`);
      try {
        await db.query(
          `UPDATE stripe_payment_intents SET status = 'succeeded', updated_at = datetime('now') WHERE id = ?`,
          [pi.id]
        );
        const merchantId = pi.metadata?.merchantId || 'MRC-1001';
        const currency = (pi.currency || 'usd').toUpperCase();
        const amount = pi.amount / 100;
        const now = new Date().toISOString();
        await db.query(
          `INSERT INTO merchant_wallets (id, merchant_id, balance, currency, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(merchant_id, currency) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at`,
          [uuidv4(), merchantId, amount, currency, now, now]
        );
        await db.query(
          `INSERT INTO merchant_wallet_transactions (id, wallet_id, type, amount, currency, source, reference, description, created_at)
           VALUES (?, (SELECT id FROM merchant_wallets WHERE merchant_id = ? AND currency = ? LIMIT 1), 'credit', ?, ?, 'stripe_payment', ?, ?, ?)`,
          [uuidv4(), merchantId, currency, amount, currency, pi.id, `Stripe PaymentIntent succeeded: ${pi.id}`, now]
        );
        console.log(`[Stripe Webhook] Credited ${amount} ${currency} to merchant ${merchantId}`);
      } catch (e: any) {
        console.error('[Stripe Webhook] Failed to credit merchant wallet:', e.message);
      }
      break;
    }

    case 'payment_intent.payment_failed': {
      const pi: any = event.data.object;
      console.log(`[Stripe Webhook] PaymentIntent failed: ${pi.id}, reason: ${pi.last_payment_error?.message}`);
      try {
        await db.query(
          `UPDATE stripe_payment_intents SET status = 'requires_payment_method', updated_at = datetime('now') WHERE id = ?`,
          [pi.id]
        );
      } catch (e: any) {
        console.warn('[Stripe Webhook] Failed to update failed payment:', e.message);
      }
      break;
    }

    case 'charge.refunded': {
      const charge: any = event.data.object;
      console.log(`[Stripe Webhook] Charge refunded: ${charge.id}, amount: ${charge.amount_refunded}`);
      try {
        const amount = charge.amount_refunded / 100;
        const currency = (charge.currency || 'usd').toUpperCase();
        const now = new Date().toISOString();
        const merchantId = charge.metadata?.merchantId || (charge.metadata?.source === 'pos_orginal' ? 'MRC-1001' : null);
        if (merchantId && amount > 0) {
          await db.query(
            `UPDATE merchant_wallets SET balance = MAX(0, balance - ?), updated_at = ? WHERE merchant_id = ? AND currency = ?`,
            [amount, now, merchantId, currency]
          );
          console.log(`[Stripe Webhook] Debited ${amount} ${currency} from merchant ${merchantId} due to refund`);
        }
      } catch (e: any) {
        console.warn('[Stripe Webhook] Failed to process refund:', e.message);
      }
      break;
    }

    default:
      console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
  }

  res.json({ received: true, eventId: event.id });
});

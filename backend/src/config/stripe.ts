import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY?.trim();
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set');
    }
    _stripe = new Stripe(key, {
      apiVersion: '2025-07-30.basil' as any,
      typescript: true,
    });
  }
  return _stripe;
}

export function getPublishableKey(): string {
  const key = process.env.STRIPE_PUBLISHABLE_KEY?.trim();
  if (!key) {
    throw new Error('STRIPE_PUBLISHABLE_KEY environment variable is not set');
  }
  return key;
}

export function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET environment variable is not set');
  }
  return secret;
}

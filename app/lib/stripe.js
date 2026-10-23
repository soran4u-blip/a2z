import crypto from 'node:crypto';
import { config } from './config.js';

// Stripe via plain HTTPS (no SDK). Works with test keys (sk_test_...) and live keys.
export const stripeEnabled = () => !!config.stripeKey;

function flatten(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else if (v !== undefined && v !== null) out.push([key, String(v)]);
  }
  return out;
}

async function call(path, params) {
  const body = new URLSearchParams(flatten(params));
  const r = await fetch('https://api.stripe.com/v1' + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || 'Stripe error');
  return j;
}

export async function createCheckout(user, interval) {
  const yearly = interval === 'year';
  const params = {
    mode: 'subscription',
    client_reference_id: String(user.id),
    allow_promotion_codes: 'true',
    success_url: `${config.baseUrl}/dashboard?upgraded=1`,
    cancel_url: `${config.baseUrl}/dashboard?tab=billing`,
    subscription_data: { metadata: { user_id: String(user.id) } },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: yearly ? config.proYearlyCents : config.proMonthlyCents,
        recurring: { interval: yearly ? 'year' : 'month' },
        product_data: { name: 'a2z.deals Pro', description: 'Unlimited links, custom slugs, pixels, full analytics, no branding' },
      },
    }],
  };
  if (user.stripe_customer) params.customer = user.stripe_customer;
  else params.customer_email = user.email;
  const s = await call('/checkout/sessions', params);
  return s.url;
}

export async function createPortal(user) {
  const s = await call('/billing_portal/sessions', { customer: user.stripe_customer, return_url: `${config.baseUrl}/dashboard?tab=billing` });
  return s.url;
}

// Verify Stripe-Signature header against the raw body.
export function verifyWebhook(raw, header) {
  if (!config.stripeWebhookSecret || !header) return null;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const t = parts.t;
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!t || !sigs.length) return null;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return null;
  const expected = crypto.createHmac('sha256', config.stripeWebhookSecret).update(`${t}.${raw}`).digest('hex');
  const ok = sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

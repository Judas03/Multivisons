import { randomBytes } from 'node:crypto';
import { config } from '../config.js';

/**
 * Release one milestone payment. The amount always comes from the signed milestone.
 * With PayPal sandbox credentials and a payee PayPal email it calls the sandbox Payouts API;
 * otherwise it records a clearly labelled simulated payment.
 */
export async function releasePayment({ agreementId, milestoneIndex, amountCents, payeeEmail }) {
  const at = new Date();
  if (config.paypalClientId && config.paypalSecret && payeeEmail) {
    try {
      const base = 'https://api-m.sandbox.paypal.com';
      const tok = await fetch(`${base}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.paypalClientId}:${config.paypalSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(20_000),
      }).then((r) => r.json());
      if (!tok.access_token) throw new Error('PayPal auth failed');
      const batchId = `mv-${agreementId}-${milestoneIndex}`; // idempotent per milestone
      const res = await fetch(`${base}/v1/payments/payouts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': batchId },
        body: JSON.stringify({
          sender_batch_header: { sender_batch_id: batchId, email_subject: 'Milestone payment', email_message: 'Milestone approved.' },
          items: [{ recipient_type: 'EMAIL', receiver: payeeEmail, amount: { value: (amountCents / 100).toFixed(2), currency: 'USD' }, sender_item_id: batchId }],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || `PayPal ${res.status}`);
      return { mode: 'paypal-sandbox', reference: body.batch_header?.payout_batch_id || batchId, amountCents, at };
    } catch (e) {
      console.warn('PayPal sandbox payout failed, recording simulated payment:', e.message);
    }
  }
  return { mode: 'paypal-sandbox-simulated', reference: `SBX-${randomBytes(6).toString('hex').toUpperCase()}`, amountCents, at };
}

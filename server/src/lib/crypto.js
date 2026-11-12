import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** Deterministic JSON: object keys sorted, so identical content always hashes identically. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Hash of the signable content of one agreement version (delivery state is excluded). */
export function agreementContentHash(a) {
  return sha256(
    canonical({
      id: String(a._id),
      version: a.version,
      title: a.title,
      summary: a.summary,
      terms: a.terms,
      currency: a.currency,
      client: a.client?.email ?? null,
      contractor: a.contractor?.email ?? null,
      milestones: a.milestones.map((m) => ({
        title: m.title,
        criteria: m.criteria,
        amountCents: m.amountCents,
      })),
    }),
  );
}

/** Server seal binding signer + exact content hash + time + the drawn/typed mark. */
export function signatureSeal({ agreementId, contentHash, userId, role, signedAt, markHash }) {
  const payload = [agreementId, contentHash, userId, role, new Date(signedAt).toISOString(), markHash].join('|');
  return createHmac('sha256', config.signatureSecret).update(payload).digest('hex');
}

export function safeEqualHex(a, b) {
  const x = Buffer.from(String(a), 'hex');
  const y = Buffer.from(String(b), 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

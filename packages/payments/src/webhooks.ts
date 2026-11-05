// packages/payments/src/webhooks.ts
//
// PayPal webhook handling in two halves (ARCHITECTURE.md section 9):
//
//  1. receivePayPalWebhook(): called by the HTTP route POST /api/webhooks/paypal.
//     Verifies the signature with PayPal, stores the event once (unique event ID),
//     and returns quickly. Verification failures never change business state.
//
//  2. eventToProviderLookup(): used by the worker when it processes a stored event.
//     The event body is only a hint: the worker re-reads the authoritative status
//     with a GET (gateway.reconcile) before changing anything. This also makes
//     duplicate and out-of-order events harmless.

import type { ExistingProviderOperation, OriginalWebhookRequest, ProposedPaymentGateway } from "./gateway-types";

/** Event types the payment flow cares about. Subscribe the webhook to exactly these. */
export const PAYPAL_WEBHOOK_EVENT_TYPES = [
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
] as const;

export type StoredWebhookEvent = Readonly<{
  eventId: string;
  eventType: string;
  resourceId: string;
  /** Authorization this event is about, when PayPal says so. Used to find our operation. */
  authorizationId?: string;
  orderId?: string;
  rawBody: string; // kept for audit
  receivedAt: string;
}>;

export interface WebhookInbox {
  /** Insert if this event ID is new. Returns false for a duplicate. Must be a unique constraint in Postgres. */
  insertIfNew(event: StoredWebhookEvent): Promise<boolean>;
}

export type ReceiveResult =
  | { httpStatus: 200; outcome: "stored" | "duplicate" | "ignored_type" }
  | { httpStatus: 400; outcome: "unverified" }
  | { httpStatus: 503; outcome: "verification_unavailable" };

/**
 * Route handler core. The Next.js route reads the raw body as text (not JSON) and passes
 * the headers through. Respond with httpStatus; PayPal retries anything that isn't 2xx.
 */
export async function receivePayPalWebhook(
  req: OriginalWebhookRequest,
  deps: { gateway: ProposedPaymentGateway; inbox: WebhookInbox; now?: () => Date },
): Promise<ReceiveResult> {
  let verified;
  try {
    verified = await deps.gateway.verifyWebhook(req);
  } catch {
    return { httpStatus: 503, outcome: "verification_unavailable" }; // PayPal will retry later
  }
  if (!verified.verified || !verified.eventId) return { httpStatus: 400, outcome: "unverified" };
  if (!PAYPAL_WEBHOOK_EVENT_TYPES.includes(verified.eventType as (typeof PAYPAL_WEBHOOK_EVENT_TYPES)[number])) {
    return { httpStatus: 200, outcome: "ignored_type" };
  }

  const event = JSON.parse(req.rawBody);
  const ids = relatedIds(event);
  const fresh = await deps.inbox.insertIfNew({
    eventId: verified.eventId,
    eventType: verified.eventType!,
    resourceId: verified.resourceId ?? "",
    authorizationId: ids.authorizationId,
    orderId: ids.orderId,
    rawBody: req.rawBody,
    receivedAt: (deps.now?.() ?? new Date()).toISOString(),
  });
  return { httpStatus: 200, outcome: fresh ? "stored" : "duplicate" };
}

/** Which provider object the worker should GET to learn the truth about this event. */
export function eventToProviderLookup(e: StoredWebhookEvent): ExistingProviderOperation | null {
  if (e.eventType.startsWith("PAYMENT.CAPTURE.")) return { kind: "capture", providerReference: e.resourceId };
  if (e.eventType.startsWith("PAYMENT.AUTHORIZATION.")) return { kind: "authorization", providerReference: e.resourceId };
  if (e.eventType === "CHECKOUT.ORDER.APPROVED") return { kind: "order", providerReference: e.resourceId };
  return null;
}

/** Refunds and reversals after a capture are financial exceptions: show them, never hide them. */
export function isFinancialException(eventType: string): boolean {
  return eventType === "PAYMENT.CAPTURE.REFUNDED" || eventType === "PAYMENT.CAPTURE.REVERSED";
}

function relatedIds(event: any): { authorizationId?: string; orderId?: string } {
  const r = event?.resource ?? {};
  const related = r.supplementary_data?.related_ids ?? {};
  if (String(event?.event_type).startsWith("PAYMENT.AUTHORIZATION.")) return { authorizationId: r.id, orderId: related.order_id };
  if (String(event?.event_type).startsWith("CHECKOUT.ORDER.")) return { orderId: r.id };
  return { authorizationId: related.authorization_id, orderId: related.order_id };
}

export class InMemoryWebhookInbox implements WebhookInbox {
  readonly events = new Map<string, StoredWebhookEvent>();
  async insertIfNew(event: StoredWebhookEvent): Promise<boolean> {
    if (this.events.has(event.eventId)) return false;
    this.events.set(event.eventId, event);
    return true;
  }
}

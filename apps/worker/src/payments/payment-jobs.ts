// apps/worker/src/payments/payment-jobs.ts
//
// Payment job handlers for the worker (mode AUTHORIZED_THEN_CAPTURED).
// They run AFTER the API route has committed an approval + payment operation + outbox row
// (ARCHITECTURE.md section 9). They never hold a DB transaction open across a PayPal call:
//   1. claim the operation (short DB write)
//   2. call PayPal through the gateway (no DB transaction open)
//   3. record the observation (short DB write)
//
// Storage is behind the PaymentOperationStore port below. The full-stack owner implements it
// in packages/data; until then, InMemoryPaymentOperationStore lets this run and be tested.

import type {
  PaymentObservation,
  ProposedPaymentGateway,
} from "@multivisons/payments/gateway-types";
import type { StoredWebhookEvent } from "@multivisons/payments/webhooks";

type Money = Readonly<{ currency: "USD"; amountMinor: number }>;

export type OperationKind = "SETTLE" | "VOID";
export type OperationState = "QUEUED" | "IN_FLIGHT" | "PENDING" | "UNKNOWN" | "CONFIRMED" | "FAILED";

/** One payment action the server has decided to take. Created by the API route, never by the browser or the AI. */
export type PaymentOperation = Readonly<{
  id: string;
  kind: OperationKind;
  agreementId: string;
  milestoneId: string;
  submissionId?: string; // SETTLE only
  authorizationId: string;
  amount: Money; // frozen milestone amount
  idempotencyKey: string; // agreement-version/milestone/submission/settle/v1
  state: OperationState;
  attempts: number;
  providerReference?: string; // capture ID for SETTLE
  lastReasonCode?: string;
  updatedAt: string;
}>;

export interface PaymentOperationStore {
  get(id: string): Promise<PaymentOperation | null>;
  /** Atomically move QUEUED -> IN_FLIGHT (or return null if someone else has it / it's done). */
  claim(id: string, now: string): Promise<PaymentOperation | null>;
  /** Save the outcome of a PayPal call. Must not overwrite a CONFIRMED operation. */
  record(id: string, obs: PaymentObservation, nextState: OperationState): Promise<PaymentOperation>;
  /** Operations in PENDING or UNKNOWN (or IN_FLIGHT for too long) that need a GET. */
  listNeedingReconcile(olderThan: string): Promise<PaymentOperation[]>;
  /** Operations for one PayPal authorization (used to match webhook events). */
  findByAuthorizationId(authorizationId: string): Promise<PaymentOperation[]>;
}

const MAX_ATTEMPTS = 5;

export type JobResult = Readonly<{ operationId: string; state: OperationState; providerReference?: string; reasonCode?: string }>;

/** Outbox job: capture an approved milestone. */
export async function runSettle(store: PaymentOperationStore, gateway: ProposedPaymentGateway, operationId: string, now = () => new Date()): Promise<JobResult> {
  const op = await store.claim(operationId, now().toISOString());
  if (!op) return skipped(store, operationId);
  if (op.kind !== "SETTLE" || !op.submissionId) throw new Error(`Operation ${op.id} is not a SETTLE operation`);

  const obs = await gateway.settle({
    operationId: op.id,
    agreementId: op.agreementId,
    milestoneId: op.milestoneId,
    submissionId: op.submissionId,
    authorizationId: op.authorizationId,
    amount: op.amount,
    idempotencyKey: op.idempotencyKey,
  });
  const saved = await store.record(op.id, obs, nextState(obs, op.attempts));
  return result(saved);
}

/** Outbox job: void an unused milestone's authorization (cancellation / abandoned funding). */
export async function runVoid(store: PaymentOperationStore, gateway: ProposedPaymentGateway, operationId: string, now = () => new Date()): Promise<JobResult> {
  const op = await store.claim(operationId, now().toISOString());
  if (!op) return skipped(store, operationId);
  if (op.kind !== "VOID") throw new Error(`Operation ${op.id} is not a VOID operation`);

  const obs = await gateway.cancelFunding({ operationId: op.id, milestoneId: op.milestoneId, authorizationId: op.authorizationId, idempotencyKey: op.idempotencyKey });
  const saved = await store.record(op.id, obs, nextState(obs, op.attempts));
  return result(saved);
}

/**
 * Scheduled job (about every 5 minutes, and on demand from a stuck UI): resolve PENDING / UNKNOWN
 * operations with a GET. Never re-sends a capture blindly: if PayPal shows nothing happened and the
 * authorization is still open, it re-queues the operation so the same idempotency key is reused.
 */
export async function runReconcile(store: PaymentOperationStore, gateway: ProposedPaymentGateway, now = () => new Date()): Promise<JobResult[]> {
  const cutoff = new Date(now().getTime() - 60_000).toISOString();
  const ops = await store.listNeedingReconcile(cutoff);
  const out: JobResult[] = [];
  for (const op of ops) {
    const obs =
      op.kind === "SETTLE" && op.providerReference
        ? await gateway.reconcile({ kind: "capture", providerReference: op.providerReference })
        : await gateway.reconcile({ kind: "authorization", providerReference: op.authorizationId });

    let state: OperationState;
    if (obs.status === "UNKNOWN") state = "UNKNOWN"; // PayPal still unreachable: try again next round
    else if (op.kind === "VOID") state = obs.providerStatus === "VOIDED" ? "CONFIRMED" : obs.providerStatus === "CREATED" ? "QUEUED" : "FAILED";
    else if (obs.providerStatus === "CREATED") state = op.attempts >= MAX_ATTEMPTS ? "FAILED" : "QUEUED"; // not captured yet: safe to retry with the same key
    else state = obs.status === "CONFIRMED" ? "CONFIRMED" : obs.status === "PENDING" ? "PENDING" : "FAILED";

    out.push(result(await store.record(op.id, obs, state)));
  }
  return out;
}

export type WebhookJobResult = Readonly<{
  eventId: string;
  outcome: "applied" | "unmatched" | "financial_exception" | "provider_unknown" | "ignored";
  operations: JobResult[];
}>;

/**
 * Process one stored, verified webhook event. The event is only a hint: we GET the
 * authoritative status first, so duplicates, stale events and out-of-order delivery
 * cannot move an operation backwards (record() never downgrades CONFIRMED).
 */
export async function runWebhookEvent(
  store: PaymentOperationStore,
  gateway: ProposedPaymentGateway,
  event: StoredWebhookEvent,
): Promise<WebhookJobResult> {
  const base = { eventId: event.eventId };
  if (!event.authorizationId) return { ...base, outcome: event.eventType === "CHECKOUT.ORDER.APPROVED" ? "ignored" : "unmatched", operations: [] };

  const ops = await store.findByAuthorizationId(event.authorizationId);
  if (ops.length === 0) return { ...base, outcome: "unmatched", operations: [] }; // quarantine: not one of ours, or not stored yet

  if (event.eventType === "PAYMENT.CAPTURE.REFUNDED" || event.eventType === "PAYMENT.CAPTURE.REVERSED") {
    // Money came back after settlement. Don't erase history: surface it for a human.
    return { ...base, outcome: "financial_exception", operations: ops.map(result) };
  }

  const isCapture = event.eventType.startsWith("PAYMENT.CAPTURE.");
  const obs = await gateway.reconcile(
    isCapture ? { kind: "capture", providerReference: event.resourceId } : { kind: "authorization", providerReference: event.authorizationId },
  );
  if (obs.status === "UNKNOWN") return { ...base, outcome: "provider_unknown", operations: ops.map(result) }; // retry the event later

  const updated: JobResult[] = [];
  for (const op of ops) {
    if (op.state === "CONFIRMED") { updated.push(result(op)); continue; }
    let state: OperationState | null = null;
    if (op.kind === "SETTLE" && isCapture) state = obs.status === "CONFIRMED" ? "CONFIRMED" : obs.status === "PENDING" ? "PENDING" : "FAILED";
    if (op.kind === "VOID" && obs.providerStatus === "VOIDED") state = "CONFIRMED";
    updated.push(result(state ? await store.record(op.id, obs, state) : op));
  }
  return { ...base, outcome: "applied", operations: updated };
}

function nextState(obs: PaymentObservation, attempts: number): OperationState {
  if (obs.status === "CONFIRMED") return "CONFIRMED";
  if (obs.status === "PENDING") return "PENDING";
  if (obs.status === "UNKNOWN") return attempts >= MAX_ATTEMPTS ? "FAILED" : "UNKNOWN";
  return "FAILED";
}

async function skipped(store: PaymentOperationStore, id: string): Promise<JobResult> {
  const current = await store.get(id);
  if (!current) throw new Error(`Unknown payment operation ${id}`);
  return result(current);
}

function result(op: PaymentOperation): JobResult {
  return { operationId: op.id, state: op.state, providerReference: op.providerReference, reasonCode: op.lastReasonCode };
}

// ---------- in-memory store for tests and local runs ----------

export class InMemoryPaymentOperationStore implements PaymentOperationStore {
  private readonly ops = new Map<string, PaymentOperation>();

  add(op: Omit<PaymentOperation, "state" | "attempts" | "updatedAt">): void {
    if ([...this.ops.values()].some((o) => o.idempotencyKey === op.idempotencyKey)) throw new Error(`Duplicate idempotency key ${op.idempotencyKey}`);
    this.ops.set(op.id, { ...op, state: "QUEUED", attempts: 0, updatedAt: new Date(0).toISOString() });
  }

  async get(id: string) {
    return this.ops.get(id) ?? null;
  }

  async claim(id: string, now: string) {
    const op = this.ops.get(id);
    if (!op || op.state !== "QUEUED") return null;
    const claimed = { ...op, state: "IN_FLIGHT" as const, attempts: op.attempts + 1, updatedAt: now };
    this.ops.set(id, claimed);
    return claimed;
  }

  async record(id: string, obs: PaymentObservation, nextState: OperationState) {
    const op = this.ops.get(id);
    if (!op) throw new Error(`Unknown payment operation ${id}`);
    if (op.state === "CONFIRMED") return op; // never downgrade a settled operation
    const isCapture = op.kind === "SETTLE" && obs.providerReference && obs.providerReference !== op.authorizationId;
    const updated: PaymentOperation = {
      ...op,
      state: nextState,
      providerReference: isCapture ? obs.providerReference : op.providerReference,
      lastReasonCode: obs.reasonCode,
      updatedAt: obs.observedAt,
    };
    this.ops.set(id, updated);
    return updated;
  }

  async findByAuthorizationId(authorizationId: string) {
    return [...this.ops.values()].filter((o) => o.authorizationId === authorizationId);
  }

  async listNeedingReconcile(olderThan: string) {
    return [...this.ops.values()].filter((o) => o.state === "PENDING" || o.state === "UNKNOWN" || (o.state === "IN_FLIGHT" && o.updatedAt < olderThan));
  }
}

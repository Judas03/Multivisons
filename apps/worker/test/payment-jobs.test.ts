// apps/worker/test/payment-jobs.test.ts
// Run: npm test --workspace @multivisons/worker
import { test } from "node:test";
import assert from "node:assert/strict";
import { MockPaymentGateway } from "../../../packages/payments/src/mock-gateway.ts";
import { InMemoryPaymentOperationStore, runReconcile, runSettle, runVoid, runWebhookEvent } from "../src/payments/payment-jobs.ts";

const USD = (amountMinor: number) => ({ currency: "USD" as const, amountMinor });

async function fundedMilestone(gw: MockPaymentGateway, milestoneId: string, cents: number) {
  const co = await gw.createFundingOrder({
    agreementId: "agr_demo", agreementVersion: 1, milestoneId, milestoneTitle: milestoneId, amount: USD(cents),
    idempotencyKey: `agr_demo/v1/${milestoneId}/fund/v1`, returnUrl: "http://localhost:3000/r", cancelUrl: "http://localhost:3000/c",
  });
  const f = await gw.confirmFunding({ milestoneId, orderId: co.orderId, expectedAmount: USD(cents), idempotencyKey: `agr_demo/v1/${milestoneId}/auth/v1` });
  return f.authorizationId!;
}

function settleOp(id: string, authorizationId: string) {
  return { id, kind: "SETTLE" as const, agreementId: "agr_demo", milestoneId: "m1", submissionId: "sub_1",
    authorizationId, amount: USD(4000), idempotencyKey: "agr_demo/v1/m1/sub_1/settle/v1" };
}

test("settle job captures once and records the capture ID", async () => {
  const gw = new MockPaymentGateway();
  const store = new InMemoryPaymentOperationStore();
  store.add(settleOp("op_1", await fundedMilestone(gw, "m1", 4000)));

  const r = await runSettle(store, gw, "op_1");
  assert.equal(r.state, "CONFIRMED");
  assert.match(r.providerReference!, /^MOCK-CAPTURE-/);

  // Duplicate delivery of the same outbox job does nothing.
  const again = await runSettle(store, gw, "op_1");
  assert.deepEqual(again, r);
});

test("the same business action cannot be queued twice", async () => {
  const store = new InMemoryPaymentOperationStore();
  store.add(settleOp("op_1", "MOCK-AUTH-1"));
  assert.throws(() => store.add(settleOp("op_2", "MOCK-AUTH-1")));
});

test("lost response: job ends UNKNOWN, reconcile turns it CONFIRMED without a second capture", async () => {
  const gw = new MockPaymentGateway({ scenario: "lost_response" });
  const store = new InMemoryPaymentOperationStore();
  store.add(settleOp("op_1", await fundedMilestone(gw, "m1", 4000)));

  assert.equal((await runSettle(store, gw, "op_1")).state, "UNKNOWN");
  const [rec] = await runReconcile(store, gw);
  assert.equal(rec.state, "CONFIRMED");
  assert.match(rec.providerReference!, /^MOCK-CAPTURE-/);
  assert.equal((await runReconcile(store, gw)).length, 0, "nothing left to reconcile");
});

test("pending capture stays PENDING until reconcile sees it complete", async () => {
  const gw = new MockPaymentGateway({ scenario: "capture_pending" });
  const store = new InMemoryPaymentOperationStore();
  store.add(settleOp("op_1", await fundedMilestone(gw, "m1", 4000)));
  assert.equal((await runSettle(store, gw, "op_1")).state, "PENDING");
  const [rec] = await runReconcile(store, gw);
  assert.equal(rec.state, "PENDING"); // mock never completes it; real PayPal would after the payee accepts
});

test("void job releases an unused milestone", async () => {
  const gw = new MockPaymentGateway();
  const store = new InMemoryPaymentOperationStore();
  const auth = await fundedMilestone(gw, "m2", 11000);
  store.add({ id: "op_v", kind: "VOID", agreementId: "agr_demo", milestoneId: "m2", authorizationId: auth, amount: USD(11000), idempotencyKey: "agr_demo/v1/m2/void/v1" });
  const r = await runVoid(store, gw, "op_v");
  assert.equal(r.state, "CONFIRMED");
});

test("denied capture is FAILED, not retried", async () => {
  const gw = new MockPaymentGateway({ scenario: "capture_denied" });
  const store = new InMemoryPaymentOperationStore();
  store.add(settleOp("op_1", await fundedMilestone(gw, "m1", 4000)));
  assert.equal((await runSettle(store, gw, "op_1")).state, "FAILED");
  assert.equal((await runReconcile(store, gw)).length, 0);
});

// ---------- webhook events ----------

const ev = (eventType: string, resourceId: string, authorizationId?: string) => ({
  eventId: `WH-${eventType}-${resourceId}`, eventType, resourceId, authorizationId, rawBody: "{}", receivedAt: "2026-11-05T10:00:00Z",
});

test("capture webhook confirms a PENDING settle after a GET; replaying it changes nothing", async () => {
  const gw = new MockPaymentGateway({ scenario: "lost_response" });
  const store = new InMemoryPaymentOperationStore();
  const auth = await fundedMilestone(gw, "m1", 4000);
  store.add(settleOp("op_1", auth));
  assert.equal((await runSettle(store, gw, "op_1")).state, "UNKNOWN");

  const capId = (await gw.reconcile({ kind: "authorization", providerReference: auth })).providerReference!;
  const r = await runWebhookEvent(store, gw, ev("PAYMENT.CAPTURE.COMPLETED", capId, auth));
  assert.equal(r.outcome, "applied");
  assert.equal(r.operations[0].state, "CONFIRMED");
  assert.equal(r.operations[0].providerReference, capId);

  const again = await runWebhookEvent(store, gw, ev("PAYMENT.CAPTURE.COMPLETED", capId, auth));
  assert.deepEqual(again.operations, r.operations);
});

test("stale or unknown webhooks never move a settled milestone backwards", async () => {
  const gw = new MockPaymentGateway();
  const store = new InMemoryPaymentOperationStore();
  const auth = await fundedMilestone(gw, "m1", 4000);
  store.add(settleOp("op_1", auth));
  await runSettle(store, gw, "op_1");
  const r = await runWebhookEvent(store, gw, ev("PAYMENT.AUTHORIZATION.CREATED", auth, auth));
  assert.equal(r.operations[0].state, "CONFIRMED");
  assert.equal((await runWebhookEvent(store, gw, ev("PAYMENT.CAPTURE.COMPLETED", "X", "MOCK-AUTH-9999"))).outcome, "unmatched");
});

test("refund or reversal after settlement is flagged, not hidden", async () => {
  const gw = new MockPaymentGateway();
  const store = new InMemoryPaymentOperationStore();
  const auth = await fundedMilestone(gw, "m1", 4000);
  store.add(settleOp("op_1", auth));
  await runSettle(store, gw, "op_1");
  const r = await runWebhookEvent(store, gw, ev("PAYMENT.CAPTURE.REVERSED", "CAPX", auth));
  assert.equal(r.outcome, "financial_exception");
});

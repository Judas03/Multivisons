// packages/payments/test/mock-gateway.test.ts
// Run: npm test --workspace @multivisons/payments
import { test } from "node:test";
import assert from "node:assert/strict";
import { MockPaymentGateway } from "../src/mock-gateway.ts";

const USD = (amountMinor: number) => ({ currency: "USD" as const, amountMinor });
const fixedNow = () => new Date("2026-11-05T10:00:00.000Z");

async function fundM1(gw: MockPaymentGateway) {
  const checkout = await gw.createFundingOrder({
    agreementId: "agr_demo", agreementVersion: 1, milestoneId: "m1", milestoneTitle: "Chatbot prototype",
    amount: USD(4000), idempotencyKey: "agr_demo/v1/m1/fund/v1",
    returnUrl: "http://localhost:3000/funding/return", cancelUrl: "http://localhost:3000/funding/cancel",
  });
  const funding = await gw.confirmFunding({ milestoneId: "m1", orderId: checkout.orderId, expectedAmount: USD(4000), idempotencyKey: "agr_demo/v1/m1/confirm/v1" });
  return { checkout, funding };
}

const settleOp = (authorizationId: string, amountMinor = 4000) => ({
  operationId: "op_1", agreementId: "agr_demo", milestoneId: "m1", submissionId: "sub_1",
  authorizationId, amount: USD(amountMinor), idempotencyKey: "agr_demo/v1/m1/sub_1/settle/v1",
});

test("happy path: fund, authorize, capture", async () => {
  const gw = new MockPaymentGateway({ now: fixedNow });
  const { checkout, funding } = await fundM1(gw);
  assert.equal(checkout.status, "PENDING");
  assert.match(checkout.approveUrl, /^http:\/\/localhost:3000\/funding\/return\?token=MOCK-ORDER-/);
  assert.equal(funding.status, "CONFIRMED");
  assert.equal(funding.authorizationExpiresAt, "2026-12-04T10:00:00.000Z");

  const result = await gw.settle(settleOp(funding.authorizationId!));
  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.providerStatus, "COMPLETED");
});

test("same idempotency key never captures twice", async () => {
  const gw = new MockPaymentGateway();
  const { funding } = await fundM1(gw);
  const a = await gw.settle(settleOp(funding.authorizationId!));
  const b = await gw.settle(settleOp(funding.authorizationId!));
  assert.deepEqual(a, b);
});

test("cannot capture more than the authorization", async () => {
  const gw = new MockPaymentGateway();
  const { funding } = await fundM1(gw);
  const r = await gw.settle(settleOp(funding.authorizationId!, 4001));
  assert.equal(r.status, "FAILED");
  assert.equal(r.reasonCode, "AMOUNT_EXCEEDS_AUTHORIZATION");
});

test("void an unused milestone, then capture is refused", async () => {
  const gw = new MockPaymentGateway();
  const { funding } = await fundM1(gw);
  const v = await gw.cancelFunding({ operationId: "op_2", milestoneId: "m1", authorizationId: funding.authorizationId!, idempotencyKey: "agr_demo/v1/m1/void/v1" });
  assert.equal(v.providerStatus, "VOIDED");
  const r = await gw.settle(settleOp(funding.authorizationId!));
  assert.equal(r.reasonCode, "AUTHORIZATION_VOIDED");
});

test("lost response: settle says UNKNOWN, reconcile finds the capture", async () => {
  const gw = new MockPaymentGateway({ scenario: "lost_response" });
  const { funding } = await fundM1(gw);
  const first = await gw.settle(settleOp(funding.authorizationId!));
  assert.equal(first.status, "UNKNOWN");
  const check = await gw.reconcile({ kind: "authorization", providerReference: funding.authorizationId! });
  assert.equal(check.status, "CONFIRMED");
  assert.match(check.providerReference!, /^MOCK-CAPTURE-/);
});

test("capture_pending and capture_denied scenarios", async () => {
  for (const [scenario, expected] of [["capture_pending", "PENDING"], ["capture_denied", "FAILED"]] as const) {
    const gw = new MockPaymentGateway({ scenario });
    const { funding } = await fundM1(gw);
    assert.equal((await gw.settle(settleOp(funding.authorizationId!))).status, expected);
  }
});

test("not_approved scenario fails funding", async () => {
  const gw = new MockPaymentGateway({ scenario: "not_approved" });
  const { funding } = await fundM1(gw);
  assert.equal(funding.status, "FAILED");
  assert.equal(funding.reasonCode, "ORDER_NOT_APPROVED");
});

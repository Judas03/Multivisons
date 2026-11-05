// packages/payments/test/webhooks.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryWebhookInbox, eventToProviderLookup, receivePayPalWebhook } from "../src/webhooks.ts";
import { MockPaymentGateway } from "../src/mock-gateway.ts";

function gatewayThatVerifies(result: { verified: boolean; eventId?: string; eventType?: string; resourceId?: string } | "throw") {
  const gw = new MockPaymentGateway();
  gw.verifyWebhook = async () => {
    if (result === "throw") throw new Error("PayPal down");
    return result;
  };
  return gw;
}

const captureEvent = {
  id: "WH-1",
  event_type: "PAYMENT.CAPTURE.COMPLETED",
  resource: { id: "CAP1", status: "COMPLETED", supplementary_data: { related_ids: { order_id: "ORD1", authorization_id: "AUTH1" } } },
};
const req = (body: unknown) => ({ headers: { "paypal-transmission-id": "t1" }, rawBody: JSON.stringify(body) });

test("verified capture event is stored once with its authorization ID; duplicate is acknowledged", async () => {
  const gateway = gatewayThatVerifies({ verified: true, eventId: "WH-1", eventType: "PAYMENT.CAPTURE.COMPLETED", resourceId: "CAP1" });
  const inbox = new InMemoryWebhookInbox();
  assert.deepEqual(await receivePayPalWebhook(req(captureEvent), { gateway, inbox }), { httpStatus: 200, outcome: "stored" });
  assert.deepEqual(await receivePayPalWebhook(req(captureEvent), { gateway, inbox }), { httpStatus: 200, outcome: "duplicate" });
  const stored = inbox.events.get("WH-1")!;
  assert.equal(stored.authorizationId, "AUTH1");
  assert.deepEqual(eventToProviderLookup(stored), { kind: "capture", providerReference: "CAP1" });
});

test("unverified event is rejected and not stored", async () => {
  const inbox = new InMemoryWebhookInbox();
  const r = await receivePayPalWebhook(req(captureEvent), { gateway: gatewayThatVerifies({ verified: false }), inbox });
  assert.equal(r.httpStatus, 400);
  assert.equal(inbox.events.size, 0);
});

test("verification outage returns 503 so PayPal retries", async () => {
  const r = await receivePayPalWebhook(req(captureEvent), { gateway: gatewayThatVerifies("throw"), inbox: new InMemoryWebhookInbox() });
  assert.equal(r.httpStatus, 503);
});

test("authorization event maps to its own ID", async () => {
  const inbox = new InMemoryWebhookInbox();
  const ev = { id: "WH-2", event_type: "PAYMENT.AUTHORIZATION.VOIDED", resource: { id: "AUTH9", supplementary_data: { related_ids: { order_id: "ORD9" } } } };
  await receivePayPalWebhook(req(ev), { gateway: gatewayThatVerifies({ verified: true, eventId: "WH-2", eventType: ev.event_type, resourceId: "AUTH9" }), inbox });
  assert.equal(inbox.events.get("WH-2")!.authorizationId, "AUTH9");
});

test("event types we don't use are acknowledged and dropped", async () => {
  const inbox = new InMemoryWebhookInbox();
  const r = await receivePayPalWebhook(req({ id: "WH-3", event_type: "BILLING.PLAN.CREATED", resource: { id: "P1" } }),
    { gateway: gatewayThatVerifies({ verified: true, eventId: "WH-3", eventType: "BILLING.PLAN.CREATED", resourceId: "P1" }), inbox });
  assert.deepEqual(r, { httpStatus: 200, outcome: "ignored_type" });
  assert.equal(inbox.events.size, 0);
});

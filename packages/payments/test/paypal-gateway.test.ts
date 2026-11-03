// packages/payments/test/paypal-gateway.test.ts
// Runs PayPalGateway against an in-process fake of the PayPal REST API (no network).
// Run: npm test --workspace @multivisons/payments
import { test } from "node:test";
import assert from "node:assert/strict";
import { PayPalGateway, fromPayPalAmount, toPayPalValue } from "../src/paypal-gateway.ts";

const USD = (amountMinor: number) => ({ currency: "USD" as const, amountMinor });

// ---------- a small fake PayPal ----------
type Fake = {
  fetch: typeof fetch;
  posts: { path: string; requestId: string | null }[];
  approve(orderId: string): void;
  failNext(kind: "network" | "500" | "lost-after-success"): void;
};

function fakePayPal(): Fake {
  let n = 0;
  const orders = new Map<string, any>();
  const auths = new Map<string, any>();
  const captures = new Map<string, any>();
  const replay = new Map<string, { status: number; body: any }>();
  const posts: Fake["posts"] = [];
  let fail: null | "network" | "500" | "lost-after-success" = null;
  const id = (p: string) => `${p}${String(++n).padStart(6, "0")}`;
  const json = (status: number, body?: any) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", "paypal-debug-id": "dbg1" } });
  const err = (status: number, issue: string) => json(status, { name: "UNPROCESSABLE_ENTITY", details: [{ issue }] });

  function handle(method: string, path: string, body: any): { status: number; body?: any } {
    let m: RegExpExecArray | null;
    if (method === "POST" && path === "/v2/checkout/orders") {
      const o = { id: id("ORD"), status: "PAYER_ACTION_REQUIRED", intent: body.intent, purchase_units: [{ ...body.purchase_units[0], payments: {} }],
        links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=X" }] };
      o.links[0].href = o.links[0].href.replace("X", o.id);
      orders.set(o.id, o);
      return { status: 201, body: o };
    }
    if ((m = /^\/v2\/checkout\/orders\/(\w+)$/.exec(path)) && method === "GET") {
      const o = orders.get(m[1]);
      return o ? { status: 200, body: o } : { status: 404, body: { name: "RESOURCE_NOT_FOUND", details: [{ issue: "INVALID_RESOURCE_ID" }] } };
    }
    if ((m = /^\/v2\/checkout\/orders\/(\w+)\/authorize$/.exec(path))) {
      const o = orders.get(m[1]);
      if (o.status !== "APPROVED") return { status: 422, body: { details: [{ issue: o.purchase_units[0].payments.authorizations ? "ORDER_ALREADY_AUTHORIZED" : "ORDER_NOT_APPROVED" }] } };
      const a = { id: id("AUTH"), status: "CREATED", amount: o.purchase_units[0].amount, expiration_time: "2026-12-02T07:33:53Z",
        supplementary_data: { related_ids: { order_id: o.id } } };
      auths.set(a.id, a);
      o.status = "COMPLETED";
      o.purchase_units[0].payments.authorizations = [a];
      return { status: 201, body: o };
    }
    if ((m = /^\/v2\/payments\/authorizations\/(\w+)$/.exec(path))) {
      const a = auths.get(m[1]);
      return a ? { status: 200, body: a } : { status: 404, body: { details: [{ issue: "INVALID_RESOURCE_ID" }] } };
    }
    if ((m = /^\/v2\/payments\/authorizations\/(\w+)\/capture$/.exec(path))) {
      const a = auths.get(m[1]);
      if (a.status === "CAPTURED") return { status: 422, body: { details: [{ issue: "AUTHORIZATION_ALREADY_CAPTURED" }] } };
      if (a.status === "VOIDED") return { status: 422, body: { details: [{ issue: "AUTHORIZATION_VOIDED" }] } };
      const c = { id: id("CAP"), status: "COMPLETED", amount: body.amount };
      captures.set(c.id, c);
      a.status = "CAPTURED";
      const o = orders.get(a.supplementary_data.related_ids.order_id);
      o.purchase_units[0].payments.captures = [c];
      return { status: 201, body: c };
    }
    if ((m = /^\/v2\/payments\/authorizations\/(\w+)\/void$/.exec(path))) {
      const a = auths.get(m[1]);
      if (a.status === "VOIDED") return { status: 422, body: { details: [{ issue: "AUTHORIZATION_ALREADY_VOIDED" }] } };
      a.status = "VOIDED";
      return { status: 200, body: a };
    }
    if ((m = /^\/v2\/payments\/captures\/(\w+)$/.exec(path))) return { status: 200, body: captures.get(m[1]) };
    return { status: 404, body: { name: "NOT_FOUND" } };
  }

  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? "GET";
    if (path === "/v1/oauth2/token") return json(200, { access_token: "tok", expires_in: 32400 });
    const headers = new Headers(init?.headers);
    const requestId = headers.get("paypal-request-id");
    if (method === "POST") posts.push({ path, requestId });

    if (fail === "network" && method === "POST") { fail = null; throw new TypeError("fetch failed"); }
    if (fail === "500" && method === "POST") { fail = null; return json(500, { name: "INTERNAL_SERVER_ERROR" }); }

    const key = requestId ? `${path}#${requestId}` : null;
    if (key && replay.has(key)) { const r = replay.get(key)!; return json(r.status, r.body); }
    const r = handle(method, path, init?.body ? JSON.parse(String(init.body)) : undefined);
    if (key && r.status < 300) replay.set(key, { status: r.status, body: r.body });
    if (fail === "lost-after-success" && method === "POST") { fail = null; throw new TypeError("socket hang up"); }
    return json(r.status, r.body);
  }) as typeof fetch;

  return {
    fetch: fetchFn,
    posts,
    approve: (orderId) => { orders.get(orderId).status = "APPROVED"; },
    failNext: (k) => { fail = k; },
  };
}

function setup() {
  const pp = fakePayPal();
  const gw = new PayPalGateway({ clientId: "id", clientSecret: "secret", apiBase: "https://fake.paypal.test", fetch: pp.fetch, now: () => new Date("2026-11-05T10:00:00Z") });
  return { pp, gw };
}

const funding = {
  agreementId: "agr_demo", agreementVersion: 1, milestoneId: "m1", milestoneTitle: "Chatbot prototype",
  amount: USD(4000), idempotencyKey: "agr_demo/v1/m1/fund/v1",
  returnUrl: "http://localhost:3000/funding/return", cancelUrl: "http://localhost:3000/funding/cancel",
};
const confirmRef = (orderId: string) => ({ milestoneId: "m1", orderId, expectedAmount: USD(4000), idempotencyKey: "agr_demo/v1/m1/authorize/v1" });
const settleOp = (authorizationId: string, amountMinor = 4000) => ({
  operationId: "op_1", agreementId: "agr_demo", milestoneId: "m1", submissionId: "sub_1",
  authorizationId, amount: USD(amountMinor), idempotencyKey: "agr_demo/v1/m1/sub_1/settle/v1",
});

async function fundedAuth(pp: Fake, gw: PayPalGateway) {
  const co = await gw.createFundingOrder(funding);
  pp.approve(co.orderId);
  const f = await gw.confirmFunding(confirmRef(co.orderId));
  return { co, f };
}

// ---------- tests ----------

test("money conversion is exact in both directions", () => {
  assert.equal(toPayPalValue(USD(4000)), "40.00");
  assert.equal(toPayPalValue(USD(11005)), "110.05");
  assert.equal(toPayPalValue(USD(7)), "0.07");
  assert.deepEqual(fromPayPalAmount({ currency_code: "USD", value: "38.34" }), USD(3834));
  assert.deepEqual(fromPayPalAmount({ currency_code: "USD", value: "40" }), USD(4000));
  assert.deepEqual(fromPayPalAmount({ currency_code: "USD", value: "0.5" }), USD(50));
  assert.equal(fromPayPalAmount({ currency_code: "EUR", value: "1.00" }), undefined);
  assert.throws(() => toPayPalValue(USD(40.5)));
});

test("create -> approve -> confirm -> settle, with request IDs on every POST", async () => {
  const { pp, gw } = setup();
  const co = await gw.createFundingOrder(funding);
  assert.equal(co.status, "PENDING");
  assert.match(co.approveUrl, /checkoutnow\?token=ORD/);

  const notYet = await gw.confirmFunding(confirmRef(co.orderId));
  assert.equal(notYet.status, "PENDING");
  assert.equal(notYet.reasonCode, "ORDER_NOT_APPROVED");

  pp.approve(co.orderId);
  const f = await gw.confirmFunding(confirmRef(co.orderId));
  assert.equal(f.status, "CONFIRMED");
  assert.equal(f.authorizationExpiresAt, "2026-12-02T07:33:53Z");

  const s = await gw.settle(settleOp(f.authorizationId!));
  assert.equal(s.status, "CONFIRMED");
  assert.equal(s.providerStatus, "COMPLETED");
  assert.deepEqual(s.amount, USD(4000));
  assert.ok(pp.posts.every((p) => p.requestId), "every POST must carry PayPal-Request-Id");
});

test("confirmFunding twice does not authorize twice", async () => {
  const { pp, gw } = setup();
  const { co, f } = await fundedAuth(pp, gw);
  const again = await gw.confirmFunding(confirmRef(co.orderId));
  assert.equal(again.authorizationId, f.authorizationId);
  assert.equal(pp.posts.filter((p) => p.path.endsWith("/authorize")).length, 1);
});

test("confirmFunding refuses an order whose amount differs from the frozen amount", async () => {
  const { pp, gw } = setup();
  const co = await gw.createFundingOrder(funding);
  pp.approve(co.orderId);
  const r = await gw.confirmFunding({ ...confirmRef(co.orderId), expectedAmount: USD(3999) });
  assert.equal(r.status, "FAILED");
  assert.equal(r.reasonCode, "AMOUNT_MISMATCH");
});

test("settle refuses an amount different from the authorization, without calling capture", async () => {
  const { pp, gw } = setup();
  const { f } = await fundedAuth(pp, gw);
  const r = await gw.settle(settleOp(f.authorizationId!, 4001));
  assert.equal(r.reasonCode, "AMOUNT_MISMATCH");
  assert.equal(pp.posts.filter((p) => p.path.endsWith("/capture")).length, 0);
});

test("network error on capture -> UNKNOWN; retry finds the existing capture and does not capture again", async () => {
  const { pp, gw } = setup();
  const { f } = await fundedAuth(pp, gw);
  pp.failNext("lost-after-success"); // PayPal captured, but the response never arrived
  const first = await gw.settle(settleOp(f.authorizationId!));
  assert.equal(first.status, "UNKNOWN");

  const check = await gw.reconcile({ kind: "authorization", providerReference: f.authorizationId! });
  assert.equal(check.status, "CONFIRMED");
  assert.match(check.providerReference!, /^CAP/);

  const retry = await gw.settle(settleOp(f.authorizationId!));
  assert.equal(retry.status, "CONFIRMED");
  assert.equal(retry.providerReference, check.providerReference);
  assert.equal(pp.posts.filter((p) => p.path.endsWith("/capture")).length, 1);
});

test("HTTP 500 is UNKNOWN, not FAILED", async () => {
  const { pp, gw } = setup();
  const { f } = await fundedAuth(pp, gw);
  pp.failNext("500");
  assert.equal((await gw.settle(settleOp(f.authorizationId!))).status, "UNKNOWN");
});

test("void an unused authorization; voiding again is still CONFIRMED; capture afterwards fails", async () => {
  const { pp, gw } = setup();
  const { f } = await fundedAuth(pp, gw);
  const op = { operationId: "op_2", milestoneId: "m1", authorizationId: f.authorizationId!, idempotencyKey: "agr_demo/v1/m1/void/v1" };
  assert.equal((await gw.cancelFunding(op)).providerStatus, "VOIDED");
  assert.equal((await gw.cancelFunding({ ...op, idempotencyKey: "agr_demo/v1/m1/void/v2" })).status, "CONFIRMED");
  const s = await gw.settle(settleOp(f.authorizationId!));
  assert.equal(s.status, "FAILED");
  assert.equal(s.reasonCode, "AUTHORIZATION_VOIDED");
});

test("rejects IDs that could change the request path", async () => {
  const { gw } = setup();
  await assert.rejects(gw.reconcile({ kind: "capture", providerReference: "../../v1/oauth2/token" }));
});

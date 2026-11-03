// packages/payments/scripts/paypal-gateway-smoke.ts
//
// Runs the real PayPalGateway class (the code the worker will use) against the sandbox.
// Same idea as paypal-capability-check.ts, but tests our gateway rather than raw calls.
//
//   npm run paypal:smoke -- create   # creates one $40 order, prints the approval link
//   (approve it as the sandbox Personal account)
//   npm run paypal:smoke -- finish   # confirmFunding -> settle -> settle again -> reconcile
//
// Checks on the real sandbox that: a second settle() does not capture twice, and
// reconcile() on an authorization finds its capture ID through the parent order.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PayPalGateway, payPalConfigFromEnv } from "../src/paypal-gateway.ts";

const STATE = "tmp/paypal-gateway-smoke.json";
const USD = (amountMinor: number) => ({ currency: "USD" as const, amountMinor });
const gw = new PayPalGateway(payPalConfigFromEnv());

async function create() {
  const run = randomUUID();
  const co = await gw.createFundingOrder({
    agreementId: `smoke-${run.slice(0, 8)}`, agreementVersion: 1, milestoneId: "m1", milestoneTitle: "Gateway smoke test",
    amount: USD(4000), idempotencyKey: `smoke/${run}/m1/fund/v1`,
    returnUrl: "https://example.com/multivisons/return", cancelUrl: "https://example.com/multivisons/cancel",
  });
  console.log("createFundingOrder:", co);
  if (co.status !== "PENDING") process.exit(1);
  await mkdir("tmp", { recursive: true });
  await writeFile(STATE, JSON.stringify({ run, orderId: co.orderId }, null, 2));
  console.log(`\nApprove as the sandbox Personal account:\n  ${co.approveUrl}\n\nThen run:  npm run paypal:smoke -- finish`);
}

async function finish() {
  const { run, orderId } = JSON.parse(await readFile(STATE, "utf8"));
  const f = await gw.confirmFunding({ milestoneId: "m1", orderId, expectedAmount: USD(4000), idempotencyKey: `smoke/${run}/m1/authorize/v1` });
  console.log("confirmFunding:", f);
  if (f.status !== "CONFIRMED" || !f.authorizationId) process.exit(1);

  const op = { operationId: `op-${run.slice(0, 8)}`, agreementId: "smoke", milestoneId: "m1", submissionId: "sub1",
    authorizationId: f.authorizationId, amount: USD(4000), idempotencyKey: `smoke/${run}/m1/sub1/settle/v1` };
  const s1 = await gw.settle(op);
  console.log("settle #1:", s1);
  const s2 = await gw.settle(op);
  console.log("settle #2 (must be the same capture):", s2);
  const rec = await gw.reconcile({ kind: "authorization", providerReference: f.authorizationId });
  console.log("reconcile(authorization):", rec);

  const ok = s1.status === "CONFIRMED" && s2.providerReference === s1.providerReference && rec.providerReference === s1.providerReference;
  console.log(ok ? "\nPASS: one capture, found again by settle and reconcile." : "\nCHECK: results differ, paste this output to Claude.");
}

const cmd = process.argv[2];
(cmd === "create" ? create() : cmd === "finish" ? finish() : Promise.reject(new Error("Usage: npm run paypal:smoke -- <create|finish>")))
  .catch((e) => { console.error((e as Error).message); process.exit(1); });

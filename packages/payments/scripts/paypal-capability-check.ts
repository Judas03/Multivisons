// packages/payments/scripts/paypal-capability-check.ts
//
// Sandbox capability check for payment mode AUTHORIZED_THEN_CAPTURED.
// Proves, against the real PayPal sandbox, the four calls the demo needs:
//   create order (intent AUTHORIZE) -> buyer approves -> authorize -> capture
// plus a second order that is authorized and then voided.
//
// Run from the repo root (Node 24, reads .env):
//   npm run paypal:check -- create    # creates 2 orders, prints 2 approval links
//   (open both links, log in as the sandbox Personal account, approve)
//   npm run paypal:check -- finish    # authorize both, capture A, void B, read back
//   npm run paypal:check -- status    # read back every saved ID again (safe to repeat)
//
// Run state (order IDs, request IDs) is kept in tmp/paypal-capability-run.json,
// which is git-ignored. Re-running "finish" reuses the same PayPal-Request-Id
// values, so a retry after a lost response cannot authorize or capture twice.
// No secret or access token is ever printed or written to disk.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const STATE_FILE = "tmp/paypal-capability-run.json";
const API_BASE = process.env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com";

// Demo milestones from the frozen plan, in integer cents (USD).
const ORDER_A = { label: "A (capture)", milestone: "M1", amountCents: 4000 };
const ORDER_B = { label: "B (void)", milestone: "M2", amountCents: 11000 };

type Step = { requestId: string; done?: boolean; resultId?: string; status?: string };
type OrderRun = {
  label: string;
  milestone: string;
  amountCents: number;
  orderId: string;
  approveUrl: string;
  authorize?: Step; // resultId = authorization ID
  settle?: Step; // capture (order A) or void (order B); resultId = capture ID for A
};
type RunState = { runId: string; createdAt: string; apiBase: string; orders: OrderRun[] };

// ---------- small helpers ----------

function centsToPayPalValue(cents: number): string {
  if (!Number.isInteger(cents) || cents <= 0) throw new Error(`Bad amount in cents: ${cents}`);
  const whole = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, "0");
  return `${whole}.${rest}`;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is missing. Copy .env.example to .env and fill it in (see docs/payment-sandbox-setup.md).`);
  }
  return value;
}

async function loadState(): Promise<RunState> {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8")) as RunState;
  } catch {
    throw new Error(`No saved run at ${STATE_FILE}. Run "npm run paypal:check -- create" first.`);
  }
}

async function saveState(state: RunState): Promise<void> {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

// ---------- PayPal HTTP ----------

let cachedToken: string | undefined;

async function getAccessToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const id = requireEnv("PAYPAL_CLIENT_ID");
  const secret = requireEnv("PAYPAL_CLIENT_SECRET");
  const res = await fetch(`${API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    throw new Error(`Could not get an access token (HTTP ${res.status}). Check PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are the SANDBOX ones.`);
  }
  const json = (await res.json()) as { access_token: string };
  cachedToken = json.access_token;
  return cachedToken;
}

class UnknownOutcomeError extends Error {}

// One PayPal call. A network error or 5xx means we do not know whether PayPal acted:
// that is status UNKNOWN, and the caller must GET before trying again.
async function paypal(method: "GET" | "POST", path: string, opts: { body?: unknown; requestId?: string } = {}) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await getAccessToken()}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch (err) {
    throw new UnknownOutcomeError(`${method} ${path}: no response (${(err as Error).message}). Outcome UNKNOWN.`);
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  const debugId = res.headers.get("paypal-debug-id") ?? "n/a";
  if (res.status >= 500) {
    throw new UnknownOutcomeError(`${method} ${path}: HTTP ${res.status} (debug id ${debugId}). Outcome UNKNOWN.`);
  }
  if (!res.ok) {
    const issue = json?.details?.[0]?.issue ?? json?.name ?? "error";
    throw new Error(`${method} ${path}: HTTP ${res.status} ${issue} (debug id ${debugId})\n${JSON.stringify(json, null, 2)}`);
  }
  return json;
}

// ---------- commands ----------

async function create(): Promise<void> {
  const runId = randomUUID();
  const orders: OrderRun[] = [];

  for (const o of [ORDER_A, ORDER_B]) {
    const requestId = `capcheck/${runId}/${o.milestone}/create/v1`;
    const order = await paypal("POST", "/v2/checkout/orders", {
      requestId,
      body: {
        intent: "AUTHORIZE",
        purchase_units: [
          {
            reference_id: o.milestone,
            description: `Multivisons capability check, milestone ${o.milestone}`,
            amount: { currency_code: "USD", value: centsToPayPalValue(o.amountCents) },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              // Nothing needs to listen here: after approving, PayPal just redirects the browser.
              return_url: "https://example.com/multivisons/return",
              cancel_url: "https://example.com/multivisons/cancel",
              shipping_preference: "NO_SHIPPING",
              user_action: "CONTINUE",
            },
          },
        },
      },
    });

    const link = (order.links as { rel: string; href: string }[]).find((l) => l.rel === "payer-action" || l.rel === "approve");
    if (!link) throw new Error(`Order ${order.id} has no approval link`);
    orders.push({ ...o, orderId: order.id, approveUrl: link.href });
    console.log(`Order ${o.label}: ${order.id}  status=${order.status}`);
  }

  await saveState({ runId, createdAt: new Date().toISOString(), apiBase: API_BASE, orders });

  console.log("\nNext: open BOTH links below in a browser, log in with the sandbox PERSONAL (buyer) account,");
  console.log("and approve. You will land on an example.com page: that is expected, just close it.\n");
  for (const o of orders) console.log(`  ${o.label}, $${centsToPayPalValue(o.amountCents)}:\n  ${o.approveUrl}\n`);
  console.log('Then run:  npm run paypal:check -- finish');
}

async function authorizeOrder(state: RunState, o: OrderRun): Promise<string> {
  if (o.authorize?.done && o.authorize.resultId) return o.authorize.resultId;
  o.authorize ??= { requestId: `capcheck/${state.runId}/${o.milestone}/authorize/v1` };
  await saveState(state); // persist the request ID BEFORE calling, so a retry reuses it

  try {
    const res = await paypal("POST", `/v2/checkout/orders/${o.orderId}/authorize`, { requestId: o.authorize.requestId, body: {} });
    const auth = res.purchase_units[0].payments.authorizations[0];
    Object.assign(o.authorize, { done: true, resultId: auth.id, status: auth.status });
    console.log(`Order ${o.label}: authorized -> authorization ${auth.id} status=${auth.status} expires=${auth.expiration_time}`);
  } catch (err) {
    if (String(err).includes("ORDER_NOT_APPROVED")) {
      throw new Error(`Order ${o.label} is not approved yet. Open its link and approve it as the buyer:\n  ${o.approveUrl}`);
    }
    if (String(err).includes("ORDER_ALREADY_AUTHORIZED")) {
      // A previous attempt worked but we lost the response: read the result back.
      const order = await paypal("GET", `/v2/checkout/orders/${o.orderId}`);
      const auth = order.purchase_units[0].payments.authorizations[0];
      Object.assign(o.authorize, { done: true, resultId: auth.id, status: auth.status });
      console.log(`Order ${o.label}: was already authorized -> ${auth.id} status=${auth.status}`);
    } else throw err;
  }
  await saveState(state);
  return o.authorize.resultId!;
}

async function finish(): Promise<void> {
  const state = await loadState();
  const [a, b] = state.orders;

  // A: authorize, then capture the full milestone amount.
  const authA = await authorizeOrder(state, a);
  if (!a.settle?.done) {
    a.settle ??= { requestId: `capcheck/${state.runId}/${a.milestone}/settle/v1` };
    await saveState(state);
    const cap = await paypal("POST", `/v2/payments/authorizations/${authA}/capture`, {
      requestId: a.settle.requestId,
      body: { final_capture: true, amount: { currency_code: "USD", value: centsToPayPalValue(a.amountCents) } },
    });
    Object.assign(a.settle, { done: true, resultId: cap.id, status: cap.status });
    await saveState(state);
    console.log(`Order ${a.label}: captured -> capture ${cap.id} status=${cap.status}`);
  }

  // B: authorize, then void (the "cancel unused milestone" path).
  const authB = await authorizeOrder(state, b);
  if (!b.settle?.done) {
    b.settle ??= { requestId: `capcheck/${state.runId}/${b.milestone}/void/v1` };
    await saveState(state);
    const v = await paypal("POST", `/v2/payments/authorizations/${authB}/void`, { requestId: b.settle.requestId });
    Object.assign(b.settle, { done: true, status: v?.status ?? "VOIDED" });
    await saveState(state);
    console.log(`Order ${b.label}: voided authorization ${authB}`);
  }

  console.log("");
  await status();
}

async function status(): Promise<void> {
  const state = await loadState();
  const rows: string[] = [];
  for (const o of state.orders) {
    const order = await paypal("GET", `/v2/checkout/orders/${o.orderId}`);
    rows.push(`| ${o.label} | Order | \`${o.orderId}\` | ${order.status} |`);
    if (o.authorize?.resultId) {
      const auth = await paypal("GET", `/v2/payments/authorizations/${o.authorize.resultId}`);
      rows.push(`| ${o.label} | Authorization | \`${auth.id}\` | ${auth.status} (expires ${auth.expiration_time ?? "n/a"}) |`);
    }
    if (o.settle?.resultId) {
      const cap = await paypal("GET", `/v2/payments/captures/${o.settle.resultId}`);
      const net = cap.seller_receivable_breakdown;
      const extra = net ? `, gross ${net.gross_amount.value}, fee ${net.paypal_fee?.value ?? "?"}, net ${net.net_amount?.value ?? "?"}` : "";
      rows.push(`| ${o.label} | Capture | \`${cap.id}\` | ${cap.status}${extra} |`);
    }
  }

  console.log("Paste this into docs/payment-capabilities.md (sandbox IDs only, no secrets):\n");
  console.log(`Run ${state.runId}, started ${state.createdAt}, host ${state.apiBase}\n`);
  console.log("| Order | Object | Sandbox ID | Status read back by GET |");
  console.log("| --- | --- | --- | --- |");
  for (const r of rows) console.log(r);
}

// ---------- entry ----------

const commands: Record<string, () => Promise<void>> = { create, finish, status };
const cmd = process.argv[2] ?? "";

if (!commands[cmd]) {
  console.error("Usage: npm run paypal:check -- <create|finish|status>");
  process.exit(1);
}

commands[cmd]().catch((err) => {
  if (err instanceof UnknownOutcomeError) {
    console.error(`\n${err.message}\nDo NOT start over. Run "npm run paypal:check -- status" to see what PayPal recorded, then re-run the same command; it reuses the same PayPal-Request-Id.`);
  } else {
    console.error(`\n${(err as Error).message}`);
  }
  process.exit(1);
});

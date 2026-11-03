// packages/payments/scripts/paypal-webhook.ts
//
// Sandbox webhook test kit, no Next.js needed:
//   npm run paypal:webhook -- register https://xxxx.trycloudflare.com   # create the webhook in the sandbox app
//   npm run paypal:webhook -- listen                                    # local receiver on http://localhost:4010
//   npm run paypal:webhook -- list                                      # show webhooks registered on the app
//
// "listen" runs the same receivePayPalWebhook() the real route will use: it verifies each
// event with PayPal, stores it once, then GETs the authoritative status and prints it.
// The webhook is created with the app's own client ID/secret, so nobody has to open the dashboard.

import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PayPalGateway, payPalConfigFromEnv } from "../src/paypal-gateway.ts";
import { InMemoryWebhookInbox, PAYPAL_WEBHOOK_EVENT_TYPES, eventToProviderLookup, receivePayPalWebhook } from "../src/webhooks.ts";

const STATE = "tmp/paypal-webhook.json";
const PORT = Number(process.env.WEBHOOK_PORT || 4010);
const PATH = "/api/webhooks/paypal";
const config = payPalConfigFromEnv();
const base = config.apiBase!;

async function token(): Promise<string> {
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`OAuth failed: HTTP ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${json?.details?.[0]?.issue ?? json?.name ?? ""}\n${text}`);
  return json;
}

async function list() {
  const { webhooks = [] } = await api("GET", "/v1/notifications/webhooks");
  if (webhooks.length === 0) console.log("No webhooks registered on this app.");
  for (const w of webhooks) console.log(`${w.id}  ${w.url}  (${w.event_types.length} event types)`);
  return webhooks as { id: string; url: string }[];
}

async function register(publicBase: string | undefined) {
  if (!publicBase || !publicBase.startsWith("https://")) throw new Error("Give the https tunnel URL, e.g. npm run paypal:webhook -- register https://abc.trycloudflare.com");
  const url = publicBase.replace(/\/$/, "") + PATH;
  // Quick tunnels get a new URL every time: remove old tunnel webhooks so we stay under PayPal's 10-webhook limit.
  for (const w of await list()) {
    if (w.url.includes(".trycloudflare.com") || w.url === url) {
      await api("DELETE", `/v1/notifications/webhooks/${w.id}`);
      console.log(`Deleted old tunnel webhook ${w.id}`);
    }
  }
  const created = await api("POST", "/v1/notifications/webhooks", { url, event_types: PAYPAL_WEBHOOK_EVENT_TYPES.map((name) => ({ name })) });
  await mkdir("tmp", { recursive: true });
  await writeFile(STATE, JSON.stringify({ webhookId: created.id, url }, null, 2));
  console.log(`\nRegistered webhook ${created.id}\n  -> ${url}\n\nNow run:  npm run paypal:webhook -- listen`);
  console.log(`(For the real app later, put PAYPAL_WEBHOOK_ID=${created.id} in .env)`);
}

async function listen() {
  let webhookId = config.webhookId;
  if (!webhookId) {
    try {
      webhookId = JSON.parse(await readFile(STATE, "utf8")).webhookId;
    } catch {
      throw new Error('No webhook ID. Run "npm run paypal:webhook -- register <tunnel url>" first.');
    }
  }
  const gateway = new PayPalGateway({ ...config, webhookId });
  const inbox = new InMemoryWebhookInbox();

  createServer((req, res) => {
    if (req.method !== "POST" || req.url !== PATH) {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v ?? ""]));
      const r = await receivePayPalWebhook({ headers, rawBody }, { gateway, inbox });
      res.writeHead(r.httpStatus).end();

      let type = "?", resourceId = "?";
      try { const e = JSON.parse(rawBody); type = e.event_type; resourceId = e.resource?.id; } catch {}
      console.log(`\n[${new Date().toISOString()}] ${type}  resource=${resourceId}  -> HTTP ${r.httpStatus} ${r.outcome}`);

      if (r.outcome === "stored") {
        const stored = [...inbox.events.values()].at(-1)!;
        const lookup = eventToProviderLookup(stored);
        if (lookup) {
          const truth = await gateway.reconcile(lookup);
          console.log(`  GET ${lookup.kind} ${lookup.providerReference}: ${truth.status} (${truth.providerStatus ?? truth.reasonCode})`);
        }
      }
    });
  }).listen(PORT, () => {
    console.log(`Listening on http://localhost:${PORT}${PATH} (webhook ${webhookId}).`);
    console.log("Leave this window open. In another window run: npm run paypal:smoke -- create  (then approve, then finish)");
  });
}

const [cmd, arg] = process.argv.slice(2);
const run = cmd === "register" ? register(arg) : cmd === "list" ? list() : cmd === "listen" ? listen() : Promise.reject(new Error("Usage: npm run paypal:webhook -- <register URL|listen|list>"));
run.catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});

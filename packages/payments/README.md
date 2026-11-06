# @multivisons/payments: hand-off guide

Owner: Koe (payments). For: the full-stack owner wiring payments into the app.
Status (2026-11-06): **everything below is built, tested, and verified on the real PayPal sandbox**, merged in `work/payments`. What's left is connecting it to the database, the API routes and the UI. That's your part. Questions → Koe.

## 1. How the money moves (mode `AUTHORIZED_THEN_CAPTURED`)

```
Client funds milestone ──► createFundingOrder ──► redirect browser to approveUrl (PayPal)
PayPal sends browser back ─► confirmFunding ────► authorization (money reserved, 29 days)
Client approves work ─────► worker: runSettle ──► capture = worker is paid
Milestone cancelled ──────► worker: runVoid ────► reservation released
Anything uncertain ───────► worker: runReconcile / webhooks ──► GET the real status
```

- One PayPal order **per milestone** (demo: M1 $40, M2 $110, M3 $150).
- UI label for a funded milestone: **"Authorized, awaiting capture"**. It's a reservation, not a deposit or escrow.
- PayPal takes its fee from the worker at capture ($40.00 → $1.66 fee → **$38.34 net**). Show the worker the net amount.
- Money is always **integer cents**: `{ currency: "USD", amountMinor: 4000 }`.
- Amounts and payee come from the **frozen agreement on the server**, never from the browser or the AI.

## 2. What you import

| Import | What it is |
| --- | --- |
| `@multivisons/payments/paypal` | `PayPalGateway`, `payPalConfigFromEnv()`: the real gateway (server only, needs the secret) |
| `@multivisons/payments/mock` | `MockPaymentGateway`: no PayPal, IDs start `MOCK-`, `isMock = true` → **show a "Mock payments" badge** |
| `@multivisons/payments/gateway-types` | All types (`FrozenMilestoneFunding`, `PaymentObservation`, ...) |
| `@multivisons/payments/webhooks` | `receivePayPalWebhook()`, `WebhookInbox` port |
| `apps/worker/src/payments/payment-jobs.ts` | `runSettle`, `runVoid`, `runReconcile`, `runWebhookEvent`, `PaymentOperationStore` port |

Pick the gateway once, on the server:

```ts
import { PayPalGateway, payPalConfigFromEnv } from "@multivisons/payments/paypal";
import { MockPaymentGateway } from "@multivisons/payments/mock";

export const gateway = process.env.PAYMENTS_MODE === "mock"
  ? new MockPaymentGateway({ scenario: "happy" })
  : new PayPalGateway({ ...payPalConfigFromEnv(), capabilitiesVerifiedAt: "2026-11-03" });
```

> Note: `gateway-types.ts` is a **proposal** from ARCHITECTURE.md section 11 (7 methods). The old 4-method interface in `src/index.ts` is still there. Once you OK the new one, Koe replaces the old one. If any of these types should live in `packages/contracts` instead, say which.

## 3. What to wire, route by route

Every status is one of `PENDING | CONFIRMED | FAILED | UNKNOWN`. **UNKNOWN is not FAILED**: it means "we don't know yet". Show "Processing" and let the worker reconcile. Never retry by creating a new payment.

### `POST /api/agreements/{id}/funding/orders` (client funds a milestone)
```ts
const action = await gateway.createFundingOrder({
  agreementId, agreementVersion, milestoneId, milestoneTitle,
  amount,                                   // from the frozen agreement, cents
  idempotencyKey: `${agreementId}/v${agreementVersion}/${milestoneId}/fund/v1`,
  returnUrl: `${APP_URL}/funding/return`,   // PayPal sends the browser back here with ?token=<orderId>
  cancelUrl: `${APP_URL}/funding/cancel`,
});
// store action.orderId on the milestone, then send the browser to action.approveUrl
```

### `POST /api/funding/{id}/confirm` (the return page calls this)
```ts
const f = await gateway.confirmFunding({
  milestoneId, orderId, expectedAmount: amount,
  idempotencyKey: `${agreementId}/v${agreementVersion}/${milestoneId}/authorize/v1`,
});
// CONFIRMED → store f.authorizationId + f.authorizationExpiresAt, show "Authorized, awaiting capture"
// PENDING with reasonCode ORDER_NOT_APPROVED → buyer didn't finish; show "Funding not completed"
// UNKNOWN → show "Processing", call again later (same key is safe)
```

### `POST /api/submissions/{id}/review` (client approves work)
**Don't call PayPal in this request.** In one short DB transaction: insert the approval + a payment operation (kind `SETTLE`) + an outbox row. Return `202`. The worker does the capture.

Operation idempotency key: `${agreementId}/v${version}/${milestoneId}/${submissionId}/settle/v1` with a **unique constraint**.

### Cancellation of an unused milestone
Same pattern: insert an operation of kind `VOID` + outbox row. The worker runs `runVoid`.

### `GET /api/operations/{id}`
Return the operation's `state` and `providerReference` (the capture ID is the payment receipt).

### `POST /api/webhooks/paypal`
```ts
export async function POST(req: Request) {
  const rawBody = await req.text();                              // raw text, NOT req.json()
  const headers = Object.fromEntries(req.headers.entries());
  const r = await receivePayPalWebhook({ headers, rawBody }, { gateway, inbox });
  return new Response(null, { status: r.httpStatus });
}
```
Then have the worker run `runWebhookEvent(store, gateway, storedEvent)` for each new inbox row.

## 4. Worker

```ts
// for each outbox message:
if (msg.kind === "SETTLE") await runSettle(store, gateway, msg.operationId);
if (msg.kind === "VOID")   await runVoid(store, gateway, msg.operationId);
// every ~5 minutes (and on a "refresh" click):
await runReconcile(store, gateway);
```

The jobs claim → call PayPal → record, with **no DB transaction held open across the PayPal call**.

## 5. Two storage ports you implement (in `packages/data`, Postgres)

There are in-memory versions to copy the behaviour from: `InMemoryPaymentOperationStore` (`apps/worker/src/payments/payment-jobs.ts`) and `InMemoryWebhookInbox` (`src/webhooks.ts`).

**`PaymentOperationStore`**
- `get(id)`
- `claim(id, now)`: atomically `QUEUED → IN_FLIGHT`, `attempts + 1`; return `null` if it isn't QUEUED (`UPDATE ... WHERE state = 'QUEUED' RETURNING *`)
- `record(id, observation, nextState)`: save the result. **Never overwrite a `CONFIRMED` row.** For SETTLE, keep the capture ID in `provider_reference` (not the authorization ID).
- `listNeedingReconcile(olderThan)`: `state IN ('PENDING','UNKNOWN')` or `IN_FLIGHT` older than the cutoff
- `findByAuthorizationId(authId)`

Suggested table:
```sql
create table payment_operations (
  id text primary key,
  kind text not null check (kind in ('SETTLE','VOID')),
  agreement_id text not null,
  milestone_id text not null,
  submission_id text,
  authorization_id text not null,
  amount_minor integer not null check (amount_minor > 0),
  currency text not null default 'USD',
  idempotency_key text not null unique,
  state text not null default 'QUEUED',
  attempts integer not null default 0,
  provider_reference text,
  last_reason_code text,
  updated_at timestamptz not null default now()
);
create index on payment_operations (authorization_id);
```

**`WebhookInbox`**: `insertIfNew(event)` returns `false` on duplicate:
```sql
create table paypal_webhook_events (
  event_id text primary key,          -- the uniqueness is the whole point
  event_type text not null,
  resource_id text not null,
  authorization_id text,
  order_id text,
  raw_body text not null,
  received_at timestamptz not null,
  processed_at timestamptz
);
-- insert ... on conflict (event_id) do nothing; return rowCount = 1
```

Also store per milestone: `paypal_order_id`, `authorization_id`, `authorization_expires_at`.

## 6. Environment

`.env` (never commit it; `.env.example` lists the keys):
```
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_API_BASE=https://api-m.sandbox.paypal.com
PAYPAL_WEBHOOK_ID=          # Koe sets this once staging exists
```
Koe has the sandbox keys and will share them privately (not in git, not in group chat).

**Webhooks need a stable public URL.** When staging is up, tell Koe the URL. He runs `npm run paypal:webhook -- register https://<staging>` and gives you the `PAYPAL_WEBHOOK_ID`.

## 7. Test it yourself

```
npm test --workspace @multivisons/payments   # 21 tests, no network
npm test --workspace @multivisons/worker     # 9 tests, no network
```

Fixtures for every UI state are in `fixtures/payments/` (pending, authorized, processing, unknown, paid, voided).

Mock scenarios for the UI: `new MockPaymentGateway({ scenario })` with `happy`, `capture_pending`, `capture_denied`, `lost_response` or `not_approved`.

## 8. Evidence and details

- `docs/payment-capabilities.md`: real sandbox IDs for authorize, capture, void and webhooks.
- `docs/payment-sandbox-setup.md`, `docs/payment-webhooks.md`: how to reproduce.
- Known limits: authorizations are honoured for 3 days (valid 29), and the demo fits inside that, so there's no reauthorization. Refunds aren't built.

// packages/payments/src/paypal-gateway.ts
//
// Real PaymentGateway for mode AUTHORIZED_THEN_CAPTURED, using the PayPal REST API
// directly with fetch (Orders v2 + Payments v2). Server-side only: it needs the
// client secret. The AI layer never gets an instance of this class.
//
// Rules this class enforces:
//  - Every POST carries the caller's stable idempotency key as PayPal-Request-Id.
//  - A network error or HTTP 5xx returns status UNKNOWN (never FAILED): the caller
//    must reconcile() with a GET before deciding anything.
//  - Amounts are integer cents in, PayPal decimal strings out (and back).
//  - settle() captures exactly the frozen amount, refuses anything else, and
//    re-checks the authorization's amount with PayPal before capturing.

import type {
  AuthorizedCancellationOperation,
  AuthorizedPaymentOperation,
  CheckoutAction,
  ExistingOrderReference,
  ExistingProviderOperation,
  FrozenMilestoneFunding,
  FundingObservation,
  OriginalWebhookRequest,
  PaymentObservation,
  ProposedPaymentGateway,
  VerifiedCapabilities,
  VerifiedWebhookResult,
} from "./gateway-types";

type Money = FrozenMilestoneFunding["amount"];
type Status = PaymentObservation["status"];

export type PayPalGatewayConfig = Readonly<{
  clientId: string;
  clientSecret: string;
  apiBase?: string; // default: sandbox
  webhookId?: string; // needed only for verifyWebhook()
  capabilitiesVerifiedAt?: string | null; // from docs/payment-capabilities.md
  fetch?: typeof fetch; // injectable for tests
  now?: () => Date;
}>;

export const PAYPAL_SANDBOX_API = "https://api-m.sandbox.paypal.com";

/** Read config from process.env (PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_API_BASE, PAYPAL_WEBHOOK_ID). */
export function payPalConfigFromEnv(env: Record<string, string | undefined> = process.env): PayPalGatewayConfig {
  const clientId = env.PAYPAL_CLIENT_ID;
  const clientSecret = env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set (see .env.example)");
  return { clientId, clientSecret, apiBase: env.PAYPAL_API_BASE || PAYPAL_SANDBOX_API, webhookId: env.PAYPAL_WEBHOOK_ID || undefined };
}

type CallResult =
  | { kind: "ok"; status: number; body: any }
  | { kind: "client_error"; status: number; issue: string; debugId: string; body: any }
  | { kind: "unknown"; reason: string };

export class PayPalGateway implements ProposedPaymentGateway {
  readonly isMock = false;
  private readonly apiBase: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;
  private token?: { value: string; expiresAt: number };
  private readonly config: PayPalGatewayConfig;

  constructor(config: PayPalGatewayConfig) {
    this.config = config;
    this.apiBase = (config.apiBase ?? PAYPAL_SANDBOX_API).replace(/\/$/, "");
    this.fetchFn = config.fetch ?? fetch;
    this.now = config.now ?? (() => new Date());
  }

  async capabilities(): Promise<VerifiedCapabilities> {
    const verified = this.config.capabilitiesVerifiedAt ?? null;
    return {
      mode: "AUTHORIZED_THEN_CAPTURED",
      environment: "sandbox",
      verifiedAt: verified,
      canAuthorize: verified !== null,
      canCapture: verified !== null,
      canVoid: verified !== null,
      canReauthorize: false,
      canRefund: false,
      webhooksVerified: false,
      fundedLabel: "Authorized, awaiting capture",
    };
  }

  async createFundingOrder(input: FrozenMilestoneFunding): Promise<CheckoutAction> {
    const value = toPayPalValue(input.amount);
    const r = await this.call("POST", "/v2/checkout/orders", {
      requestId: input.idempotencyKey,
      body: {
        intent: "AUTHORIZE",
        purchase_units: [
          {
            reference_id: input.milestoneId,
            custom_id: `${input.agreementId}/v${input.agreementVersion}/${input.milestoneId}`,
            description: truncate(`Milestone: ${input.milestoneTitle}`, 127),
            amount: { currency_code: input.amount.currency, value },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: input.returnUrl,
              cancel_url: input.cancelUrl,
              shipping_preference: "NO_SHIPPING",
              user_action: "CONTINUE",
            },
          },
        },
      },
    });
    if (r.kind !== "ok") {
      // No approval link to give the browser; the route should show "try again".
      return { status: r.kind === "unknown" ? "UNKNOWN" : "FAILED", orderId: "", approveUrl: "" };
    }
    const link = (r.body.links ?? []).find((l: any) => l.rel === "payer-action" || l.rel === "approve");
    if (!link) return { status: "FAILED", orderId: r.body.id ?? "", approveUrl: "" };
    return { status: "PENDING", orderId: r.body.id, approveUrl: link.href };
  }

  async confirmFunding(input: ExistingOrderReference): Promise<FundingObservation> {
    // Check the order first: right amount, approved by the buyer, not already authorized.
    const got = await this.call("GET", `/v2/checkout/orders/${enc(input.orderId)}`);
    if (got.kind === "unknown") return this.unknown(got.reason);
    if (got.kind === "client_error") return this.failed(got.issue, input.orderId);

    const order = got.body;
    const unit = order.purchase_units?.[0];
    const orderAmount = fromPayPalAmount(unit?.amount);
    if (!orderAmount || !sameMoney(orderAmount, input.expectedAmount)) return this.failed("AMOUNT_MISMATCH", order.id);

    const existing = unit?.payments?.authorizations?.[0];
    if (existing) return this.authObservation(existing); // already authorized earlier: report it, don't redo it
    if (order.status !== "APPROVED") {
      return { status: "PENDING", providerReference: order.id, providerStatus: order.status, reasonCode: "ORDER_NOT_APPROVED", observedAt: this.stamp() };
    }

    const r = await this.call("POST", `/v2/checkout/orders/${enc(input.orderId)}/authorize`, { requestId: input.idempotencyKey, body: {} });
    if (r.kind === "unknown") return this.unknown(r.reason, input.orderId);
    if (r.kind === "client_error") return this.failed(r.issue, input.orderId);
    const auth = r.body.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (!auth) return this.unknown("AUTHORIZATION_MISSING_IN_RESPONSE", input.orderId);
    return this.authObservation(auth);
  }

  async settle(input: AuthorizedPaymentOperation): Promise<PaymentObservation> {
    // Revalidate with PayPal: the authorization must exist, be capturable and match the frozen amount exactly.
    const got = await this.call("GET", `/v2/payments/authorizations/${enc(input.authorizationId)}`);
    if (got.kind === "unknown") return this.unknown(got.reason, input.authorizationId);
    if (got.kind === "client_error") return this.failed(got.issue, input.authorizationId);
    const auth = got.body;
    const authAmount = fromPayPalAmount(auth.amount);
    if (!authAmount || !sameMoney(authAmount, input.amount)) return this.failed("AMOUNT_MISMATCH", auth.id);

    if (auth.status === "CAPTURED") {
      // Already captured (e.g. previous attempt whose response was lost): report that capture, never capture again.
      return this.reconcile({ kind: "authorization", providerReference: auth.id });
    }
    if (auth.status !== "CREATED" && auth.status !== "PENDING") return this.failed(`AUTHORIZATION_${auth.status}`, auth.id);

    const r = await this.call("POST", `/v2/payments/authorizations/${enc(input.authorizationId)}/capture`, {
      requestId: input.idempotencyKey,
      body: {
        amount: { currency_code: input.amount.currency, value: toPayPalValue(input.amount) },
        final_capture: true,
        invoice_id: truncate(input.operationId, 127),
      },
    });
    if (r.kind === "unknown") return this.unknown(r.reason, input.authorizationId);
    if (r.kind === "client_error") return this.failed(r.issue, input.authorizationId);
    return this.captureObservation(r.body);
  }

  async cancelFunding(input: AuthorizedCancellationOperation): Promise<PaymentObservation> {
    const r = await this.call("POST", `/v2/payments/authorizations/${enc(input.authorizationId)}/void`, { requestId: input.idempotencyKey });
    if (r.kind === "unknown") return this.unknown(r.reason, input.authorizationId);
    if (r.kind === "client_error") {
      // Voiding twice: PayPal answers with an error, but the end state is what we wanted.
      if (r.issue === "AUTHORIZATION_ALREADY_VOIDED" || r.issue === "PREVIOUSLY_VOIDED") {
        return { status: "CONFIRMED", providerReference: input.authorizationId, providerStatus: "VOIDED", observedAt: this.stamp() };
      }
      return this.failed(r.issue, input.authorizationId);
    }
    // 204 has no body; 200 (Prefer: return=representation) has the authorization.
    return { status: "CONFIRMED", providerReference: input.authorizationId, providerStatus: r.body?.status ?? "VOIDED", amount: fromPayPalAmount(r.body?.amount), observedAt: this.stamp() };
  }

  async reconcile(input: ExistingProviderOperation): Promise<PaymentObservation> {
    const path =
      input.kind === "order" ? `/v2/checkout/orders/${enc(input.providerReference)}` :
      input.kind === "authorization" ? `/v2/payments/authorizations/${enc(input.providerReference)}` :
      `/v2/payments/captures/${enc(input.providerReference)}`;
    const r = await this.call("GET", path);
    if (r.kind === "unknown") return this.unknown(r.reason, input.providerReference);
    if (r.kind === "client_error") return this.failed(r.issue, input.providerReference);
    const body = r.body;

    if (input.kind === "capture") return this.captureObservation(body);
    if (input.kind === "order") {
      return { status: body.status === "COMPLETED" ? "CONFIRMED" : body.status === "VOIDED" ? "FAILED" : "PENDING", providerReference: body.id, providerStatus: body.status, observedAt: this.stamp() };
    }
    // Authorization: if it was captured, the interesting object is the capture.
    // The authorization response does not carry the capture ID, so read it from the parent order.
    // (Assumes one capture per authorization, which is how settle() works.)
    if (body.status === "CAPTURED" || body.status === "PARTIALLY_CAPTURED") {
      const orderId = body.supplementary_data?.related_ids?.order_id;
      if (orderId) {
        const o = await this.call("GET", `/v2/checkout/orders/${enc(orderId)}`);
        if (o.kind === "unknown") return this.unknown(o.reason, body.id);
        const captureId = o.kind === "ok" ? o.body.purchase_units?.[0]?.payments?.captures?.[0]?.id : undefined;
        if (captureId) return this.reconcile({ kind: "capture", providerReference: captureId });
      }
      return { status: "CONFIRMED", providerReference: body.id, providerStatus: body.status, amount: fromPayPalAmount(body.amount), observedAt: this.stamp() };
    }
    return this.authObservation(body);
  }

  async verifyWebhook(input: OriginalWebhookRequest): Promise<VerifiedWebhookResult> {
    if (!this.config.webhookId) return { verified: false };
    const h = lowerKeys(input.headers);
    let event: any;
    try {
      event = JSON.parse(input.rawBody);
    } catch {
      return { verified: false };
    }
    const r = await this.call("POST", "/v1/notifications/verify-webhook-signature", {
      body: {
        auth_algo: h["paypal-auth-algo"],
        cert_url: h["paypal-cert-url"],
        transmission_id: h["paypal-transmission-id"],
        transmission_sig: h["paypal-transmission-sig"],
        transmission_time: h["paypal-transmission-time"],
        webhook_id: this.config.webhookId,
        webhook_event: event,
      },
    });
    if (r.kind !== "ok" || r.body.verification_status !== "SUCCESS") return { verified: false };
    return { verified: true, eventId: event.id, eventType: event.event_type, resourceId: event.resource?.id };
  }

  // ---------- HTTP ----------

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const res = await this.fetchFn(`${this.apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error(`PayPal OAuth failed with HTTP ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return this.token.value;
  }

  private async call(method: "GET" | "POST", path: string, opts: { body?: unknown; requestId?: string } = {}): Promise<CallResult> {
    if (method === "POST" && path.startsWith("/v2/") && !opts.requestId) throw new Error(`POST ${path} needs an idempotency key`);
    let token: string;
    try {
      token = await this.accessToken();
    } catch (err) {
      // Nothing was sent to the payment endpoint yet, but treat as UNKNOWN so callers retry via reconcile.
      return { kind: "unknown", reason: `AUTH_UNAVAILABLE: ${(err as Error).message}` };
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
    if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;

    let res: Response;
    try {
      res = await this.fetchFn(`${this.apiBase}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    } catch (err) {
      return { kind: "unknown", reason: `NETWORK_ERROR: ${(err as Error).message}` };
    }
    const debugId = res.headers.get("paypal-debug-id") ?? "";
    const text = await res.text().catch(() => "");
    let body: any = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    if (res.status >= 500 || res.status === 408 || res.status === 429) return { kind: "unknown", reason: `HTTP_${res.status} ${debugId}`.trim() };
    if (!res.ok) {
      const issue = body?.details?.[0]?.issue ?? body?.name ?? `HTTP_${res.status}`;
      return { kind: "client_error", status: res.status, issue, debugId, body };
    }
    return { kind: "ok", status: res.status, body };
  }

  // ---------- mapping ----------

  private authObservation(auth: any): FundingObservation {
    const s: Status = auth.status === "CREATED" || auth.status === "CAPTURED" || auth.status === "PARTIALLY_CAPTURED" ? "CONFIRMED" : auth.status === "PENDING" ? "PENDING" : "FAILED";
    return {
      status: s,
      providerReference: auth.id,
      providerStatus: auth.status,
      amount: fromPayPalAmount(auth.amount),
      authorizationId: auth.id,
      authorizationExpiresAt: auth.expiration_time,
      reasonCode: s === "FAILED" ? `AUTHORIZATION_${auth.status}` : undefined,
      observedAt: this.stamp(),
    };
  }

  private captureObservation(cap: any): PaymentObservation {
    const s: Status = cap.status === "COMPLETED" ? "CONFIRMED" : cap.status === "PENDING" ? "PENDING" : "FAILED";
    return {
      status: s,
      providerReference: cap.id,
      providerStatus: cap.status,
      amount: fromPayPalAmount(cap.amount),
      reasonCode: s === "PENDING" ? cap.status_details?.reason : s === "FAILED" ? `CAPTURE_${cap.status}` : undefined,
      observedAt: this.stamp(),
    };
  }

  private unknown(reason: string, providerReference?: string): PaymentObservation {
    return { status: "UNKNOWN", reasonCode: reason, providerReference, observedAt: this.stamp() };
  }

  private failed(reasonCode: string, providerReference?: string): PaymentObservation {
    return { status: "FAILED", reasonCode, providerReference, observedAt: this.stamp() };
  }

  private stamp(): string {
    return this.now().toISOString();
  }
}

// ---------- money helpers (exported for tests) ----------

export function toPayPalValue(m: Money): string {
  if (m.currency !== "USD" || !Number.isInteger(m.amountMinor) || m.amountMinor <= 0) {
    throw new Error(`Invalid money ${JSON.stringify(m)}: expected positive integer USD cents`);
  }
  return `${Math.floor(m.amountMinor / 100)}.${String(m.amountMinor % 100).padStart(2, "0")}`;
}

export function fromPayPalAmount(a: { currency_code?: string; value?: string } | undefined): Money | undefined {
  if (!a || a.currency_code !== "USD" || typeof a.value !== "string") return undefined;
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(a.value);
  if (!m) return undefined;
  return { currency: "USD", amountMinor: Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0")) };
}

function sameMoney(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amountMinor === b.amountMinor;
}

function enc(id: string): string {
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error(`Unexpected PayPal ID: ${id}`);
  return id;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n);
}

function lowerKeys(h: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
}

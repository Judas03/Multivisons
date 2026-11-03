// packages/payments/src/mock-gateway.ts
//
// In-memory PaymentGateway for local UI development. It moves NO money and talks
// to NO PayPal server. Every ID starts with "MOCK-" and `isMock` is true, so the UI
// can show a visible "Mock payments" badge (required by ARCHITECTURE.md section 11).
//
// Usage (server code only):
//   import { MockPaymentGateway } from "@multivisons/payments/mock";
//   const gateway = new MockPaymentGateway({ scenario: "happy" });
//
// Scenarios let the UI exercise every state without PayPal:
//   happy           everything succeeds
//   capture_pending capture returns PENDING (PayPal sometimes holds captures)
//   capture_denied  capture returns FAILED
//   lost_response   first settle() returns UNKNOWN; reconcile() then reports CONFIRMED
//   not_approved    confirmFunding() fails as if the buyer never approved

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

export type MockScenario = "happy" | "capture_pending" | "capture_denied" | "lost_response" | "not_approved";

type Money = FrozenMilestoneFunding["amount"];
type MockObject = { kind: "order" | "authorization" | "capture"; id: string; providerStatus: string; amount: Money; parentId?: string };

const AUTH_VALID_DAYS = 29;

export class MockPaymentGateway implements ProposedPaymentGateway {
  readonly isMock = true;
  private readonly scenario: MockScenario;
  private readonly now: () => Date;
  private seq = 0;
  private readonly objects = new Map<string, MockObject>();
  /** idempotencyKey -> first result, so a retried call returns the same answer (like PayPal-Request-Id). */
  private readonly replies = new Map<string, unknown>();
  private lostOnce = false;

  constructor(opts: { scenario?: MockScenario; now?: () => Date } = {}) {
    this.scenario = opts.scenario ?? "happy";
    this.now = opts.now ?? (() => new Date());
  }

  async capabilities(): Promise<VerifiedCapabilities> {
    return {
      mode: "AUTHORIZED_THEN_CAPTURED",
      environment: "mock",
      verifiedAt: null,
      canAuthorize: true,
      canCapture: true,
      canVoid: true,
      canReauthorize: false,
      canRefund: false,
      webhooksVerified: false,
      fundedLabel: "Authorized, awaiting capture",
    };
  }

  async createFundingOrder(input: FrozenMilestoneFunding): Promise<CheckoutAction> {
    assertCents(input.amount);
    return this.once(input.idempotencyKey, () => {
      const id = this.newId("ORDER");
      this.objects.set(id, { kind: "order", id, providerStatus: "PAYER_ACTION_REQUIRED", amount: input.amount });
      // No PayPal page in mock mode: "approving" sends the browser straight back to the app.
      const url = new URL(input.returnUrl);
      url.searchParams.set("token", id);
      url.searchParams.set("mock", "1");
      return { status: "PENDING", orderId: id, approveUrl: url.toString() } satisfies CheckoutAction;
    });
  }

  async confirmFunding(input: ExistingOrderReference): Promise<FundingObservation> {
    return this.once(input.idempotencyKey, () => {
      const order = this.objects.get(input.orderId);
      if (!order || order.kind !== "order") return this.failed("ORDER_NOT_FOUND");
      if (!sameMoney(order.amount, input.expectedAmount)) return this.failed("AMOUNT_MISMATCH");
      if (this.scenario === "not_approved") return this.failed("ORDER_NOT_APPROVED", order.id);

      const authId = this.newId("AUTH");
      const expires = new Date(this.now().getTime() + AUTH_VALID_DAYS * 86_400_000).toISOString();
      order.providerStatus = "COMPLETED";
      this.objects.set(authId, { kind: "authorization", id: authId, providerStatus: "CREATED", amount: order.amount, parentId: order.id });
      return {
        status: "CONFIRMED",
        providerReference: authId,
        providerStatus: "CREATED",
        amount: order.amount,
        authorizationId: authId,
        authorizationExpiresAt: expires,
        observedAt: this.stamp(),
      } satisfies FundingObservation;
    });
  }

  async settle(input: AuthorizedPaymentOperation): Promise<PaymentObservation> {
    assertCents(input.amount);
    // Simulate a lost response: PayPal DID capture, but we never heard back.
    if (this.scenario === "lost_response" && !this.lostOnce) {
      this.lostOnce = true;
      this.doCapture(input); // the money moved...
      return { status: "UNKNOWN", reasonCode: "NETWORK_ERROR", observedAt: this.stamp() }; // ...but we don't know
    }
    return this.once(input.idempotencyKey, () => this.doCapture(input));
  }

  async cancelFunding(input: AuthorizedCancellationOperation): Promise<PaymentObservation> {
    return this.once(input.idempotencyKey, () => {
      const auth = this.objects.get(input.authorizationId);
      if (!auth || auth.kind !== "authorization") return this.failed("AUTHORIZATION_NOT_FOUND");
      if (auth.providerStatus !== "CREATED") return this.failed(`AUTHORIZATION_${auth.providerStatus}`, auth.id);
      auth.providerStatus = "VOIDED";
      return { status: "CONFIRMED", providerReference: auth.id, providerStatus: "VOIDED", amount: auth.amount, observedAt: this.stamp() } satisfies PaymentObservation;
    });
  }

  async reconcile(input: ExistingProviderOperation): Promise<PaymentObservation> {
    // For an authorization, report its capture if one exists (that is what the worker needs after UNKNOWN).
    let obj = this.objects.get(input.providerReference);
    if (obj?.kind === "authorization" && input.kind === "authorization") {
      const capture = [...this.objects.values()].find((o) => o.kind === "capture" && o.parentId === obj!.id);
      if (capture) obj = capture;
    }
    if (!obj) return this.failed("NOT_FOUND");
    return { status: toStatus(obj), providerReference: obj.id, providerStatus: obj.providerStatus, amount: obj.amount, observedAt: this.stamp() };
  }

  async verifyWebhook(_input: OriginalWebhookRequest): Promise<VerifiedWebhookResult> {
    // Mock webhooks are never trusted as proof of money movement.
    return { verified: false };
  }

  // ---------- internals ----------

  private doCapture(input: AuthorizedPaymentOperation): PaymentObservation {
    const auth = this.objects.get(input.authorizationId);
    if (!auth || auth.kind !== "authorization") return this.failed("AUTHORIZATION_NOT_FOUND");
    if (!sameMoney(auth.amount, input.amount)) return this.failed("AMOUNT_EXCEEDS_AUTHORIZATION", auth.id);
    if (auth.providerStatus !== "CREATED") return this.failed(`AUTHORIZATION_${auth.providerStatus}`, auth.id);

    const capId = this.newId("CAPTURE");
    const capStatus = this.scenario === "capture_pending" ? "PENDING" : this.scenario === "capture_denied" ? "DECLINED" : "COMPLETED";
    auth.providerStatus = capStatus === "DECLINED" ? "DENIED" : "CAPTURED";
    this.objects.set(capId, { kind: "capture", id: capId, providerStatus: capStatus, amount: input.amount, parentId: auth.id });
    const obj = this.objects.get(capId)!;
    return {
      status: toStatus(obj),
      providerReference: capId,
      providerStatus: capStatus,
      amount: input.amount,
      reasonCode: capStatus === "DECLINED" ? "CAPTURE_DECLINED" : undefined,
      observedAt: this.stamp(),
    };
  }

  private once<T>(key: string, fn: () => T): T {
    if (!key) throw new Error("idempotencyKey is required");
    if (this.replies.has(key)) return this.replies.get(key) as T;
    const result = fn();
    this.replies.set(key, result);
    return result;
  }

  private newId(kind: string): string {
    this.seq += 1;
    return `MOCK-${kind}-${String(this.seq).padStart(4, "0")}`;
  }

  private stamp(): string {
    return this.now().toISOString();
  }

  private failed(reasonCode: string, providerReference?: string): PaymentObservation {
    return { status: "FAILED", reasonCode, providerReference, observedAt: this.stamp() };
  }
}

function toStatus(obj: MockObject): PaymentObservation["status"] {
  if (obj.kind === "capture") {
    if (obj.providerStatus === "COMPLETED") return "CONFIRMED";
    if (obj.providerStatus === "PENDING") return "PENDING";
    return "FAILED";
  }
  if (obj.kind === "authorization") return obj.providerStatus === "DENIED" ? "FAILED" : "CONFIRMED";
  return obj.providerStatus === "COMPLETED" ? "CONFIRMED" : "PENDING";
}

function assertCents(m: Money): void {
  if (m.currency !== "USD" || !Number.isInteger(m.amountMinor) || m.amountMinor <= 0) {
    throw new Error(`Invalid money: ${JSON.stringify(m)} (expected positive integer USD cents)`);
  }
}

function sameMoney(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amountMinor === b.amountMinor;
}

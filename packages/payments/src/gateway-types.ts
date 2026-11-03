// packages/payments/src/gateway-types.ts
//
// PROPOSED PaymentGateway shape for mode AUTHORIZED_THEN_CAPTURED, following
// ARCHITECTURE.md section 11. Not adopted yet: the full-stack owner signs off on
// shared shapes. Until then the 4-method interface in ./index.ts stays as it is.
//
// Only types live here, so importing this file has no runtime cost.

import type { Money, PaymentMode, ProviderOperationStatus } from "@multivisons/contracts";

/** What the sandbox capability gate proved. Shown in the UI and the demo. */
export type VerifiedCapabilities = Readonly<{
  mode: PaymentMode; // "AUTHORIZED_THEN_CAPTURED"
  environment: "sandbox" | "mock";
  verifiedAt: string | null; // ISO time of the last successful capability run
  canAuthorize: boolean;
  canCapture: boolean;
  canVoid: boolean;
  canReauthorize: boolean;
  canRefund: boolean;
  webhooksVerified: boolean;
  /** Honest label for the funded-but-not-captured state. */
  fundedLabel: "Authorized, awaiting capture";
}>;

/** Built by server code from the frozen, accepted agreement. Never from the browser. */
export type FrozenMilestoneFunding = Readonly<{
  agreementId: string;
  agreementVersion: number;
  milestoneId: string;
  milestoneTitle: string;
  amount: Money; // integer cents
  idempotencyKey: string; // e.g. "agr_1/v3/m1/fund/v1"
  returnUrl: string; // where PayPal sends the buyer after approving
  cancelUrl: string;
}>;

export type CheckoutAction = Readonly<{
  status: ProviderOperationStatus; // PENDING until the buyer approves
  orderId: string;
  approveUrl: string; // redirect the client's browser here
}>;

/** Called after the buyer comes back from PayPal: authorize the approved order. */
export type ExistingOrderReference = Readonly<{
  milestoneId: string;
  orderId: string;
  expectedAmount: Money;
  idempotencyKey: string;
}>;

export type PaymentObservation = Readonly<{
  status: ProviderOperationStatus;
  providerReference?: string; // PayPal ID of the object this observation is about
  providerStatus?: string; // raw PayPal status, e.g. CREATED, CAPTURED, VOIDED, COMPLETED, PENDING
  amount?: Money;
  reasonCode?: string; // e.g. ORDER_NOT_APPROVED, NETWORK_ERROR
  observedAt: string;
}>;

export type FundingObservation = PaymentObservation &
  Readonly<{
    authorizationId?: string;
    authorizationExpiresAt?: string;
  }>;

/** Created by trusted server policy code after the client approved a submission. */
export type AuthorizedPaymentOperation = Readonly<{
  operationId: string;
  agreementId: string;
  milestoneId: string;
  submissionId: string;
  authorizationId: string;
  amount: Money; // must equal the milestone's frozen amount
  idempotencyKey: string; // "agreement-version/milestone/submission/settle/v1"
}>;

export type AuthorizedCancellationOperation = Readonly<{
  operationId: string;
  milestoneId: string;
  authorizationId: string;
  idempotencyKey: string;
}>;

export type ExistingProviderOperation = Readonly<{
  kind: "order" | "authorization" | "capture";
  providerReference: string;
}>;

export type OriginalWebhookRequest = Readonly<{
  headers: Readonly<Record<string, string>>;
  rawBody: string; // exact bytes as received, needed for verification
}>;

export type VerifiedWebhookResult = Readonly<{
  verified: boolean;
  eventId?: string;
  eventType?: string; // e.g. PAYMENT.CAPTURE.COMPLETED
  resourceId?: string;
}>;

export interface ProposedPaymentGateway {
  /** True for the mock. The UI must show a visible "Mock payments" badge when set. */
  readonly isMock: boolean;
  capabilities(): Promise<VerifiedCapabilities>;
  createFundingOrder(input: FrozenMilestoneFunding): Promise<CheckoutAction>;
  confirmFunding(input: ExistingOrderReference): Promise<FundingObservation>;
  settle(input: AuthorizedPaymentOperation): Promise<PaymentObservation>;
  cancelFunding(input: AuthorizedCancellationOperation): Promise<PaymentObservation>;
  reconcile(input: ExistingProviderOperation): Promise<PaymentObservation>;
  verifyWebhook(input: OriginalWebhookRequest): Promise<VerifiedWebhookResult>;
}

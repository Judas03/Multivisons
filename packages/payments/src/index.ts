import type { Money, PaymentMode, ProviderOperationStatus } from "@multivisons/contracts";

export type PaymentOperation = Readonly<{
  operationId: string;
  agreementId: string;
  milestoneId: string;
  amount: Money;
  mode: PaymentMode;
  idempotencyKey: string;
}>;

export type PaymentObservation = Readonly<{
  status: ProviderOperationStatus;
  providerReference?: string;
  reasonCode?: string;
}>;

export interface PaymentGateway {
  createFunding(operation: PaymentOperation): Promise<PaymentObservation>;
  settleApprovedMilestone(operation: PaymentOperation): Promise<PaymentObservation>;
  cleanupUnspentFunding(operation: PaymentOperation): Promise<PaymentObservation>;
  getOperationStatus(operation: PaymentOperation): Promise<PaymentObservation>;
}

// Provider implementation is intentionally not present until the sandbox capability gate passes.

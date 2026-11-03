export type CurrencyCode = "USD";

export type Money = Readonly<{
  currency: CurrencyCode;
  amountMinor: number;
}>;

export type PaymentMode = "CAPTURED_DELAYED_DISBURSEMENT" | "AUTHORIZED_THEN_CAPTURED";

export type AgreementStatus =
  | "DRAFT"
  | "NEGOTIATING"
  | "READY_FOR_ACCEPTANCE"
  | "ACCEPTED"
  | "FUNDING"
  | "ACTIVE"
  | "PAUSED"
  | "CANCELLING"
  | "CANCELLED"
  | "COMPLETED";

export type ProviderOperationStatus = "PENDING" | "CONFIRMED" | "FAILED" | "UNKNOWN";

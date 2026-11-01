import type { AgreementStatus, Money } from "@multivisons/contracts";

export type Milestone = Readonly<{
  id: string;
  ordinal: number;
  title: string;
  amount: Money;
  status: "READY" | "IN_PROGRESS" | "SUBMITTED" | "APPROVED" | "SETTLED" | "BLOCKED";
}>;

export type AgreementSnapshot = Readonly<{
  id: string;
  version: number;
  status: AgreementStatus;
  clientId: string;
  workerId: string;
  milestones: readonly Milestone[];
}>;

export function assertDifferentParties(clientId: string, workerId: string): void {
  if (clientId === workerId) throw new Error("Client and worker must be different members.");
}

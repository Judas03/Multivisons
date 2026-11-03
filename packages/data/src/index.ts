export interface AgreementRepository<TAgreement> {
  getById(id: string): Promise<TAgreement | null>;
  saveSnapshot(snapshot: TAgreement): Promise<void>;
}

export interface OutboxRepository<TMessage> {
  enqueue(message: TMessage): Promise<void>;
  claimNext(workerId: string): Promise<TMessage | null>;
  markComplete(messageId: string): Promise<void>;
}

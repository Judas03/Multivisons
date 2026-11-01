export type AgentTask = "CLARIFY" | "DRAFT_AGREEMENT" | "ASSESS_SUBMISSION" | "SUMMARIZE_DISPUTE";

export type AgentResult<T> = Readonly<{
  value: T;
  sourceIds: readonly string[];
  limitations: readonly string[];
  requiresHumanReview: true;
}>;

export interface AgentService {
  run<TInput, TOutput>(task: AgentTask, input: TInput): Promise<AgentResult<TOutput>>;
}

// Deliberately no payment client, payment credential, or transaction tool is exposed here.

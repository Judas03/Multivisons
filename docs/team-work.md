# Team workstreams

Each workstream starts from `main` and owns its named package. Keep feature branches short and integrate daily against shared contracts.

| Branch | Owner | Main folders | Handoff |
| --- | --- | --- | --- |
| `work/ai-agent` | Judas | `packages/agent`, `prompts/`, `knowledge/`, `fixtures/agent/` | Validated draft and assessment outputs, blocking questions, source provenance, limitations |
| `work/payments` | Payment engineer | `packages/payments`, `apps/worker` payment handlers, `fixtures/payments/` | Mode decision, checkout action, verified provider status, receipts, permission evidence |
| `work/full-stack` | Full stack engineer | `apps/web`, `packages/contracts`, `packages/domain`, `packages/data` | Authorized snapshots and operations, working staging URL |

The full-stack owner coordinates shared contracts and migrations. No one silently edits another stream's owned schema or API shape. Integrate a vertical slice by day 3; feature additions stop if agreement → funding → submission → human approval → verified payment cannot be demonstrated.

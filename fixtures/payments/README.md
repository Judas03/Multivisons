# Payment fixtures

Use synthetic IDs and sandbox examples only. Never save client secrets, access tokens, live payment IDs, or real buyer data. Annotate whether each record is a fixture or a redacted sandbox observation.

## Files

All files here are synthetic mock data in the shapes of `packages/payments/src/gateway-types.ts` (proposed). The real gateway will return the same shapes.

| File | State | Suggested UI label |
| --- | --- | --- |
| `checkout-pending.json` | Order created, buyer not yet approved | Waiting for client to fund |
| `funding-authorized.json` | Buyer approved, authorization created | Authorized, awaiting capture |
| `settle-pending.json` | Capture sent, PayPal holding it | Processing |
| `settle-unknown.json` | Capture response lost, reconciling | Processing |
| `settle-confirmed.json` | Capture completed (settled) | Paid (show capture ID) |
| `cancel-voided.json` | Unused milestone voided | Cancelled, reservation released |

For live mock behaviour, use `new MockPaymentGateway({ scenario })` from `@multivisons/payments/mock`. Scenarios: `happy`, `capture_pending`, `capture_denied`, `lost_response`, `not_approved`.

# Payment capabilities (verified in sandbox)

Status: **verified in sandbox on 2026-11-03** (authorize, capture, void). Reproduce with [`payment-sandbox-setup.md`](payment-sandbox-setup.md).

Record sandbox IDs only. Never record a client secret, an access token or buyer personal data.

## Selected mode

`AUTHORIZED_THEN_CAPTURED` (authorize then capture). Each milestone is its own PayPal order with `intent: AUTHORIZE`. The milestone is captured in full when the client approves it, and an unused milestone's authorization is voided. The UI says "Authorized, awaiting capture". An authorization reserves money; it is not a deposit.

Rejected: delayed disbursement (needs PayPal partner approval).

## Environment

- Host: `https://api-m.sandbox.paypal.com`
- Date verified: 2026-11-03 (run `a107ca8e-4883-479c-967a-3a43328a93b1`, started 07:26:25 UTC)
- Sandbox Business (payee / worker) account: `sb-kdvpr53571041@business.example.com` (region SG)
- Sandbox Personal (payer / client) account: `sb-muyj4753693117@personal.example.com` (region US)
- Buyer funding source used: sandbox bank account (CREDIT UNION 1)

## Capability check run

Output of `npm run paypal:check -- finish`. Statuses were read back with GET after the calls.

| Order | Object | Sandbox ID | Status read back by GET |
| --- | --- | --- | --- |
| A (capture) | Order | `0MN69273EH8575307` | COMPLETED |
| A (capture) | Authorization | `2UJ38185YS264725R` | CAPTURED (expires 2026-12-02T07:33:53Z) |
| A (capture) | Capture | `2UW154673B305112R` | COMPLETED, gross 40.00, fee 1.66, net 38.34 |
| B (void) | Order | `6BN99716G8967003V` | COMPLETED |
| B (void) | Authorization | `1K327296R0055951P` | VOIDED (expires 2026-12-02T07:33:57Z) |

## Observations

- [x] Create order with `intent: AUTHORIZE` works (status `PAYER_ACTION_REQUIRED` until approved)
- [x] Buyer approval through the `payer-action` link (`/checkoutnow?token=...`) works
- [x] Authorize returns an authorization ID; `expiration_time` is **29 days** after authorization (2026-11-03 → 2026-12-02), matching the docs
- [x] Full capture of the authorization works; capture status `COMPLETED` immediately, even with an SG payee and USD order
- [x] Void of an unused authorization works; authorization reads back `VOIDED`
- [x] PayPal fee is taken from the payee at capture: $40.00 gross → $1.66 fee → $38.34 net. The UI should show the worker the **net** amount from `seller_receivable_breakdown`, not assume gross.
- [x] `PayPalGateway` smoke test (`npm run paypal:smoke`, 2026-11-03 13:39 UTC): order `2MH40615E74880717` → authorization `7US96246PA013552F` → capture `94E166757D389035B` COMPLETED. A second `settle()` with the same operation returned **the same capture** (no second payment), and `reconcile(authorization)` found that capture through the parent order.
- [ ] A forced replay of the same `PayPal-Request-Id` straight to the capture endpoint is not yet tested (the gateway checks the authorization first, so it never sends one)
- [ ] Business account dashboard sees only the captured amount (not checked yet)

## Known limitations

- An authorization is honored for 3 days and valid for up to 29 days. The demo finishes within the honor period, so reauthorization is out of scope.
- Webhooks: verified in sandbox on 2026-11-05 through a Cloudflare quick tunnel (webhook `0NB594620E297184H`, since replaced by each new tunnel). Order `4KY667183E6337630` → authorization `4FT12641YA475460C` → capture `3T1425681N552304E`. Events `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED` and `PAYMENT.CAPTURE.COMPLETED` arrived in about 20 s, all passed PayPal signature verification, and each was confirmed by GET. The smoke test in the same run passed again (second settle returned the same capture).
- The app needs a stable public URL (staging) for webhooks in the demo. A quick tunnel URL changes every run.

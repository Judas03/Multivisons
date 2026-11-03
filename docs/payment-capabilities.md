# Payment capabilities (verified in sandbox)

Status: **not yet verified.** Fill this in after following [`payment-sandbox-setup.md`](payment-sandbox-setup.md).

Record sandbox IDs only. Never record a client secret, an access token or buyer personal data.

## Selected mode

`AUTHORIZED_THEN_CAPTURED` (authorize then capture). Each milestone is its own PayPal order with `intent: AUTHORIZE`. The milestone is captured in full when the client approves it, and an unused milestone's authorization is voided. The UI says "Authorized, awaiting capture". An authorization reserves money; it is not a deposit.

Rejected: delayed disbursement (needs PayPal partner approval).

## Environment

- Host: `https://api-m.sandbox.paypal.com`
- Date verified:
- Sandbox Business (payee / worker) account: `sb-...@business.example.com`
- Sandbox Personal (payer / client) account: `sb-...@personal.example.com`

## Capability check run

Paste the table printed by `npm run paypal:check -- finish` here.

| Order | Object | Sandbox ID | Status read back by GET |
| --- | --- | --- | --- |
| | | | |

## Observations

- [ ] Create order with `intent: AUTHORIZE` works
- [ ] Buyer approval through the `payer-action` link works
- [ ] Authorize returns an authorization ID; expiration time observed:
- [ ] Full capture of the authorization works; capture status:
- [ ] Void of an unused authorization works
- [ ] Rerunning `finish` with the same `PayPal-Request-Id` makes no second payment
- [ ] Business account sees only the captured amount

## Known limitations

- An authorization is honored for 3 days and valid for up to 29 days. The demo finishes within the honor period, so reauthorization is out of scope.
- Webhooks are not yet configured (planned step 4).

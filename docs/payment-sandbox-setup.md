# PayPal sandbox setup and capability check

Owner: payments. Goal: prove on the real PayPal sandbox that payment mode `AUTHORIZED_THEN_CAPTURED` works (create, approve, authorize, capture, and void), then record the IDs in [`payment-capabilities.md`](payment-capabilities.md).

Time needed: about 30 minutes. Everything here is sandbox only. No real money moves.

## Part 1: PayPal developer account and sandbox app

1. Go to <https://developer.paypal.com> and click **Log in to Dashboard**. Use your normal PayPal account, or click **Sign up** to create one (a free Personal account is fine).
2. In the dashboard, make sure the toggle at the top says **Sandbox** (not Live).
3. Open **Apps & Credentials** and click **Create App**.
   - App name: `multivisons-sandbox`
   - Type: **Merchant**
   - Sandbox Business account: keep the default one PayPal offers (it looks like `sb-xxxx@business.example.com`). **This account is the worker who receives the money.**
   - Click **Create App**.
4. On the app page, copy the **Client ID** and click **Show** under **Secret key 1** to copy the secret. Keep both for Part 3. Never paste them into chat, code or a commit.
5. Still on the app page, scroll to **Features** and check that **Accept payments** is on. Save if you changed it.

## Part 2: sandbox test accounts

1. Open **Testing Tools → Sandbox Accounts** (the left menu).
2. You should already see two accounts: one **Business** and one **Personal**. PayPal creates them by default.
   - The **Business** one must be the same email your app uses (Part 1, step 3). That is the worker.
   - The **Personal** one is the client who pays.
   - If there is no Personal account, click **Create account**, choose **Personal**, country **United States**, then **Create**.
3. On the **Personal** account row, click **⋯ → View/Edit account**. Copy its **email** and **password** (generated). You type these into the PayPal login page when approving a payment. The account already has a sandbox balance.

## Part 3: get the code and your `.env`

You need Git and **Node 24** (`node -v` should print `v24.x`). If Node is older, install 24 from <https://nodejs.org> or run `nvm install 24 && nvm use 24`.

```bash
# 1. Get the repo (skip if you already have it)
git clone https://github.com/Judas03/Multivisons.git
cd Multivisons

# 2. Switch to your branch and bring it up to date with main
git fetch origin
git switch work/payments
git pull origin work/payments

# 3. Create your local secrets file from the template
cp .env.example .env
```

Open `.env` in your editor and fill in the two values from Part 1:

```
PAYPAL_CLIENT_ID=<your sandbox client id>
PAYPAL_CLIENT_SECRET=<your sandbox secret>
PAYPAL_API_BASE=https://api-m.sandbox.paypal.com
```

Check that git will not commit it: `git status` must **not** list `.env`. (It is in `.gitignore`.)

## Part 4: run the capability check

The script lives at `packages/payments/scripts/paypal-capability-check.ts` and needs no `npm install` (plain `fetch`, Node 24 runs TypeScript directly).

```bash
# Step 1: create two AUTHORIZE orders (A = $40 milestone M1, B = $110 milestone M2)
npm run paypal:check -- create
```

It prints two approval links. For **each** link:

1. Open it in a browser (a private window avoids clashing with your real PayPal login).
2. Log in with the **Personal** sandbox email and password from Part 2.
3. Click to approve / continue.
4. You land on an `example.com` page. That is expected, so close it.

```bash
# Step 2: authorize both, capture A, void B, then read every ID back with GET
npm run paypal:check -- finish
```

Expected end result (IDs will differ):

| Order | Object | Status |
| --- | --- | --- |
| A | Order | COMPLETED |
| A | Authorization | CAPTURED |
| A | Capture | COMPLETED (or PENDING, see below) |
| B | Order | COMPLETED |
| B | Authorization | VOIDED |

Copy the table the script prints into [`payment-capabilities.md`](payment-capabilities.md).

Then log in to <https://www.sandbox.paypal.com> as the **Business** account. You should see the $40.00 payment received, and no $110.00 payment.

`npm run paypal:check -- status` reads everything back again at any time and never moves money.

## If something goes wrong

| What you see | What it means / what to do |
| --- | --- |
| `Could not get an access token (HTTP 401)` | Wrong or Live credentials. Recopy the **Sandbox** client ID and secret. |
| `is not approved yet` | You did not finish approving that link. Open it again, approve, then rerun `finish`. |
| `Outcome UNKNOWN` | The network dropped or PayPal returned a 5xx error. **Do not run `create` again.** Run `status`, then rerun `finish`. It reuses the same `PayPal-Request-Id`, so it cannot capture twice. |
| Capture status `PENDING` | Sandbox sometimes holds a capture (for example, when the Business account has to accept the payment or the currency). Log in as the Business account and accept it, then run `status`. Record it in the doc either way. |
| `UNPROCESSABLE_ENTITY ... COMPLIANCE_VIOLATION` or `PAYEE_ACCOUNT_RESTRICTED` | A problem with the sandbox Business account. Create a fresh Business sandbox account, link it to the app, and run again. |

Things we have **not** verified yet and should note in the capabilities doc:

- How long PayPal keeps `PayPal-Request-Id` for authorize and capture calls (the docs say it is kept for a limited time).
- Whether the authorization's `expiration_time` matches the documented 29 days.

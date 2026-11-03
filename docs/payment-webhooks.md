# PayPal webhooks: sandbox test on Windows

Goal: prove that PayPal sends us events (authorization created, capture completed), that we can **verify** them, and that the worker then reads the real status with a GET. No Next.js needed yet.

You need **three Command Prompt windows**, all in your Multivisons folder (`cd %USERPROFILE%\Documents\Multivisons`), with the latest `work/payments` pulled (`git pull origin work/payments`).

## One-time: install the tunnel tool

PayPal can only send webhooks to a public `https://` address. A Cloudflare quick tunnel gives your laptop one for free, with no account needed.

```
winget install --id Cloudflare.cloudflared
```

Close and reopen Command Prompt afterwards. Check with `cloudflared --version`.
(If `winget` isn't available, download `cloudflared-windows-amd64.exe` from https://github.com/cloudflare/cloudflared/releases/latest, rename it to `cloudflared.exe`, and put it in your Multivisons folder.)

## Window 1: start the tunnel

```
cloudflared tunnel --url http://localhost:4010
```

After a few seconds it prints a box with a URL like `https://random-words-here.trycloudflare.com`. **Copy that URL.** Leave this window open, because closing it kills the tunnel.

## Window 2: register the webhook and listen

```
npm run paypal:webhook -- register https://random-words-here.trycloudflare.com
```

(Use your URL from window 1.) It prints `Registered webhook <ID>`. Then:

```
npm run paypal:webhook -- listen
```

It prints `Listening on http://localhost:4010/api/webhooks/paypal`. Leave this window open.

## Window 3: make a payment happen

```
npm run paypal:smoke -- create
```

Approve the link as the sandbox Personal account (same as before), then:

```
npm run paypal:smoke -- finish
```

## What you should see in window 2

Within a few seconds to a few minutes (sandbox can be slow), lines like:

```
[...] PAYMENT.AUTHORIZATION.CREATED  resource=7US...  -> HTTP 200 stored
  GET authorization 7US...: CONFIRMED (CAPTURED)
[...] PAYMENT.CAPTURE.COMPLETED  resource=94E...  -> HTTP 200 stored
  GET capture 94E...: CONFIRMED (COMPLETED)
```

Copy everything from window 2 and send it to Claude.

## If something goes wrong

| You see | Meaning / do this |
| --- | --- |
| Nothing in window 2 after 5 minutes | Check window 1 is still running. Run `npm run paypal:webhook -- list` and check the URL matches your tunnel URL + `/api/webhooks/paypal`. |
| `HTTP 400 unverified` | PayPal's signature check failed. Send Claude the output (this is a known PayPal quirk to investigate, see below). |
| `HTTP 503 verification_unavailable` | Couldn't reach PayPal to verify; PayPal will retry by itself. |
| `WEBHOOK_URL_ALREADY_EXISTS` | Run `register` again; it deletes old tunnel webhooks first. |

Each time you restart the tunnel you get a **new URL**, so run `register` again with it.

## Not yet verified (the sandbox test answers these)

- Whether PayPal's `verify-webhook-signature` accepts the event after we parse and re-send it as JSON. PayPal compares against the original event, and re-serialising can occasionally break verification. If it fails, the fallback is to verify the signature locally with PayPal's certificate (CRC32 of the raw body plus a SHA256withRSA check).
- Events from the dashboard **Webhooks simulator** cannot be verified this way. Test with real sandbox payments as above, not the simulator. They also must never count as proof of money movement.

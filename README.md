# Multivisons

An AI-assisted workspace for two people who have already agreed to work together. It turns their conversation into a jointly accepted scope, collects **verifiable digital signatures** from both parties, tracks milestone evidence, and lets the client approve a PayPal sandbox payment action.

Built with the **MERN stack**: MongoDB, Express, React, Node.js.

This is a hackathon prototype, not escrow, a legal service, or a guarantee of payment. Milestone payments in this build are **simulated PayPal sandbox actions** and are labelled that way in the UI. A real PayPal authorization reserves funds; it is not a captured deposit, and the verified payment mode must be disclosed in any demo.

## What is implemented

- **Accounts**: register and sign in with email and password (bcrypt hashing, 7-day JWT in an httpOnly cookie, rate-limited auth routes).
- **Agreements**: a client or contractor drafts a scope with fixed-price milestones and invites the other party by email. They see it as soon as they register with that address.
- **Immutable versions**: sending for signature locks the content and stores a SHA-256 fingerprint. Editing afterwards means reopening, which bumps the version and clears earlier signatures.
- **Digital signatures**: draw (canvas, touch and pen supported) or type a signature, confirm with your password, and tick an explicit consent box. Each signature is bound to the content hash, signer, role, time, and the mark itself with a server-side HMAC seal, plus IP and user agent.
- **Verification**: `GET /api/agreements/:id/verify` recomputes the content hash and every seal. Any tampering with signed terms is flagged in the UI.
- **Milestones**: completed in order. The contractor submits evidence; only the client can approve or request changes. The payment amount is always the signed figure.
- **Audit trail**: every action is recorded in an activity timeline.

- **Project uploads**: either party can upload briefs and reference files (max 10 MB, executables blocked); the contractor uploads the finished work with each milestone submission.
- **AI completion check**: each submission is scored against the signed acceptance criteria and shown as a percentage bar per milestone and for the whole project. With `ANTHROPIC_API_KEY` set, a Claude model judges each criterion from the note, link and readable file text. Without a key, a transparent keyword check is used and payment is never auto-released.
- **Pay with PayPal**: at or above `RELEASE_THRESHOLD` (default 85%) the signed amount is released automatically. Below it, payment is held and the client can override or request changes. With PayPal sandbox credentials the release is a sandbox Payouts call to the contractor's PayPal email (set at sign-up); otherwise it is a labelled simulation. The PayPal call has not been tested against live sandbox credentials.
- **Admin panel** (`/admin`, read-only): overview stats, every agreement with its current step, a per-agreement step tracker (accounts, lock, signatures, each milestone's submission, AI check and payment), signature verification, files and audit trail, and a list of accounts. Emails listed in `ADMIN_EMAILS` in `server/.env` become administrators when they register or sign in.
- **Landing page**: nine full-viewport sections (hero, animated how-it-works, features, roles, interactive AI check demo, payments, trust, FAQ, call to action).
- **Both parties need an account**: the client and the contractor each register; the invitation is matched by email.

The AI only scores the criteria. Fixed server rules compute the percentage, make the release decision and set the amount, which is always the signed milestone figure. Set `AUTO_RELEASE=always` in `server/.env` to auto-release on keyword scores too (demo only).

## Tech and design

- Font: **DM Sans** (via `@fontsource-variable/dm-sans`).
- Icons: **lucide-react** line icons. No emoji anywhere in the UI.
- React 18 + Vite + React Router; Express 5 + Mongoose + Zod.

## Quick start

Requirements: Node.js 20+, npm 10+, and MongoDB (Docker Compose provided).

```sh
docker compose up -d db
cp server/.env.example server/.env   # then set JWT_SECRET and SIGNATURE_SECRET
npm install
npm run dev
```

- Web: http://localhost:5173 (proxies `/api` to the API)
- API: http://localhost:4000

Production: `npm run build` then `npm start`. The API serves the built client from `client/dist`. `JWT_SECRET` and `SIGNATURE_SECRET` are required when `NODE_ENV=production`.

Tests (spin up an in-memory MongoDB; the first run downloads a MongoDB binary):

```sh
npm test
```

## Repository map

```text
server/               Express API
  src/models/         User, Agreement (milestones, signatures, events)
  src/routes/         auth, agreements (sign, verify, milestones)
  src/lib/crypto.js   canonical hashing and signature seals
  test/               end-to-end flow test
client/               React app (Vite)
  src/pages/          Landing, Auth, Dashboard, Editor, AgreementPage
  src/components/     SignaturePad, SignDialog, Layout
docs/                 runbook, evidence, submission kit
knowledge/            curated sources with provenance metadata
fixtures/             synthetic demo data only
ARCHITECTURE.md       original system design and payment-mode analysis
```

`ARCHITECTURE.md` describes the original TypeScript/PostgreSQL design. This MERN build keeps its invariants (immutable agreement versions, deterministic authorization, labelled payment modes) on a MongoDB stack.

## Roadmap

1. Real PayPal sandbox orders, authorization and capture behind a payments adapter, with webhook verification.
2. AI drafting: turn a chat or voice conversation into the agreement draft, and compare submitted evidence to acceptance criteria. Output stays advisory.
3. File evidence upload to private object storage.
4. Email invitations and notifications.
5. Downloadable signed PDF with an embedded verification page.

## Hackathon handoff

The submission needs a working build or hosted demo, setup instructions, a public open-source repository with a license, a description of the AI tools used, and a public YouTube demo under three minutes. Keep [docs/submission-checklist.md](docs/submission-checklist.md) current. Official links are in [docs/resources.md](docs/resources.md). The deadline shown on Devpost is **November 12, 2026 at 12:00 p.m. Pacific Time**.

## License

MIT. See [LICENSE](LICENSE).

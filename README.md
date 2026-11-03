# Multivisons

An AI-assisted workspace for two people who have already agreed to work together. It turns their conversation into a jointly accepted scope, tracks milestone evidence, and lets an authorized human approve a PayPal sandbox payment action.

**Project status: scaffold.** The folders and integration boundaries are ready; the application workflow, provider capability checks, and payment operations still need implementation and sandbox verification.

## What this project is designed to demonstrate

- AI helps clarify expectations, draft an agreement, and relate submitted evidence to agreed acceptance criteria.
- Both parties accept the same immutable agreement version.
- PayPal sandbox actions are tied to fixed milestone amounts and require an explicit client approval.
- Deterministic server rules authorize actions; the AI cannot execute or approve payments.

This is a hackathon prototype, not escrow, a legal service, or a guarantee of payment. A PayPal authorization reserves funds; it is not a captured deposit. The project must disclose the verified payment mode in the UI and demo.

## Local setup

Requirements: Node.js 24 LTS, npm 10+, and Docker Compose.

```sh
docker compose up -d db
npm install
npm run dev
```

This starts the scaffold status page. The agreement workflow and provider operations are still unimplemented. Optional local object storage is available with `docker compose --profile storage up -d`.

## Repository map

```text
apps/web/             Next.js client and server routes
apps/worker/          durable background jobs and reconciliation
packages/agent/       AI workflows, retrieval, and structured outputs
packages/contracts/   shared request/response and event types
packages/data/         persistence adapters and database migrations
packages/domain/      deterministic state transitions and policies
packages/payments/    PayPal gateway boundary and sandbox integration
docs/                 architecture, runbook, evidence, and submission kit
prompts/              versioned prompts and output schemas
knowledge/            curated sources with provenance metadata
fixtures/              synthetic demo data only
```

See [AGENTS.md](AGENTS.md) for project invariants and [docs/team-work.md](docs/team-work.md) for the workstream handoffs.
Official hackathon and integration links are collected in [docs/resources.md](docs/resources.md).

## Hackathon handoff

The submission needs a working build or hosted demo, setup instructions, a public open-source repository with a license, a description of the AI tools used, and a public YouTube demo under three minutes. Keep the checklist in [docs/submission-checklist.md](docs/submission-checklist.md) current. The official deadline shown on Devpost is **November 12, 2026 at 12:00 p.m. Pacific Time**.

## License

MIT. See [LICENSE](LICENSE).

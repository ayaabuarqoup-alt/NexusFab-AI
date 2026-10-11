# NexusFab AI

A bilingual manufacturing operations application with factory-isolated production logs, quality review, downtime costs, and a deterministic contextual analyst.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

React web app (explicitly selected over the uploaded Streamlit specification).
Factory users create jobs, record production and stoppages, approve or reject batches, and dispatch only after production targets and quality gates pass.

## Before live factory use

- Example factory accounts and sample records are development-only seeds. Do not publish public demo passwords as live credentials.
- Factory onboarding now supports public registration of a new, empty tenant and its owner. The Tenant ID is the owner's sign-in username; staff still use individual invitations and owner/operator/quality-inspector permissions. Existing factory identities cannot be claimed through signup.
- SESSION_SECRET is also the root used to derive per-factory vault encryption keys. Back it up securely; do not rotate it without decrypting and re-encrypting existing vaults in a controlled migration. Losing it makes existing vaults unreadable.
- The copilot is deterministic record analysis, not an external LLM. It supports scoped totals, recorded downtime concentrations, operator yield and recorded-date trends, with timestamped evidence. It must not claim validated root causes, labor efficiency or future failures from incomplete logs.
- Every login (including a newly registered owner) requires explicit selection of an owner-approved role before factory APIs or screens can be used. Owners can grant several roles through staff management; session permissions come only from the selected role. Legacy accounts retain their single existing grant, and role-grant changes revoke affected sessions.
- `pnpm --filter @workspace/api-server test` runs core/security, role-permission, onboarding/analyst, and operational-alert regression suites. Type checks remain available separately.
- The `owner` role is displayed as Admin. Audit reports are Admin-only. Operators edit work orders and reported machine/shipping statuses; shipping preserves QC and Admin dispatch approval. Inspectors review logs and resolve production issues.
- `production_planner` is the fourth approved role. Planners manage daily/weekly plans, UTC timelines, machine/operator assignments and work-order scheduling; they cannot approve QC, dispatch, manage staff or change machines' reported status. Operators/inspectors can read assigned schedules. Scheduled plans reject resource overlaps; completed plans are locked. Planner alerts include production status changes and issues; email still follows factory activation.
- Live factory updates use authenticated SSE and PostgreSQL notifications. Alert content remains inside encrypted factory vaults. Gmail alert delivery uses a persistent outbox, activated explicitly per factory after recipient emails are configured. Uncertain sends are reconciled against Gmail Sent and never blindly resent. Tests use fake mail adapters and reserved addresses, never real outgoing emails.
- Machinery fatigue is an illustrative heuristic, not a validated failure predictor or safety control.
- Native date/time picker chrome follows browser/OS locale; app labels and date displays follow the selected English/Arabic language.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

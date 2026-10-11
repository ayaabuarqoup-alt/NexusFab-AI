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
- Add private account provisioning and individually attributable owner/operator/inspector access before use with sensitive factory records.
- SESSION_SECRET is also the root used to derive per-factory vault encryption keys. Back it up securely; do not rotate it without decrypting and re-encrypting existing vaults in a controlled migration. Losing it makes existing vaults unreadable.
- The copilot is a deterministic simulation based exclusively on authenticated factory data, not an external LLM.
- Machinery fatigue is an illustrative heuristic, not a validated failure predictor or safety control.
- Native date/time picker chrome follows browser/OS locale; app labels and date displays follow the selected English/Arabic language.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

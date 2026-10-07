# Workflow: module.pipeline (Clinique MANA)

Goal:
Deliver one module safely to production (Supabase + RLS + audit), with clean local iteration.

Before starting ANY work:
- Read docs/modules/<module>/status.md
- Respect the current gate
- Do not skip gates unless explicitly instructed

────────────────────────────────────
Gate 0 — UI Wireframe
Run: ui.wireframe
Output: navigable screens + empty/loading/error states (mock data only)

Gate 1 — Data Contract
Run: data.contract
Output: docs/data-contracts/<module>.md
Rule: No schema work without this contract.

Gate 2 — Schema
Run: db.schema
Output: supabase migrations (schema only)

Gate 3 — Security (RLS)
Run: security.rls
Output: RLS policies + attack tests
Rule: deny-by-default, explicit allow.

Gate 4 — Audit (Write)
Run: audit.write
Output: audit_log + triggers

Gate 5 — Local Dev Validation
Run: dev.local.seed
Output: local seed + commands
Rule: validate locally before staging.

Gate 6 — UI Integration
Run: ui.integrate
Output: replace mocks with Supabase calls

Gate 7 — Automated Tests
Run: qa.rls + qa.smoke
Rule: forbidden access MUST fail.

Gate 8 — Staging → Production
- Apply migrations to staging
- Run tests
- Manual smoke
- Promote to production only after pass

────────────────────────────────────
Error Recovery & Backtracking (MANDATORY)

A) Contract wrong (found at schema/RLS stage)
1) Stop. Do not patch around.
2) Update the Data Contract first.
3) Create a NEW migration to correct schema.
4) Update RLS + tests.
5) Re-run local validation.

B) Migration mistake in staging
1) Never edit applied migrations.
2) Create corrective + backfill migrations.
3) Re-run tests.

C) RLS too strict or too loose
1) Adjust only the minimal policy.
2) Add regression test proving forbidden access still fails.

D) UI leaks restricted data
1) Treat as incident.
2) Ensure UI never renders restricted data pre-auth.
3) Add a test for the scenario.

Done Criteria:
- Contract exists
- Schema + RLS + audit + tests exist
- Local dev seed works
- UI integrates safely
- Staging passes

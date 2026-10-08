# Phase 3 — Shared services Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development in this session) to implement this plan task-by-task.

**Goal:** Build the core plumbing that modules use to reach people outside (and inside) the app: transactional email, in-app notifications, secure single-use links, staff invitations, auth links on the clinic domain, private file storage, e-signature with a shared server-side PDF renderer, and scheduled jobs. Every piece must be buildable and testable locally, with no real secret and no staging access.

**Architecture:** [Design](2026-10-08-phase-3-shared-services-design.md); consumers in the [Professionnels design §7](2026-10-08-professionals-module-design.md#7-what-4b4d-need-from-phase-3).
- **Database:** core tables and catalogues (closed grants, RLS through `private` helpers, audit triggers), and service-role RPCs that edge functions call. Purposes (links, uploads, jobs, templates) are **catalogues seeded by the owning module**, so core never imports module code.
- **Edge functions:** shared Deno libraries in `supabase/functions/_shared/` (`email/`, `pdf/`, `links.ts`, `storage.ts`, `documenso.ts`, `signing.ts`, `svix.ts`, `webhooks.ts`, `rate-limit.ts`, `jobs.ts`, `report.ts`), plus thin functions. Functions reach the database **only through RPCs and the Storage API**, so tests replace the client with a small fake.
- **External services** (Resend, Documenso, Svix webhooks, Gotenberg) sit behind interfaces with a local implementation: Mailpit for email, `scripts/fake-documenso.mjs` for signing, `scripts/send-test-webhook.mjs` for signed webhooks.
- **Frontend:** three new settings sections, the « Inviter » flow in « Utilisateurs et accès », the public pages `/invitation` and `/connexion/confirmer`, the topbar bell, and upload widgets for the logo and the signature image. All follow the Phase 2 patterns (`SettingsCard`, `FormField`, `api.ts` + hooks, `lazyPage`).

**Tech Stack:** React 19 · Vite 6 · TypeScript strict · React Router 6.30 · TanStack Query 5 · Tailwind 3 + shadcn/ui · Zod 4 · react-hook-form · Vitest + Testing Library · Supabase (Postgres 17, Auth, Storage, Vault, `pg_cron`, `pg_net`) · pgTAP · Deno 2 (Supabase Edge Runtime) · Resend · Documenso v2 · pdfmake (subject to the Task 3.29 spike).

---

## Décisions adoptées (déléguées par Jonathan, 2026-10-08 — révisables)

Jonathan, 2026-10-08: « You will go on without asking me questions you have phase 3 and 4 to go. » Every open question of the design (Q1–Q14) is settled by adopting the design's recommendation. P3-15 and later settle what the Professionnels design asks of Phase 3, and the inconsistencies found while planning. Each decision can be reversed. Task 3.36 copies them into the decisions log.

| # | Decision | Rationale |
|---|---|---|
| P3-1 (Q1) | Contract and fiche PDFs are rendered **server-side in an edge function with pdfmake**, from a structured document model (headings, paragraphs, lists, tables, images, page header and footer, signature page). Inter is embedded. A **spike opens batch 3f** (Task 3.29) with a written decision rule. If the rule fails, or Christine later needs Word-level fidelity, the fallback is **Gotenberg** (HTML → PDF) on the Documenso host, behind the same `PdfRenderer` interface. | A pure-JS renderer needs no new server; the interface keeps the fallback cheap. |
| P3-2 (Q2) | The staging Auth Site URL and the link host are `https://app.cliniquemana.com` (function secret `APP_URL`). Locally they stay `http://localhost:5173`. | Staging is the only remote environment; change it when production exists. |
| P3-3 (Q3) | **Documenso sends the signing emails** (`distributionMethod: EMAIL`, French, branded, through Resend SMTP). There is no `contract.sent` app template: record timelines show the signing events. | Sequential signing then works without our own relay. |
| P3-4 (Q4) | **No background retry queue.** Each send retries in the request (429/5xx: 3 attempts, 0.5 s then 2 s), and a final failure is shown at once with « Renvoyer ». | Visible failures are enough at one clinic; add an outbox if the Phase 4c reminders show failures. |
| P3-5 (Q5) | No suppression list of our own: Resend suppresses hard bounces. The record shows « Adresse introuvable ». | Avoids duplicating a provider feature. |
| P3-6 (Q6) | `email_log.to_email` is set to null after **24 months** (the row is kept). Christine confirms the period (Mise en service). | Keeps the history while minimising personal data. |
| P3-7 (Q7) | Tokens are hashed, so a link can be shown **only when it is created**. `_shared/links.ts` returns the URL to the calling function. Professionnels 4b offers « Créer un nouveau lien et le copier », which revokes the previous link. Staff invitations are sent by email only. | A stored, displayable token would bring back legacy hole A3. |
| P3-8 (Q8) | Inviting an address that already has an account in another org is out of scope while there is one clinic. If acceptance meets an existing auth account, it answers the generic « Ce lien ne peut plus être utilisé… » and reports the event without the address. | Never reveal that an account exists. |
| P3-9 (Q9) | Disabling a user also calls `auth.admin.updateUserById(id, { ban_duration })` (`users-set-status`), which blocks token refreshes. This is **proven locally** against the CLI's GoTrue (Task 3.20 probe), then again in the staging smoke test. | Supported, reversible, needs no SQL on `auth.sessions`. |
| P3-10 (Q10) | Emails use the **static wordmark served by the app** (`APP_URL/email/wordmark.png`), not the org logo. | One clinic; the same URL for every recipient, so it is not a tracker. |
| P3-11 (Q11) | « Tâches planifiées » is built in Phase 3 (Task 3.5). | Phase 3 creates jobs whose failures someone must see. |
| P3-12 (Q12) | `set_org_secret` / `delete_org_secret` require `settings.integrations_manage` (Task 3.1). | Integration keys are more sensitive than the clinic identity. |
| P3-13 (Q13) | A neutral email change at the API level (ADR 0006: GoTrue answers 422 `email_exists`) is deferred until clients get accounts. | No client accounts in Phase 3 or 4. |
| P3-14 (Q14) | No antivirus scan of uploads. Uploads are size-limited, type-limited and content-sniffed (Task 3.25). | Only staff and known professionals upload. Revisit before the client portal. |
| P3-15 | **In-app notifications are in Phase 3** (batch 3b, Tasks 3.12–3.13): a core `notifications` table addressed by permission (optionally narrowed to one user), normal or important, with a link and per-user read state; the topbar bell; « À surveiller » on Accueil. This settles the conflict between design §1 (« out of scope ») and Professionnels §7 (« please add it »). | Professionnels 4b and 4c both need it, and it is core plumbing like email. |
| P3-16 | **Pluggable purpose handlers through the catalogue.** `secure_link_purposes` names a service-role `resolve_rpc` and `accept_rpc`. `accept-invite` (core) creates the auth user, then calls the purpose's `accept_rpc`, which consumes the link and does the module's work in one transaction. If the RPC fails, the function deletes the user it created. | Professionnels plugs in `link_professional_account` without core importing module code (ADR 0003). |
| P3-17 | **Staged uploads:** `stored_files.retain_until`. A module stages a file under a submission with a deadline. On approval its RPC calls `private.attach_stored_file(…)` to re-point the row, which clears the deadline. The object path never moves: paths are opaque, and only the first segment (org) is ever parsed. `storage-cleanup` soft-deletes files whose deadline has passed. | Fixes legacy leak A3.7 with no copy or move. |
| P3-18 | **Attachments and free recipients are catalogue flags** on `email_template_defaults`: `recipient_mode` (`subject` \| `free`) and `allows_attachments` (PDF only, at most 3, 10 MB in total). `_shared/email` refuses anything else. A free-recipient send is limited to 20 per user per hour. | `professionals.fiche` (any address, with a PDF) without opening a generic relay. |
| P3-19 | **One PDF path:** `_shared/pdf/` (`renderPdf(doc, assets) → { bytes, pageCount, fields }`) serves both signing (3f) and the Phase 4c fiche. Images (logo, signature) are read from storage by the service role. | Professionnels §7 asks for one rendering path. |
| P3-20 | Where the two designs differ, **the Phase 3 design wins and Phase 4 aligns**: storage paths are `{org_id}/{module_key}/{subject_id}/{file_id}.{ext}` with no file name (Professionnels §7 said `{uuid}-{name}`); signed read URLs last 5 min (not 1 h); template keys use the module key, `professionals.*` (not `professional.*`), including document templates. | Loi 25 (no names in URLs), the A4 Change, and the key-prefix rule shared with permissions. |
| P3-21 | **One permission source, evaluated once per statement.** New `private.current_permission_keys() → text[]` (stable, definer). `has_permission(k)` becomes `k = any(current_permission_keys())`, and `get_my_access().permissions` reads the same function. Row-level `view_permission` policies use `view_permission = any ((select private.current_permission_keys())::text[])`. Note: `((select …))` alone does not compile (`text = text[]`); the `::text[]` cast is required. | A per-row `has_permission(column)` call cannot be hoisted out of the scan (design §2.3 wrote it that way); a single function also cannot drift. |
| P3-22 | **Jobs at a clinic-local hour:** `scheduled_jobs.local_hour`. The cron entry runs hourly. `list_job_orgs` returns the orgs whose local hour (from `organizations.timezone`) equals `local_hour` and that have no run yet for that local date (unique index). Maintenance jobs keep fixed UTC schedules. | Professionnels wants 06:00 clinic time; the design's 11:00 UTC is 07:00 in summer (EDT). |
| P3-23 | **Local fakes only, no real secret:** `EMAIL_TRANSPORT=mailpit` locally; `scripts/fake-documenso.mjs` (port 55390); `scripts/send-test-webhook.mjs` signs Resend/Documenso payloads with the local test secrets. Local-only values live in `supabase/seed.sql` (Vault rows) and `supabase/functions/.env` (gitignored, copied from the committed `.env.example`). Each is visibly fake (`local-dev-…`). | Jonathan pastes the real keys later (Mise en service). |
| P3-24 | The bell **polls** (count every 60 s, on window focus, never in background tabs) instead of using Realtime. This deviates from PS Hub (Realtime on `notifications`). | Realtime would need a publication and per-change RLS checks on permission-addressed rows; one minute of latency is enough for insurance notices. |
| P3-25 | Only the **DB lane** writes migrations, `supabase/seed.sql` and `database.types.ts`, and only one lane at a time holds the **DB token** (see « Lanes »). | The local Supabase stack is shared by every worktree; `db reset` applies the caller's own migrations folder. |
| P3-26 | Record timelines read emails through `list_subject_emails(p_subject_type, p_subject_id)` (security invoker, RLS applies) and signing through `list_subject_signature_requests(…)`. | Professionnels « Historique » and the checklists; no module reads core tables raw. |
| P3-27 | Five Supabase auth templates (all but `invite`, which is unused and kept as is) are **generated** from the shared email layout (`npm run build:auth-templates`). CI checks that the committed files match the output. | Auth and app emails look the same, from one source. |
| P3-28 | Edge-function error **codes** stay English. The UI maps each code to a French i18n text (`link_expired` → « Ce lien a expiré… »). New codes: `rate_limited` 429, `invalid_request` 400, `link_invalid` / `link_expired` / `link_used` 410, `conflict` 409, `not_found` 404, `provider_error` 502, `not_configured` 503. | Keeps today's `ErrorCode` pattern. `provider_error`, `not_found` and `not_configured` are added to the design's list: a Resend or Documenso failure and missing configuration must be distinguishable from `internal`. |
| P3-29 | **Error reports** from functions use `_shared/report.ts`, ported from PS Hub's `_shared/sentry.ts`. It sends only the function name, an error code and row ids, never an address, token or body. With no `SENTRY_DSN` it logs a structured line. | The design asks for Sentry alerts from functions, and none exist yet. |
| P3-30 | `stored_files` has a fifth status, `purged` (object removed, row kept); `signature_requests` gains `last_error`; `document_templates` gains `view_permission`; `signature_requests.template_version_id` may be null only for the built-in test document; `signing_settings.base_url` accepts `https://…`, or `http://host.docker.internal:<port>` for the local fake. | Gaps found while planning (see the next section). |

### Design inconsistencies resolved here

1. Notifications: design §1 puts them out of scope, but Professionnels §7 asks Phase 3 for them → P3-15.
2. Template keys `professionals.*` (design §2.2) vs `professional.*` (Professionnels §3.4, §5.5, §7) → P3-20.
3. Storage path `{file_id}.{ext}` and 5-min URLs (design §7) vs `{uuid}-{name}` and 1 h (Professionnels §7) → P3-20.
4. Professionnels §7 lists a `contract.sent` email, but Q3 has Documenso send it → P3-3.
5. `professionals.document_expired` and the weekly reminder (Professionnels §3.4) are missing from design §2.2's key list. They are module-seeded, so nothing changes in Phase 3. Phase 4 adds them.
6. Insurance job « daily 11:00 UTC » (design §8) vs « 06:00 clinic timezone » (Professionnels §3.4) → P3-22.
7. The `email_log` / `stored_files` policies call `has_permission(view_permission)` per row → P3-21.
8. `org-assets`: « the logo by every org member », but no permission is held by every member → `view_permission is null` means any active member of the org.
9. `document_templates` has only `edit_permission`, while §6.2 says every signing table is read « with `view_permission` » → P3-30.
10. Magic-link `next={{ .RedirectTo }}` (design §5) is an **absolute** URL, and `safeRedirect` only accepts paths → `/connexion/confirmer` reduces a same-origin absolute URL to its path first (Task 3.14).
11. `signature_requests.status` includes `draft`, but §6.3 goes straight to `sent`. `draft` is kept as the state between insert and Documenso success, and the reconcile job cleans stale drafts (Task 3.31).
12. Storage policies « may call `private.current_professional_id()` » (Professionnels §7). There is one core read policy; module ownership is expressed in the row (`owner_profile_id` + `owner_permission`), never in a storage policy.
13. ADR 0005 names a generic `signing-create` function; design §6.3 has module functions calling `_shared/signing.ts` instead. ADR 0005 is updated in Task 3.35.
14. `resolve-link` / `accept-invite` keep `verify_jwt = true` (the anon key is required). The new non-JWT publishable keys (`sb_publishable_…`) would be refused by the gateway. Mise en service checks that the app uses the legacy anon JWT; otherwise switch both to `verify_jwt = false` plus an explicit `apikey` check.
15. A staff invitation references `roles(key)`, so `delete_role` (Task 2.20) would fail on a role with pending invitations with a raw FK error. Task 3.18 extends `delete_role`'s guard with a French message.

---

## Ground rules for the executor

- **Branch:** create `feat/phase-3-shared-services` from `feat/phase-2-core-settings` (Task 3.0). Lanes branch from it, and merge back with `merge: <what> (lane X)`.
- **Read first:** `CLAUDE.md`, `docs/standards/database-conventions.md`, the design, ADRs 0003–0006, and this plan's decisions.
- **Approvals:** nothing in this plan pushes, opens a PR or touches staging. Every staging step is in « Mise en service (Jonathan) ». Merging to `main` deploys migrations and functions (CLAUDE.md §11).
- **No secrets, ever:**
  - nothing in this plan needs a real key to build or test;
  - tests replace `fetch` (Deno) or the API layer (Vitest);
  - local values are fake and named `local-dev-…`;
  - never print, log or commit a token, key or recipient address. Logs carry ids and codes.
- **PS Hub when unsure** (Jonathan, 2026-10-08):
  - Whenever a choice is uncertain, first read how PS Hub solved it, read-only, in `/Users/jonathanharvey/Documents/Claude Projects/NEW PS Hub`. Each task lists its references.
  - Follow PS Hub unless it conflicts with a decision here, CLAUDE.md or a security rule.
  - Note every deviation in the commit body (« Deviation from PS Hub: … because … »).
  - Known deviations: PS Hub hard-codes URLs (`DOCUMENSO_URL`, the project URL in `invoke_internal_edge_function`); compares the Documenso secret with `!==`; builds contract PDFs in the browser; stores quote tokens in clear (UUID); and uses Realtime for notifications (P3-24).
- **Clean, efficient, production code** (Jonathan, 2026-10-08):
  - smallest correct change; no dead code, no speculative options;
  - a JSDoc line on each exported function;
  - the review checklist below is applied to every task.
- **Docker:** `open -a OrbStack`, then `npm run db:start`. Ports 553xx only; never touch PS Hub's 543xx stack.
- **Migrations:** `npx supabase migration new <english_name>`. If the generated seconds are `00`, delete the file and run it again. Only the DB lane creates migrations (P3-25). Never edit an applied migration; fix forward.
- **After every migration** (DB token held):
  ```bash
  npm run db:reset && npm run db:test && npm run db:types
  ```
  Expected: `All tests successful.` and a `database.types.ts` diff limited to the new objects. Then run the suite once more with `npx supabase db reset --no-seed && npm run db:test` (conventions §10).
- **Before every commit:**
  ```bash
  npm run typecheck && npm run lint && npm run lint:supabase && npm run test:run
  npm run check:functions && npm run lint:functions && npm run test:functions   # when supabase/functions changed
  ```
- **Commits:** Conventional Commits; the message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage **explicit paths only** (`git add <path> …`). Never use `git add -A`, `git commit -a` or `git stash`: other agents work in the same worktrees.
- **Error codes in SQL:** `42501` permission, `22023` invalid technical argument, `P0001` French message for anything a user can cause.
- **`functions_are` list:** `003_core_module_settings_secrets.test.sql` asserts the exact list of `public` functions. Every task that adds an RPC adds it there in the same commit.
- **pgTAP numbering:** files continue from the highest number. `014` is expected to be Task 2.20's `014_core_editable_roles`. If it isn't, shift the numbers below by one; never reuse a number.
- **Detail level:** the infrastructure pieces (rate limits, webhook claims, the permission helper, link consumption, object policy, the email send path, accept-invite) are given precisely. Other pieces list their tables, signatures, rules and tests. Reproduce the Phase 2 patterns; do not invent new ones.

## Lanes and the DB token

The local Supabase stack (containers named after `project_id = "clinique-mana"`) is **shared by every worktree**. `supabase db reset` applies *the calling worktree's* migrations, and restarting the stack interrupts everyone. So:

| Lane | Owns | Needs the DB token for |
|---|---|---|
| **DB** (serial, critical path) | all migrations, pgTAP files, `seed.sql`, `database.types.ts`, `config.toml` `[functions.*]` blocks | everything it does |
| **F** (functions) | `supabase/functions/_shared/**`, function folders, Deno tests, `scripts/fake-*.mjs`, `scripts/send-test-webhook.mjs` | only the « Live probe » steps (`functions serve`, curl, Mailpit) |
| **U** (UI) | `src/**`, `supabase/templates/**`, `scripts/build-auth-templates.ts` | only Task 3.16 (stack restart for templates) and browser walkthroughs |
| **Coordinator** | lane merges, docs and ADR tasks (3.23, 3.28, 3.35, 3.36), Task 3.37 | the final verification |

**DB token protocol:**
- Acquire with `mkdir "$(git rev-parse --git-common-dir)/clinique-mana-db.lock"`. The directory is shared by all worktrees and not tracked. If it already exists, wait: never delete another lane's lock.
- Before acquiring it, merge `feat/phase-3-shared-services` into your lane branch, so your migrations folder is the newest.
- Release with `rmdir` on the same path as soon as the probe or test run ends. The DB lane releases it between tasks too.

**Order:**

| Step | DB lane | Lane F (no DB) | Lane U (no DB) |
|---|---|---|---|
| 1 | 3.0, 3.1, 3.2, 3.3 | 3.4, 3.7, 3.9, 3.29 (spike: pure Deno; live part under the token) | 3.14 |
| 2 | 3.6 → merge types | 3.8, 3.19, 3.25 | 3.15 (after 3.7 merges), 3.16 [token], 3.5 (after 3.3 merges) |
| 3 | 3.12 → 3.17 → 3.18 | 3.10 (after 3.6), 3.30, 3.32 | 3.11 (after 3.6/3.10), 3.13 (after 3.12) |
| 4 | 3.24 → 3.31 | 3.20 (after 3.18), 3.26 (after 3.24), 3.33 (after 3.31) | 3.21, 3.22 (after 3.20), 3.27 (after 3.26), 3.34 (after 3.33) |
| 5 | — | — | Coordinator: 3.23, 3.28, 3.35, 3.36, 3.37 |

- **Conflict hot spots:**
  - `src/i18n/fr-CA.json`: each task adds keys only under its own namespace;
  - `supabase/config.toml`: the DB lane adds the `[functions.*]` blocks, Lane U touches only `[auth.email.template.*]`;
  - `src/core/settings/sections.ts`: entries are appended;
  - `003_core_module_settings_secrets.test.sql` (`functions_are`): DB lane only.

  The coordinator resolves merge conflicts by keeping both sides.
- **Dependency rule:** a U or F task that calls a new RPC starts only after the DB task that creates it has merged into the phase branch, because it needs the generated types and the RPC names.

## Conventions used throughout

**Edge function shape.** Every function is two files, so the logic is testable without a server:

```ts
// supabase/functions/<name>/handler.ts — all logic; no Deno.serve, no env reads at import time
export interface Deps {
  env: (key: string) => string | undefined
  fetch: typeof fetch                 // Resend, Documenso, Gotenberg go through this
  now: () => Date
  serviceClient: () => SupabaseClient | Response
  userClient: (token: string) => SupabaseClient | Response
}
export function createHandler(deps: Deps): (req: Request) => Promise<Response>

// supabase/functions/<name>/index.ts — wiring only
import { createHandler } from './handler.ts'
import { defaultDeps } from '../_shared/deps.ts'
Deno.serve(createHandler(defaultDeps()))
```

- **Database access** goes through `client.rpc(…)` and `client.storage`, never `.from('<table>')`. This keeps grants closed and makes `_shared/testing/fake-supabase.ts` a small router: `rpc(name, args) → { data, error }`, plus storage stubs.
- **Request bodies:**
  - JSON bodies are capped at **64 KB**, read with `readJson(req, schema)` from `_shared/http.ts` (413 / `invalid_request`);
  - schemas use **Zod** (`npm:zod@4`, the web app's major version, added to `deno.json` in Task 3.4);
  - files never pass through a function body: they use signed upload URLs.
- **Independent awaits** run with `Promise.all`; sequential awaits are only for true data dependencies.
- **Test doubles** live in `_shared/testing/`: `fake-supabase.ts`, `fake-fetch.ts` (a route table with a call log), `fixed-clock.ts`. They are excluded from deploys because no `index.ts` imports them.

**RPC skeleton.** Copy the Phase 2 style (`20261007211509_core_user_admin.sql`):
- `set search_path = ''`, qualified names;
- permission check first;
- `revoke all … from public, anon, authenticated`, then explicit grants;
- service-role RPCs: `grant execute … to service_role` only;
- user RPCs: `grant execute … to authenticated`.

Read-only list RPCs that RLS can gate are `security invoker` (`language sql stable`), with **keyset pagination** (`p_before timestamptz`, `p_limit int default 50`, clamped to 1–100).

**pgTAP fixtures:**
- Org A: admin, adjointe, conseillère, provider, and a disabled admin.
- Org B: admin.
- `set local role` / `request.jwt.claims` as in `009_core_user_admin.test.sql`.
- Service role: `reset role; set local role service_role;`.
- Filter assertions by fixture ids.
- Privileges: `table_privs_are` / `function_privs_are`, never `throws_ok` on a function the role cannot execute (image `.106` crash).

**Frontend:**
- New pages and settings sections are `lazyPage(() => import('./pages/X'), 'XPage')` (`@/shared/lib/lazy-page`). New public routes are added to `preloadRouteCode` matching only their own path.
- Queries live in `api.ts` with `<thing>Keys` factories.
- Every query selects explicit columns or calls one RPC; a screen's independent queries run in parallel (no waterfall, no `enabled: !!previous` chain unless there is a real dependency).
- Lists are paged (« Charger plus », keyset).

## Review checklist (every task)

Spec review, then quality review, with **live probes** where the task has them (Phase 2 process).

**Correctness and security:**
- closed grants;
- RLS through `private` helpers in `(select …)`;
- audit trigger or a commented invariant exception;
- French P0001 messages;
- module gate on every function (`verifyAuth({ module })` or `requireModuleForOrg` from the row);
- no org id trusted from the client;
- no secret, token or address in logs, Sentry, `audit_log` or URLs (query strings included).

**Efficiency (Jonathan, 2026-10-08):**
- **No query waterfalls:** independent reads in one RPC or in parallel (`Promise.all`, parallel `useQuery`).
- **Indexes for every RLS and FK path:**
  - each policy predicate (`org_id` plus the filter column) has a supporting index;
  - list RPCs have an index matching their `where … order by` (e.g. `(org_id, created_at desc)`);
  - FK indexes are enforced by `000_invariants`.

  For each list RPC, record an `explain (analyze, buffers)` over **10 000 generated rows** in the review: no seq scan on the big table, under 5 ms locally.
- **No N+1:**
  - set-based SQL;
  - functions batch storage removals (`remove(paths[])`, 100 per call) and RPC calls (arrays, not loops);
  - the only loop allowed is « per org » in jobs.
- **Bounded payloads:**
  - list RPCs clamp `p_limit` (≤ 100);
  - function bodies ≤ 64 KB;
  - previews ≤ 200 KB of HTML;
  - attachments ≤ 10 MB;
  - JSON columns checked as objects or arrays with a length cap.
- **Lazy UI:**
  - sections, pages and the template editor load through `lazyPage`;
  - heavy dependencies (the PDF renderer, the Documenso client) are imported only by the functions that use them;
  - the bell's list loads only when it is opened.
- **Cold start:** shared modules have no top-level side effects or network calls.

---

# Batch 3a — Foundations

## Task 3.0: Branch, baseline and local environment files

**Lane:** DB (token). **Files:**
- Create: `supabase/functions/.env.example`
- Modify: `.gitignore` (only if `supabase/functions/.env` is not already covered: the existing `.env` pattern should match; check it)

**Step 1: Preconditions.** Phase 2 is complete on `feat/phase-2-core-settings`, including Task 2.20 (`org_role_permissions`) and the perf work (`src/shared/lib/lazy-page.ts`, `src/app/route-preload.ts`) committed. Run:
```bash
git status --short            # expected: no modified tracked file owned by Phase 2 work in progress
git log --oneline -1
```
If Phase 2 work is still uncommitted, stop and tell the coordinator; do not branch from a moving tree.

**Step 2: Branch.**
```bash
git switch -c feat/phase-3-shared-services feat/phase-2-core-settings
```

**Step 3: Baseline is green** (DB token):
```bash
npm run db:reset && npm run db:test
npm run typecheck && npm run lint && npm run lint:supabase && npm run test:run
npm run check:functions && npm run lint:functions && npm run test:functions
```
Expected: all green. Record the counts (pgTAP tests, Vitest tests, Deno tests) in the task report.

**Step 4: `supabase/functions/.env.example`** (committed; `supabase functions serve` loads `supabase/functions/.env` automatically):
```dotenv
# Local edge-function environment. Copy to supabase/functions/.env (gitignored).
# Every value here is a LOCAL FAKE. Real values are function secrets on staging (plan « Mise en service »).
APP_URL=http://localhost:5173
ALLOWED_ORIGINS=http://localhost:5173
EMAIL_TRANSPORT=mailpit
# Mailpit seen from the edge-runtime container (verify the name with `docker ps`):
MAILPIT_URL=http://supabase_inbucket_clinique-mana:8025
INTERNAL_FUNCTION_SECRET=local-dev-internal-function-secret
SENTRY_DSN=
```
Then `cp supabase/functions/.env.example supabase/functions/.env` and check `git check-ignore supabase/functions/.env` prints the path.

**Step 5: Commit.**
```bash
git add supabase/functions/.env.example
git commit -m "chore(functions): local edge-function environment template (fake values only)"
```

---

## Task 3.1: Core permissions, the `set_org_secret` switch, one permission source

**Lane:** DB. **Files:**
- Create: `supabase/migrations/<ts>_core_shared_permissions.sql` (`npx supabase migration new core_shared_permissions`)
- Create: `supabase/tests/database/015_core_shared_permissions.test.sql`
- Modify: `supabase/tests/database/003_core_module_settings_secrets.test.sql` (`set_org_secret` permission assertions)
- Modify: `src/core/users/permissions.ts` (+ test) and `src/i18n/fr-CA.json` if permission labels are listed there (the users sheet groups permissions by key)

**Step 1: Write the failing pgTAP test** `015_core_shared_permissions.test.sql`. Fixtures: org A with admin, adjointe (+ override `settings.manage = true`), conseillère, provider, and a disabled admin; org B with admin. Assert:
- `permissions` holds `settings.email_manage` (« Gérer les courriels de la clinique ») and `settings.integrations_manage` (« Gérer les clés d'intégration »), module `core`;
- both are granted to `admin` in the template (`role_permissions`) **and** in `org_role_permissions` for org A and org B (Task 2.20 propagation);
- **`private.current_permission_keys()`**:
  - as admin A: contains every core key and `professionals.view` (module on in the fixture);
  - as the conseillère: `{professionals.view}`;
  - as the disabled admin: `{}`;
  - anon: `function_privs_are('private', 'current_permission_keys', array[]::text[], 'anon', array[]::text[])`;
- **parity:** for every fixture user and every `permissions.key`, `private.has_permission(k) = (k = any(private.current_permission_keys()))`. Write it as one `is_empty` over a cross join, switching `request.jwt.claims` inside a `do` block that collects mismatches into a temp table;
- `get_my_access() -> 'permissions'` equals `to_jsonb(private.current_permission_keys())` for admin A and for the conseillère;
- **`set_org_secret` switch:**
  - the adjointe with `settings.manage` but no `settings.integrations_manage` gets `42501` from `set_org_secret('resend_api_key', 'x')` and from `delete_org_secret('resend_api_key')`;
  - admin A succeeds; `list_org_secret_keys()` still needs `settings.view` only.

Update 003's assertions that relied on `settings.manage` for `set_org_secret`: change the fixture (grant `settings.integrations_manage`), never weaken the assertion.

**Step 2: Run it and check that it fails.** `npm run db:test`. Expected: 015 fails (unknown permission keys, missing function).

**Step 3: Write the migration.**
```sql
-- =============================================================================
-- Shared-services permissions and one permission source
-- =============================================================================
-- Design:  docs/plans/2026-10-08-phase-3-shared-services-design.md §9
-- Plan:    P3-12 (integrations_manage gates org secrets), P3-21 (one source, per statement)
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:core_shared_permissions', true);

insert into public.permissions (key, module_key, description) values
  ('settings.email_manage',        'core', 'Gérer les courriels de la clinique'),
  ('settings.integrations_manage', 'core', 'Gérer les clés d''intégration')
on conflict do nothing;

-- The Task 2.20 trigger copies new template rows into org_role_permissions for every org.
insert into public.role_permissions (role, permission_key) values
  ('admin', 'settings.email_manage'), ('admin', 'settings.integrations_manage')
on conflict do nothing;
```
Then:
- **`private.current_permission_keys() returns text[]`**: `language sql stable security definer set search_path = ''`. It uses the same CTEs as today's `has_permission` (the active caller, their role and org; permissions whose module is `core` or enabled for the org), with the role defaults read from `org_role_permissions` for the caller's org (as `has_permission` reads them after Task 2.20). It returns `coalesce(array_agg(key order by key), '{}')` of the keys where `coalesce(override.granted, role default exists)`. Grant execute to `authenticated` and `service_role` (policies run as the caller), revoke from `public, anon`.
- **`private.has_permission(p_key)`**: `create or replace` with the same signature, grants and comment, body `select p_key = any (private.current_permission_keys())`. *Review of 3.1:* wrap in `coalesce(…, false)` (null key → false) and write it in `language plpgsql` (a definer SQL wrapper is not inlined: ~8× slower per call); done as a follow-up migration with Task 3.2.
- **`public.get_my_access()`**: `create or replace`. Only the `permissions` field changes, to `to_jsonb(private.current_permission_keys())`; every other field stays byte-identical. Read the current definition first (`\sf public.get_my_access`).
- **`set_org_secret` / `delete_org_secret`**: `create or replace` with `settings.integrations_manage` in the check and in the `42501` message. Keep the audit row and everything else.

**Step 4: Run the database checks.** `npm run db:reset && npm run db:test && npm run db:types`. Expected: every file green, 001–014 included. A failure in 001/009/013 means the rewrite changed behaviour: fix the function, not the test.

**Step 5: Frontend.** The users sheet's permission groups (`src/core/users/permissions.ts`) get the two keys, with French labels. Update its test (« every core permission has a label »).

**Step 6: Commit.**
```bash
git add supabase/migrations/<ts>_core_shared_permissions.sql supabase/tests/database/015_core_shared_permissions.test.sql \
  supabase/tests/database/003_core_module_settings_secrets.test.sql src/core/supabase/database.types.ts \
  src/core/users/permissions.ts src/core/users/permissions.test.ts src/i18n/fr-CA.json
git commit -m "feat(db): email and integrations permissions; one per-statement permission source"
```

**Review focus:**
- `explain` a policy using `(select private.has_permission('settings.view'))` before and after: still an InitPlan;
- `get_my_access` output is unchanged for all four seed accounts (diff the JSON).

---

## Task 3.2: Rate limits and webhook claims

**Lane:** DB. **PS Hub reference:** `supabase/migrations/20260715035519_documenso_terminal_claim_backfill.sql` (`claim_contract_webhook_event`) and `supabase/functions/documenso-webhook/idempotency.ts` (`claimWebhookDelivery`, `documensoEventId`).

**Files:**
- Create: `supabase/migrations/<ts>_core_rate_limits_webhook_events.sql`
- Create: `supabase/tests/database/016_core_rate_limits_webhook_events.test.sql`
- Modify: `supabase/tests/database/000_invariants.test.sql` (commented exception list)
- Modify: `docs/standards/database-conventions.md` §7 and §12 (operational logs are exempt from the audit trigger; the list lives in `000`)

**Step 1: Write the failing pgTAP test.** Assert:
- **Privileges:**
  - `rate_limits` and `webhook_events`: no privilege for `anon` or `authenticated` (`table_privs_are … array[]::text[]`);
  - `consume_rate_limit`, `claim_webhook_event`, `complete_webhook_event`, `fail_webhook_event`, `last_webhook_event_at`: `function_privs_are` → `service_role` only, except `last_webhook_event_at`, which `authenticated` can execute.
- **`consume_rate_limit`** (as `service_role`):
  - `consume_rate_limit('test.bucket', sha256('k'), 2, 60)` → `allowed = true, hits = 1`, then `true, 2`, then `false, 3` with `retry_after_seconds between 1 and 60`;
  - another key is independent;
  - `p_max = 0` → `22023`; a key that is not 32 bytes → `22023`; `p_window_seconds = 90000` → `22023`.
- **`claim_webhook_event`:**
  - first call → `claimed` with a token; same `(provider, event_id)` again → `in_progress`, with no token;
  - `complete_webhook_event(id, token)` → the payload is cleared (`payload is null`), status `completed`; claiming again → `duplicate`;
  - a wrong token on complete → `false` (no update);
  - takeover: set `lease_expires_at = now() - interval '1 second'` as postgres, then claim → `claimed`, `attempts = 2`;
  - `fail_webhook_event(id, token, 'documenso_download_failed')` → `failed`; the next claim takes over;
  - an `error` that is not `^[a-z0-9_]{1,64}$` → `22023` (no free text, so no PII);
  - claiming an existing event with **another org** → `22023`.
- **`last_webhook_event_at(p_provider)`:** as admin A, the max `received_at` for org A only; null for org B's admin; `42501` for the conseillère (needs `settings.view`).
- **`000_invariants`** stays green.

**Step 2: Run it and check that it fails.**

**Step 3: Write the migration.**
```sql
-- =============================================================================
-- Rate limits and the shared webhook claim
-- =============================================================================
-- Design:  docs/plans/2026-10-08-phase-3-shared-services-design.md §2.6, §2.7, §3.2
-- Both tables are operational logs: no client privilege, no audit trigger
-- (listed in 000_invariants' exception list). Keys are HMAC-hashed by the caller:
-- no raw IP or address is stored. Fixed windows (date_bin): a burst of 2×max at a
-- window boundary is accepted.
-- =============================================================================

create table public.rate_limits (
  bucket text not null check (bucket ~ '^[a-z][a-z0-9_.]{0,62}$'),
  key_hash bytea not null check (pg_catalog.length(key_hash) = 32),
  window_start timestamptz not null,
  hits int not null default 1,
  primary key (bucket, key_hash, window_start)
);
create index rate_limits_window_start_idx on public.rate_limits (window_start);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

create function public.consume_rate_limit(p_bucket text, p_key_hash bytea, p_max int, p_window_seconds int)
returns table (allowed boolean, hits int, retry_after_seconds int)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_window interval;
  v_start timestamptz;
  v_hits int;
begin
  if p_max is null or p_max < 1 or p_window_seconds is null or p_window_seconds not between 1 and 86400
     or p_key_hash is null or pg_catalog.length(p_key_hash) <> 32 then
    raise exception 'Arguments invalides.' using errcode = '22023';
  end if;
  v_window := pg_catalog.make_interval(secs => p_window_seconds);
  v_start := pg_catalog.date_bin(v_window, pg_catalog.now(), timestamptz '2000-01-01 00:00:00+00');
  insert into public.rate_limits as r (bucket, key_hash, window_start)
  values (p_bucket, p_key_hash, v_start)
  on conflict (bucket, key_hash, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;
  return query select v_hits <= p_max, v_hits,
    case when v_hits <= p_max then 0
         else pg_catalog.ceil(extract(epoch from (v_start + v_window - pg_catalog.now())))::int end;
end;
$$;
revoke all on function public.consume_rate_limit(text, bytea, int, int) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, bytea, int, int) to service_role;
```
Then `webhook_events`:
- columns: `id uuid pk default gen_random_uuid()`, `provider text check in ('resend','documenso')`, `event_id text check length 1–200`, `org_id → organizations on delete cascade`, `event_type text check length 1–100`, `status text default 'processing' check in ('processing','completed','failed')`, `claim_token uuid`, `claimed_at`, `lease_expires_at`, `completed_at`, `attempts int default 1`, `last_error text check (last_error ~ '^[a-z0-9_]{1,64}$')`, `payload jsonb check (payload is null or jsonb_typeof(payload) = 'object')`, `received_at timestamptz default now()`, `unique (provider, event_id)`;
- indexes: `(org_id, provider, received_at desc)` (serves the FK and `last_webhook_event_at`); `(received_at)` (purge);
- RLS on; revoke all from clients.

Functions:
- **`public.claim_webhook_event(p_provider, p_event_id, p_org_id, p_event_type, p_payload jsonb, p_lease_seconds int default 300) returns table (status text, id uuid, claim_token uuid)`**:
  1. `insert … on conflict (provider, event_id) do nothing returning` → `claimed`;
  2. otherwise `update … where org_id = p_org_id and (status = 'failed' or (status = 'processing' and lease_expires_at < now()))` with a new token and `attempts + 1` → `claimed`;
  3. otherwise read the row: another org → `22023`; `completed` → `duplicate`; else `in_progress`.
- **`complete_webhook_event(p_id, p_claim_token) returns boolean`**: sets `completed`, `completed_at`, `payload = null`, `claim_token = null`, only where the token matches.
- **`fail_webhook_event(p_id, p_claim_token, p_error text) returns boolean`**: validates the code (`22023`), sets `failed`, `last_error`, `claim_token = null`, keeping the payload for the retry.
- **`public.last_webhook_event_at(p_provider text) returns timestamptz`**: definer; checks `settings.view` first; then `max(received_at)` for `private.current_user_org_id()`.

**Step 4: Invariant exception.** In `000_invariants.test.sql`, the « every org-scoped table is audited » query gets:
```sql
     -- Operational logs, exempt on purpose (conventions §7): auditing them would copy recipient
     -- addresses and payloads into the append-only audit_log forever (Loi 25). Phase 3 design §2.5.
     and c.relname not in ('audit_log', 'webhook_events', 'email_log', 'scheduled_job_runs',
                           'notifications', 'notification_reads')
```
List the tables that do not exist yet now, so later tasks don't reopen the file. Write the same list in conventions §12, with the reason.

**Step 5: Run the database checks** (with and without the seed). **Step 6: Commit.**
```bash
git add supabase/migrations/<ts>_core_rate_limits_webhook_events.sql supabase/tests/database/016_core_rate_limits_webhook_events.test.sql \
  supabase/tests/database/000_invariants.test.sql supabase/tests/database/003_core_module_settings_secrets.test.sql \
  docs/standards/database-conventions.md src/core/supabase/database.types.ts
git commit -m "feat(db): rate limits and leased webhook claims"
```

**Review focus:**
- two concurrent claims (two `psql` sessions, `begin; select claim…`) → exactly one `claimed`;
- `explain` of `consume_rate_limit`'s upsert uses the primary key.

---

## Task 3.3: Scheduled jobs (database)

**Lane:** DB. **PS Hub reference:** `supabase/migrations/20260706223124_internal_edge_fn_invoke_via_sync_secret.sql`. Lessons kept: a dedicated internal secret, not the service-role key (PS Hub's Vault copy of that key drifted after a rotation and every call got a 401), and a missing secret logged rather than raised. Deviation: the project URL comes from Vault, not from code.

**Files:**
- Create: `supabase/migrations/<ts>_core_scheduled_jobs.sql`
- Create: `supabase/tests/database/017_core_scheduled_jobs.test.sql`
- Modify: `supabase/seed.sql` (local Vault secrets `project_url`, `internal_function_secret`)

**Schema:**
- **Extensions:** `create extension if not exists pg_cron;` and `create extension if not exists pg_net with schema extensions;` (follow the Supabase docs for the CLI's image; check the result with `\dx`).
- **`scheduled_jobs`** (global catalogue, seeded by migrations, not audited, like `permissions`):
  - columns:
    - `key text pk check (key ~ '^[a-z_]+\.[a-z0-9_]+$')`, `module_key → modules`, `label`, `description`;
    - `kind text check in ('sql','function')`;
    - `sql_function text check (sql_function ~ '^private\.job_[a-z0-9_]+$')`, `function_name text check (function_name ~ '^[a-z0-9-]+$')`, with exactly one set according to `kind`;
    - `cron_job_name text unique`, `local_hour smallint check (local_hour between 0 and 23)`, `is_maintenance boolean not null default false`, `created_at`;
  - read by `authenticated` (select grant; RLS `using (true)`).
- **`org_scheduled_jobs(org_id, job_key → scheduled_jobs, enabled boolean not null, updated_at, updated_by → profiles)`**, pk `(org_id, job_key)`:
  - audited;
  - select for org members with `settings.view`;
  - writes via RPC;
  - an `organizations` insert trigger, plus a backfill in this migration, creates a row per job; a trigger on `scheduled_jobs` insert adds the row for every org (same pattern as Task 2.20's template propagation);
  - default: `enabled = true` for maintenance jobs, `false` for business jobs.
- **`scheduled_job_runs`**:
  - columns: `id`, `job_key → scheduled_jobs`, `org_id → organizations (nullable: database-wide maintenance)`, `trigger text check in ('cron','manual')`, `started_at default now()`, `finished_at`, `status text check in ('running','ok','error','skipped')`, `detail text check (length(detail) <= 500)` (counts and error codes only, never personal data), `run_local_date date` (business jobs at a local hour);
  - indexes: `(job_key, started_at desc)`; `(org_id, started_at desc)`; `unique (job_key, org_id, run_local_date) where run_local_date is not null` (P3-22: once per clinic day);
  - RLS select: `(org_id = mine or org_id is null) and (select private.has_permission('settings.view'))`;
  - no client writes; exempt from audit (Task 3.2 list).

**Functions:**
- **`private.run_sql_job(p_key text, p_trigger text default 'cron') returns void`**:
  - validates the catalogue row (`kind = 'sql'`), resolves `to_regprocedure(sql_function || '()')` and refuses null;
  - inserts a `running` run (org null), then `execute pg_catalog.format('select %s()', v_proc)` into `v_detail`;
  - updates the run `ok` / detail;
  - `exception when others` → updates the run `error` with `detail = sqlstate` (never `sqlerrm`, which can quote values).

  The job functions are `private.job_<name>() returns text` (detail).
- **`private.invoke_job_function(p_key text, p_org_id uuid default null, p_trigger text default 'cron') returns void`**:
  - reads `project_url` and `internal_function_secret` from `vault.decrypted_secrets` (database-level secrets, not org secrets);
  - if either is missing: inserts an `error` run with detail `configuration_missing` and returns;
  - otherwise `net.http_post(url := project_url || '/functions/v1/' || function_name, headers := {Content-Type, Authorization: Bearer <secret>}, body := {job_key, org_id, trigger}, timeout_milliseconds := 10000)`.
- **Service-role RPCs** for the functions (Task 3.4 `jobs.ts`):
  - `public.list_job_orgs(p_key text) returns setof uuid`: orgs where the job is enabled and its module is enabled (`core` always). For `local_hour` jobs, it keeps only orgs where `extract(hour from now() at time zone o.timezone) = local_hour`;
  - `public.start_job_run(p_key text, p_org_id uuid, p_trigger text) returns uuid`: for `local_hour` jobs it sets `run_local_date = (now() at time zone tz)::date`, and returns **null** on the unique violation (already ran today) instead of raising;
    - *Review of Task 3.4:* it also returns **null** when the job is disabled for the org or its module is disabled (`private.module_enabled`), so a manual run (`run_scheduled_job_now` → `runJob` with an explicit `org_id`) can never run a disabled module's job. `run_local_date` is set **only when `p_trigger = 'cron'`**: a manual « Exécuter maintenant » never uses up the clinic day's cron slot. Tests: a manual run on a disabled module → null; a manual run then the cron run the same day → both run.
    - `runJob` calls it as `consume`-style typed wrappers from `_shared/jobs.ts` (Task 3.4, commit 672e577); `consume(client, LIMITS.x, keyParts)` takes a `LIMITS` entry and returns `{ allowed, hits, retryAfter, reason? }` (Tasks 3.8 and 3.20 use this form).
  - `public.finish_job_run(p_id uuid, p_status text, p_detail text) returns void`.
- **User RPCs:**
  - `list_scheduled_jobs()` (`settings.view`, definer, one query):
    - returns key, label, description, kind, is_maintenance, local_hour, `cron.job.schedule` (joined by `cron_job_name`), `enabled` for the caller's org, and the last run's `started_at` / `status` / `detail` (lateral `order by started_at desc limit 1` on the index);
    - hides jobs whose module is disabled for the org;
  - `list_scheduled_job_runs(p_job_key text default null, p_limit int default 20)` (security invoker, clamp 1–100);
  - `set_scheduled_job_enabled(p_key, p_enabled)`: `settings.manage`; refuses maintenance jobs (P0001 « Les tâches d'entretien restent toujours actives. ») and unknown keys (`22023`); audited through the table;
  - `run_scheduled_job_now(p_key)`: `settings.manage`. It uses `consume_rate_limit('jobs.run_now', sha256(org || key), 1, 300)`, and refuses with P0001 « Cette tâche vient d'être lancée. Réessayez dans quelques minutes. ». Then: `sql` kind → `private.run_sql_job(p_key, 'manual')`; `function` kind → `private.invoke_job_function(p_key, <caller org>, 'manual')`.
- **Jobs seeded here:** `core.rate_limits_cleanup` (sql, maintenance, cron `7 * * * *`: delete windows older than 24 h) and `core.webhook_events_purge` (sql, maintenance, `10 8 * * *`: null `payload` on completed rows, then delete rows older than 90 days).
  - Each is `select cron.schedule('<cron_job_name>', '<expr>', $$select private.run_sql_job('<key>')$$);`. `cron.schedule` with an existing name updates it, so the migration is idempotent.
  - Later tasks seed `core.email_log_retention`, `core.secure_links_purge`, `core.notifications_purge`, `core.storage_cleanup` and `core.signing_reconcile` the same way.

**Seed (local only):** append to `supabase/seed.sql`:
```sql
-- Local Vault secrets for pg_net → edge functions (fake values; staging gets real ones, plan « Mise en service »).
select vault.create_secret('http://supabase_kong_clinique-mana:8000', 'project_url', 'Local: Kong as seen from the DB container');
select vault.create_secret('local-dev-internal-function-secret', 'internal_function_secret', 'Local: matches supabase/functions/.env');
```
Verify the Kong host name with `docker ps --format '{{.Names}}'`.

**Tests** (`017_core_scheduled_jobs.test.sql`):
- extensions present;
- catalogue privileges;
- `org_scheduled_jobs` rows exist for orgs A and B after a fresh org insert;
- `set_scheduled_job_enabled`: maintenance refused; conseillère `42501`;
- `run_scheduled_job_now('core.rate_limits_cleanup')` as admin A inserts an `ok` run with `trigger = 'manual'`, then a second call → the P0001 message;
- `private.run_sql_job` on a job function that raises → an `error` run with `detail` = the SQLSTATE;
- `invoke_job_function` without Vault secrets (delete them as postgres inside the test) → an `error` run with `configuration_missing`;
- `list_job_orgs`: a business job seeded by the test with `local_hour` = the current UTC hour, for an org with timezone `UTC` → returned; with `America/Toronto` → not returned;
- `start_job_run` twice for the same local date → the second returns null;
- `list_scheduled_job_runs`: org B sees only its own rows and database-wide rows;
- the `cron.job` rows exist with the expected schedules.

**Commands:**
```bash
npm run db:reset && npm run db:test && npm run db:types
```
**Live probe (DB token):**
```bash
npx supabase functions serve --env-file supabase/functions/.env &   # no job function exists yet: expect a 404 run
psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -c "select private.invoke_job_function('core.webhook_events_purge')"
```
This only checks that `pg_net` reaches Kong (`select status_code from net._http_response order by id desc limit 1` → 404 for an unknown function, not a connection error).

**Commit:** `feat(db): scheduled jobs catalogue, per-org switch, run log, pg_cron and pg_net`.

---

## Task 3.4: Shared function foundations

**Lane:** F (no DB). **PS Hub reference:** `supabase/functions/_shared/sentry.ts` (to port into `report.ts`), `_shared/cors.ts`.

**Files:**
- Modify: `supabase/functions/deno.json` (add `"zod": "npm:zod@4.<same minor as package.json>"`), then update `deno.lock`: `deno cache --config supabase/functions/deno.json supabase/functions/_shared/http.ts` (without `--frozen`); commit the lock.
- Modify: `supabase/functions/_shared/auth.ts` (+ test): the `ErrorCode` union gains the P3-28 codes.
- Create, each with a `*.test.ts`:
  - `_shared/http.ts`: `readJson(req, schema, maxBytes = 65_536)` returns the parsed value or a 400/413 `Response`;
  - `_shared/deps.ts`: `defaultDeps()`;
  - `_shared/webhooks.ts`: `webhookResponse(status, body?)`, without CORS, `Cache-Control: no-store`; `claimEvent(client, input)` and `completeEvent` / `failEvent`, typed wrappers of the Task 3.2 RPCs returning `{ status: 'claimed', id, token } | { status: 'duplicate' } | { status: 'in_progress' }`;
  - `_shared/rate-limit.ts`: `clientIp(req)` (first `x-forwarded-for` hop, trimmed, else `'unknown'`); `hashKey(parts: string[], secret)` (HMAC-SHA256 with a key derived as `HMAC(INTERNAL_FUNCTION_SECRET, 'rate-limit-v1')`, 32 bytes); `consume(client, bucket, keyParts, max, windowSeconds)` → `{ allowed, retryAfter }`; and `LIMITS` (the constants file of design §2.6 and §3.2, with P3-18's free-recipient limit);
  - `_shared/jobs.ts`: `runJob(deps, req, jobKey, perOrg: (orgId: string, client) => Promise<string>)`. It runs `verifyServiceRoleAuth`, then reads `{ org_id?, trigger }`. The orgs are `[org_id]` for a manual run, else `list_job_orgs`. For each org: `start_job_run` (null → skip); `perOrg` inside try/catch; `finish_job_run` (`ok` + detail, or `error` + the error's `code` if it has one, else `internal`). It returns 200 with `{ runs: n }`;
  - `_shared/report.ts`: `reportError({ fn, code, ids?: Record<string, string> })`. It posts a Sentry envelope when `SENTRY_DSN` is set, otherwise `console.error(JSON.stringify({ fn, code, ids }))`. It refuses keys named `email`, `to`, `token` or `password` (throws in tests; drops them in production);
  - `_shared/testing/fake-supabase.ts`, `fake-fetch.ts`, `fixed-clock.ts`.
- Modify: `CLAUDE.md` §7:
  - the new category « Public token functions »: anon key required (`verify_jwt = true`), no user, the token authorizes, rate limit before any lookup, CORS restricted, org and module from the link row;
  - the new error codes;
  - the `handler.ts` / `index.ts` split;
  - « database through RPCs only »;
  - `_shared/report.ts`.

**Tests (write first):**
- `rate-limit.test.ts`:
  - `clientIp` with `'203.0.113.5, 10.0.0.1'` → `'203.0.113.5'`; with no header → `'unknown'`;
  - `hashKey` is deterministic, 32 bytes, and differs by secret;
  - `consume` maps the RPC result and fails **closed** on an RPC error (`allowed: false`, reported).
- `webhooks.test.ts`: maps the three claim statuses; `webhookResponse` has no `Access-Control-*` header.
- `jobs.test.ts`:
  - a wrong bearer → 401;
  - two orgs, the second's `perOrg` throws → two `finish_job_run` calls (`ok`, `error`);
  - `start_job_run` returning null → skipped, no `perOrg` call.
- `http.test.ts`: 65 537 bytes → 413; invalid JSON → 400 `invalid_request`; a schema error → 400 with no echo of the input.
- `report.test.ts`: no DSN → one console line without the `ids` values of forbidden keys.

**Commands:**
```bash
deno test --frozen --allow-env --config supabase/functions/deno.json supabase/functions/_shared/
npm run check:functions && npm run lint:functions && npm run test:functions
```
Expected: `ok | N passed | 0 failed`.

**Commit:** `feat(functions): shared foundations (errors, JSON bodies, webhooks, rate limits, jobs, reporting)`.

---

## Task 3.5: « Tâches planifiées » section

**Lane:** U (after Task 3.3 merges). **Files:**
- Create: `src/core/jobs/api.ts` + `api.test.ts`, `src/core/jobs/hooks.ts`, `src/core/jobs/schedule-label.ts` + test
- Create: `src/core/settings/pages/ScheduledJobsSettingsPage.tsx` + test
- Modify: `src/core/settings/sections.ts` (entry `{ id: 'jobs', path: 'taches-planifiees', labelKey: 'settings.sections.jobs', icon: CalendarClock, permission: 'settings.view', editPermission: 'settings.manage', group: 'plateforme', component: lazyPage(() => import('./pages/ScheduledJobsSettingsPage'), 'ScheduledJobsSettingsPage') }`), `src/i18n/fr-CA.json` (`settings.jobs.*`, `settings.sections.jobs` « Tâches planifiées »)

**Behaviour:**
- **One table** (labels, schedule, last run, status dot + word, last error): « Réussie », « Erreur », « Ignorée », « En cours ».
  - The **schedule label** comes from `scheduleLabel(cron, localHour, timezone)`:
    - `7 * * * *` → « Toutes les heures »;
    - `30 8 * * *` → « Tous les jours à 4 h 30 » in EDT. The hour is the conversion of 08:30 UTC on **today's date** through `formatInClinicTimezone`, so it follows DST;
    - `local_hour = 6` → « Tous les jours à 6 h (heure de la clinique) ».
  - **Error details:** `configuration_missing` → « Configuration manquante (voir Mise en service) »; a SQLSTATE → « Erreur technique (code 23514) ».
- **With `settings.manage`:**
  - a `Switch` per business job (Space or click only, #39), with toast confirmation;
  - « Exécuter maintenant » per job (outline button). Show the P0001 message as is; after success, refetch the runs.
- **History:** « Dernières exécutions » lists the last 20 runs (a `Sheet` per job or a second table), with « Charger plus ».
- **Read-only:** `ReadOnlyNotice` for viewers; no switches or buttons.

**Tests:**
- `schedule-label.test.ts`: hourly; daily in winter and summer (fake clock on 2026-01-15 and 2026-07-15) gives 3 h 30 and 4 h 30; `local_hour`.
- Page test:
  - `settings.view` → read-only, no button;
  - `settings.manage` → the switch is disabled for maintenance rows, and toggling a business row calls `setScheduledJobEnabled` once;
  - « Exécuter maintenant » error → the P0001 message in a toast;
  - two queries run in parallel on mount (`listScheduledJobs`, `listScheduledJobRuns`): assert both mocks were called before either resolves.

**Commit:** `feat(settings): Tâches planifiées section`.

---

# Batch 3b — Email and in-app notifications

## Task 3.6: Email schema

**From lane F (Task 3.7 review):** the placeholder rule is `\{\{([^{}\r\n]*)\}\}` (exported as `PLACEHOLDER_SOURCE` in `_shared/email/render.ts`) with the captured path trimmed in code (linear; no newline inside a placeholder). `save_email_template`'s placeholder check in SQL must use exactly this rule so validation and rendering agree; probe it with `{{` + 10 000 spaces (must return fast). `get_email_context` must return `why_line`. Lane F's compose step maps `unknown_variable` → `missing_variable` and reports an invalid clinic timezone as a configuration error. **RPC contract assumed by lane F's send path (Task 3.8, commit 6ae5810; the comments in `_shared/email/send.ts` are authoritative), match it or change both:** `get_email_context(p_org_id uuid, p_template_key text) returns jsonb` (unknown key → 22023) with `{ module_key, module_enabled, timezone, template: { key, version, subject, body, button_label, why_line, variables[{path,label,sample,required,kind}], view_permission, recipient_mode 'subject'|'free', allows_attachments }, sender: { from_name, from_address, reply_to }, clinic: { name, address_line1, address_line2, city, province, postal_code, phone, website, privacy_officer_name, privacy_officer_email } }`; `queue_email(p_org_id, p_template_key, p_template_version int, p_to_email, p_to_profile_id, p_subject_type, p_subject_id, p_view_permission, p_sent_by, p_attachment_count smallint) returns uuid` (status `queued`); `mark_email_sent(p_id, p_resend_id, p_attempts int)`; `mark_email_failed(p_id, p_error_code, p_attempts int)`; all service-role only. **From the Task 3.8 review (DB side):** (1) `apply_email_event` treats `failed` as final **except** when `error_code = 'provider_unavailable'` (outcome unknown: timeout or network error on the last attempt): a later `email.sent`/`email.delivered` webhook may move it forward, so the timeline does not show a false failure and « Renvoyer » does not resend a delivered email. (2) A maintenance step (in the Task 3.3 jobs or the `email_log` retention job) moves rows still `queued` after 15 minutes to `failed` with `error_code = 'provider_unavailable'` (overridable the same way), so a function killed between queue and mark leaves no row stuck. (3) `email_sender_settings.reply_to` gets the same single-mailbox format check as `from_address`, and `from_address`'s check refuses `<>,` and whitespace in the local part.

**Lane:** DB. **Files:**
- Create: `supabase/migrations/<ts>_core_email.sql`
- Create: `supabase/tests/database/018_core_email.test.sql`
- Modify: `supabase/seed.sql`: the local fake org secret `resend_webhook_secret` = `whsec_bG9jYWwtZGV2LXJlc2VuZC13ZWJob29r` (base64 of `local-dev-resend-webhook`). Insert it the way `set_org_secret` stores it: `vault.create_secret(value, 'org:<org_id>:resend_webhook_secret')` plus the `org_secrets` row; the seed runs as postgres, without a JWT. No Resend API key is seeded, because Mailpit needs none.
- Modify: `supabase/tests/database/003_core_module_settings_secrets.test.sql` (`functions_are`)

**Tables** (design §2.2–§2.4, with P3-18, P3-21):

| Table | Shape | Access |
|---|---|---|
| `email_template_defaults` | `key text pk check (key ~ '^[a-z_]+\.[a-z0-9_]+$')`, `module_key → modules` (the key prefix must equal `module_key`, check), `label`, `description`, `why_line` (« Pourquoi ce courriel »), `subject` (≤ 200, no newline), `body` (≤ 10 000), `button_label` (≤ 60, nullable), `variables jsonb check (jsonb_typeof = 'array' and jsonb_array_length <= 40)` with items `{path, label, sample, required, kind: text\|date\|datetime\|url}`, `view_permission → permissions`, `recipient_mode text default 'subject' check in ('subject','free')`, `allows_attachments boolean default false`, `updated_at` | select to `authenticated` (`using (true)`); changed by migrations only; not audited |
| `email_templates` | `org_id`, `key → email_template_defaults`, `subject`, `body`, `button_label`, `version int not null default 1`, `updated_at`, `updated_by → profiles`; pk `(org_id, key)` | select: own org and `settings.view`; writes via RPC; audited |
| `email_settings` | `org_id pk → organizations`, `from_name` (1–80), `from_address`, `reply_to` (nullable), `sending_domain` (default `gestion.cliniquemana.com`), `updated_at`, `updated_by`; check `from_address ~* ('^[^@\s]+@' || replace(sending_domain, '.', '\.') || '$')` (a table check; name it `email_settings_from_address_check`); one row per org, created by an `organizations` insert trigger + backfill (`from_name` = org name, `from_address` = `no-reply@<domain>`, `reply_to` = `organizations.email`) | select: own org and `settings.view`; writes via RPC; audited |
| `email_log` | columns of design §2.3, plus `attachment_count smallint default 0`; `status check in ('queued','sent','delivered','delivery_delayed','bounced','complained','failed')`; `error_code check (~ '^[a-z0-9_]{1,64}$')`; `resend_id text unique`; `to_email` nullable (anonymised) | select (RLS below); no client writes; exempt from audit (Task 3.2 list) |

**`email_log` policy and indexes** (P3-21):
```sql
create policy email_log_select on public.email_log for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and (view_permission = any ((select private.current_permission_keys())::text[])
         or (select private.has_permission('settings.email_manage')))
  );
create index email_log_org_created_idx on public.email_log (org_id, created_at desc);
create index email_log_subject_idx on public.email_log (org_id, subject_type, subject_id, created_at desc);
create index email_log_retention_idx on public.email_log (created_at) where to_email is not null;
-- + FK indexes (template_key, to_profile_id, sent_by) as 000_invariants requires.
```

**RPCs:**
- **User-facing:**
  - `set_email_sender(p_from_name, p_from_address, p_reply_to)`: `settings.email_manage`; trims; empty `reply_to` → null.
  - `set_email_sending_domain(p_domain)`: `settings.integrations_manage`; domain regex `^[a-z0-9-]+(\.[a-z0-9-]+)+$`; also rewrites `from_address`'s domain in the same update, so the check holds.
  - `list_email_templates()` (`settings.view`, definer, one query): the effective rows (override joined on default) for the caller's org, where the template's module is `core` or enabled: `key, module_key, label, description, is_custom, version, updated_at, updated_by_name, subject, body, button_label, variables`.
  - `save_email_template(p_key, p_subject, p_body, p_button_label)` (`settings.email_manage`):
    - extracts every `{{ … }}` with `regexp_matches(p_subject || ' ' || p_body || ' ' || coalesce(p_button_label,''), '\{\{\s*([^}]*?)\s*\}\}', 'g')`;
    - each must equal a `variables[].path` of the default, else P0001 « Variable inconnue : {{x}} »;
    - a lone `{{` or `}}` left after removing valid placeholders → P0001 « Accolades non fermées dans le texte. »;
    - length checks with French messages;
    - upserts and bumps `version`.
  - `reset_email_template(p_key)` (`settings.email_manage`): deletes the override (audited delete).
  - `list_email_log(p_template_key text default null, p_status text default null, p_from timestamptz default null, p_to timestamptz default null, p_before timestamptz default null, p_limit int default 50)`: security invoker, so RLS applies; clamped; returns label (joined), status, `to_email`, `subject_type`, `subject_id`, timestamps, `error_code`.
  - `list_subject_emails(p_subject_type text, p_subject_id uuid, p_limit int default 50)`: security invoker; P3-26.
- **Service role only** (used by `_shared/email`):
  - `get_email_context(p_org_id uuid, p_template_key text) returns jsonb`. One round trip, no waterfall. It returns:
    - the effective template, its catalogue flags and `variables`;
    - `module_key` and `module_enabled` (`module_enabled_for_org`);
    - the sender (`email_settings`);
    - the clinic footer: `name`, address lines, phone, website and `privacy_officer_*` (column names as Phase 2 Task 2.7/2.10 created them; read the migration);
    - `timezone`.

    Unknown key → `22023`.
  - `queue_email(p_org_id, p_template_key, p_template_version, p_to_email, p_to_profile_id, p_subject_type, p_subject_id, p_view_permission, p_sent_by, p_attachment_count) returns uuid`.
  - `mark_email_sent(p_id, p_resend_id, p_attempts)` and `mark_email_failed(p_id, p_error_code, p_attempts)`.
  - `apply_email_event(p_org_id uuid, p_email_log_id uuid, p_resend_id text, p_status text, p_at timestamptz) returns text`:
    - returns `applied` / `ignored` / `not_found`;
    - finds the row by id, else by `resend_id`; another org → `not_found`;
    - **monotonic** order `queued < sent < delivery_delayed < delivered`; `bounced`, `complained` and `failed` are final; a late `delivered` after `bounced` is ignored;
    - sets `last_event_at`.
  - `count_org_emails_today(p_org_id) returns int` (clinic day; feeds the 80 % warning).
- **Job:** `core.email_log_retention` (sql, maintenance, `30 8 * * *`): `update … set to_email = null where to_email is not null and created_at < now() - interval '24 months'`, in batches of 5 000 (loop until fewer rows), so one run never holds a long lock.
- **Job (from the Task 3.8 review; deferred here by Task 3.3 because `email_log` does not exist before this task):** `core.email_log_stale_queued` (sql, maintenance, `*/5 * * * *`): `update … set status = 'failed', error_code = 'provider_unavailable' where status = 'queued' and created_at < now() - interval '15 minutes'`, with a partial index `(created_at) where status = 'queued'`. Seed it like the Task 3.3 jobs (`scheduled_jobs` row + `cron.schedule`). Test: a `queued` row 16 minutes old becomes `failed` / `provider_unavailable`; one 14 minutes old stays `queued`.
- **Seed:** `core.staff_invite` in `email_template_defaults`:
  - label « Invitation d'un membre du personnel », `why_line` « Vous recevez ce courriel parce que la clinique vous invite à créer votre accès. »;
  - subject « Votre accès à {{clinic.name}} », button « Créer mon accès »;
  - variables `invitee.display_name` (required), `inviter.display_name` (required), `clinic.name` (required), `invitation.expires_at` (datetime, required);
  - `view_permission` `users.view`;
  - body (3 short paragraphs, no clinical wording) written in the migration.

**Tests** (`018_core_email.test.sql`):
- **Privileges:**
  - clients have `SELECT` only on the four tables (and nothing on `email_log` columns beyond select);
  - the service RPCs run for `service_role` only.
- **Effective template:**
  - `list_email_templates()` without an override → `is_custom = false`;
  - after `save_email_template` → custom, `version = 2` on the second save; an audit row exists;
  - `reset_email_template` → default again.
- **Placeholder validation:** unknown → the exact P0001 text; unclosed → the exact text; a known placeholder with spaces `{{ clinic.name }}` → accepted.
- **Module filter:** a test default with `module_key = 'professionals'` is hidden when the module is off and listed when it is on.
- **Sender:**
  - `set_email_sender` with `from_address = 'x@gmail.com'` → `23514`;
  - the adjointe with `settings.email_manage` (override) can set the sender but not the domain (`42501`);
  - changing the domain rewrites `from_address`.
- **`email_log` RLS:** a `users.view` row is visible to an admin and to a `users.view` override holder, invisible to the conseillère, visible to a `settings.email_manage`-only holder; org B sees nothing.
- **`apply_email_event`:** `sent → delivered` applied; `bounced` then `delivered` → `ignored`, status stays `bounced`; another org → `not_found`.
- **Retention:** a row dated 25 months ago loses `to_email` after `select private.job_email_log_retention()`; a row dated 23 months ago keeps it.
- `get_email_context` returns `module_enabled = false` for a disabled module's template.

**Explain probe (review):**
- insert 10 000 `email_log` rows for org A;
- `explain (analyze, buffers) select * from public.list_email_log(p_limit => 50)` as admin A → uses `email_log_org_created_idx`.

**Commit:** `feat(db): email templates, sender settings and send log`.

---

## Task 3.7: Email rendering and layout (`_shared/email/`)

**Lane:** F. **Files** (all with tests):
- `supabase/functions/_shared/email/markup.ts`: the body language.
  - Paragraphs are separated by a blank line; `**bold**`; lines starting with `- ` form a bullet list. Nothing else is interpreted: `<`, `>` and `&` are always escaped.
  - Exports `toHtml(text)` and `toText(text)`.
- `supabase/functions/_shared/email/render.ts`:
  ```ts
  export interface TemplateVariable { path: string; label: string; sample: string; required: boolean; kind: 'text' | 'date' | 'datetime' | 'url' }
  export interface RenderInput {
    subject: string; body: string; buttonLabel: string | null
    variables: TemplateVariable[]
    values: Record<string, unknown>        // nested object; read by dot path
    timezone: string                       // clinic timezone (organizations.timezone)
    sample?: boolean                       // preview/test: missing values use `sample`
  }
  export type RenderResult =
    | { ok: true; subject: string; html: string; text: string; buttonLabel: string | null }
    | { ok: false; code: 'missing_variable' | 'unknown_variable'; path: string }
  export function renderTemplate(input: RenderInput): RenderResult
  ```
  - **Rules:**
    - unknown placeholder → `unknown_variable` (a defence after SQL validation);
    - a required value missing and not `sample` → `missing_variable` (fail closed);
    - values are HTML-escaped in the HTML part and plain in the text part;
    - the subject is plain text with newlines removed.
  - **Formatting by `kind`:**
    - `datetime` → `Intl.DateTimeFormat('fr-CA', { timeZone, dateStyle: 'long', timeStyle: 'short' })` (« 15 octobre 2026 à 14 h 30 »; match the web app's `formatClinicDateTime` output, and copy its formatting decisions);
    - `date` → the date-only path, **no timezone conversion**: parse `YYYY-MM-DD` as a calendar date (« 1 janvier 2020 »; mirrors `formatDateOnly`);
    - `url` → only `https:` (or `http://localhost` when `APP_URL` is local), else `missing_variable`.
- `supabase/functions/_shared/email/layout.ts`: `renderLayout({ preheader, contentHtml, button?: { label, href }, footer: ClinicFooter, whyLine, wordmarkUrl }) → { html }` and `renderLayoutText(...)`.
  - Table-based layout, inline styles, `lang="fr-CA"`, max width 560.
  - Design-system tokens: teal `#1E837C` button, wine wordmark image (alt « Clinique MANA »), Inter stack `Inter, -apple-system, Segoe UI, Helvetica, Arial, sans-serif`, text `#3F3F46`, secondary `#6B6B6E`, hairline `#E4E4E7`. Copy the exact values from `docs/design-system/design_system/tokens/colors.css`.
  - The button `href` is HTML-attribute-escaped. Below the button: « Si le bouton ne fonctionne pas, copiez ce lien : » + the URL as text.
  - **Footer:** clinic name, address, phone, website; « Confidentialité : <privacy officer name, email> »; the why line.
- `supabase/functions/_shared/email/compose.ts`: `composeEmail(context, input) → { subject, html, text }`. It combines render, layout and footer, and adds the « [Test] » subject prefix in test mode.
- Asset: `public/email/wordmark.png` (the PNG export of the wine wordmark from `docs/design-system/assets/`, about 2× its 120 px display width). Static and the same for everyone (P3-10).

**Tests** (`render.test.ts`, `markup.test.ts`, `layout.test.ts`):
- **Escaping:** `<script>` in a value appears as `&lt;script&gt;` in HTML, raw in the text part, and never as a tag.
- **Variables:** unknown → `unknown_variable`; missing required → `missing_variable`; missing optional → empty string.
- **Dates:**
  - `datetime` `2026-07-15T18:30:00Z` in `America/Toronto` → contains « 14 h 30 »;
  - `date` `2020-01-01` → « 1 janvier 2020 » (the CLAUDE.md §9 bug case);
  - `date` `2026-03-08` → « 8 mars 2026 » with the timezone `Pacific/Kiritimati` (proves no shift).
- **Markup:** bullets, bold, and no injection through `**<b>**`.
- **Layout:** the text part has no HTML; the button href is escaped (`"` in the URL); the footer lists the privacy officer; no `<img>` other than the wordmark; no tracking parameter.
- **Snapshot:** one `assertSnapshot` of the staff-invite HTML with sample values (`@std/testing/snapshot`, add to `deno.json`), to catch layout regressions in review.

**Commit:** `feat(functions): email markup, rendering and branded layout`.

---

## Task 3.8: Email transport and the send path

**Lane:** F. **PS Hub reference:** `supabase/functions/send-quote-signing-email/index.ts` (the Resend `POST https://api.resend.com/emails` request shape, `from`/`reply_to`/`tags`). Deviations: an `Idempotency-Key` header and retries, which PS Hub does not send.

**Files** (with tests):
- `supabase/functions/_shared/email/transport.ts`:
  ```ts
  export interface OutgoingEmail {
    from: string; to: string; replyTo: string | null; subject: string; html: string; text: string
    idempotencyKey: string                  // = email_log.id
    tags: { name: string; value: string }[] // [{ name: 'email_log_id', value: id }]
    attachments: { filename: string; content: Uint8Array; contentType: 'application/pdf' }[]
  }
  export type TransportResult =
    | { ok: true; providerId: string; attempts: number }
    | { ok: false; code: 'provider_rejected' | 'provider_unavailable' | 'provider_rate_limited' | 'invalid_recipient'; attempts: number }
  export interface EmailTransport { send(email: OutgoingEmail): Promise<TransportResult> }
  export function resendTransport(apiKey: string, fetchFn: typeof fetch, sleep?: (ms: number) => Promise<void>): EmailTransport
  export function mailpitTransport(baseUrl: string, fetchFn: typeof fetch): EmailTransport
  export function consoleTransport(): EmailTransport   // logs the email_log id and subject length only
  export function transportFromEnv(env, fetchFn, apiKey: string | null): EmailTransport | { error: 'not_configured' }
  ```
  - **Resend:**
    - `Authorization: Bearer <key>`, `Idempotency-Key`;
    - attachments as base64 `content` + `filename`;
    - on 429 or 5xx (or a network error), up to 3 attempts with `sleep(500)` then `sleep(2000)`;
    - a 4xx other than 429 → no retry;
    - `422` with `validation_error` on `to` → `invalid_recipient`.
    - **The response body is never logged or returned:** it can quote the address.
  - **Mailpit:**
    - `POST {MAILPIT_URL}/api/v1/send` with `{ From: { Email, Name }, To: [{ Email }], Subject, HTML, Text, Tags, Attachments: [{ Filename, Content: base64, ContentType }] }`;
    - returns Mailpit's `ID` as `providerId`.
    - **Verify** that the CLI's Mailpit exposes the send API (live probe below). If it does not, `transportFromEnv` falls back to `consoleTransport` with a startup warning, and the plan's browser checks use the logs instead (note it in the status doc).
- `supabase/functions/_shared/email/send.ts`:
  ```ts
  export interface SendTemplatedEmailInput {
    orgId: string
    templateKey: string
    to: { email: string; profileId: string | null }
    subject: { type: string; id: string }
    values: Record<string, unknown>
    actionUrl: string | null              // the button URL, from code only
    sentBy: string | null
    explicitResend?: boolean              // « Renvoyer »: skips the 60 s same-address limit
    freeRecipient?: boolean               // allowed only when recipient_mode = 'free'
    attachments?: OutgoingEmail['attachments']
    test?: { callerId: string }           // « M'envoyer un test »: sample values, [Test] prefix
  }
  export type SendResult =
    | { ok: true; emailLogId: string }
    | { ok: false; emailLogId: string | null; code: 'rate_limited' | 'not_configured' | 'module_disabled'
        | 'missing_variable' | 'recipient_not_allowed' | 'attachment_not_allowed' | 'provider_error' | 'invalid_recipient' }
  export async function sendTemplatedEmail(deps: EmailDeps, input: SendTemplatedEmailInput): Promise<SendResult>
  ```
  **Order:**
  1. `Promise.all([get_email_context, get_org_secret(org, 'resend_api_key') when EMAIL_TRANSPORT = 'resend'])`.
  2. `module_enabled` false → `module_disabled`.
  3. Catalogue checks: `freeRecipient` requires `recipient_mode = 'free'`; attachments require `allows_attachments`, at most 3, ≤ 10 MB in total, and `%PDF` magic bytes (else `attachment_not_allowed`).
  4. Rate limits, run in parallel with `Promise.all` over `consume`:
     - org daily (`emails.org_day`, 500/86 400);
     - same template + address (`emails.same_address`, 1/60, skipped when `explicitResend`);
     - test sends (`emails.test`, 10/3 600 per caller) or free-recipient sends (`emails.free_recipient`, 20/3 600 per sender).

     Any refusal → `rate_limited`. When the daily count passes 400, call `reportError({ code: 'email_daily_80_percent' })` once (the `hits` value equals 401).
  5. `composeEmail` → on failure, `missing_variable` (nothing queued).
  6. `queue_email` → id.
  7. `transport.send` with `idempotencyKey = id`, `tags = [{ name: 'email_log_id', value: id }]`.
  8. `mark_email_sent` / `mark_email_failed`. A provider failure → `provider_error` (or `invalid_recipient`), and `reportError` with the code and the email_log id.

**Tests:**
- `transport.test.ts` (with `fake-fetch`):
  - 429, 500, then 200 → `ok`, `attempts = 3`, sleeps `[500, 2000]`;
  - 400 → no retry, `provider_rejected`;
  - each request has the same `Idempotency-Key`;
  - the tag is present;
  - an attachment is base64;
  - a network error, then 200 → ok;
  - the Mailpit payload shape.
- `send.test.ts` (with `fake-supabase` + `fake-fetch`):
  - happy path: RPC call order `get_email_context` ∥ `get_org_secret` → `consume_rate_limit` ×2 → `queue_email` → Resend → `mark_email_sent`;
  - the module is disabled → no queue;
  - the same address within 60 s → `rate_limited`, unless `explicitResend`;
  - a free recipient on a `subject` template → `recipient_not_allowed`;
  - a non-PDF attachment → `attachment_not_allowed`;
  - a missing required variable → no queue, no fetch;
  - a Resend 500 three times → `mark_email_failed('provider_unavailable')`, `provider_error`;
  - test mode → the subject starts with « [Test] » and sample values fill the variables. The recipient is the **caller's profile email**: the function passes `auth.access.email` from `verifyAuth`'s access payload, never a body field (asserted in Task 3.10);
  - no `resend_api_key` with `EMAIL_TRANSPORT=resend` → `not_configured`, nothing queued.

**Live probe (DB token, after Task 3.6 has merged):** with `functions serve` running, call `sendTemplatedEmail` through a temporary script in your scratchpad (not committed), with the service key from `npx supabase status -o env`, for `core.staff_invite` and sample values. Open Mailpit (`http://127.0.0.1:55324`): the email is there, HTML and text parts, wordmark (it 404s until `npm run dev` serves `/email/wordmark.png`; acceptable), footer with the seed clinic identity.

**Commit:** `feat(functions): Resend and Mailpit transports and the templated send path`.

---

## Task 3.9: Svix signature verification

**Lane:** F. **PS Hub reference:** `supabase/functions/_shared/svix-webhook.ts` + `svix-webhook.test.ts`. Port it, replacing its local `constantTimeEqual` with our `timingSafeEqualBytes`.

**Files:** `supabase/functions/_shared/svix.ts` + `svix.test.ts`.
```ts
export interface SvixInput { rawBody: string; id: string | null; timestamp: string | null; signature: string | null; secret: string; nowSeconds?: number; toleranceSeconds?: number }
export async function verifySvix(input: SvixInput): Promise<boolean>
```
Rules:
- the secret is `whsec_<base64>` (strip the prefix) or raw base64;
- the signed content is `${id}.${timestamp}.${rawBody}`, HMAC-SHA256;
- the header holds space-separated `v1,<base64>` entries, any of which may match;
- `|now - timestamp| > 300` → false;
- missing headers or an empty secret → false (fail closed).

**Tests:**
- Svix's published test vector:
  - secret `whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw`;
  - id `msg_p5jXN8AQM9LWM0D4loKWxJek`;
  - timestamp `1614265330`;
  - body `{"test": 2432232314}`;
  - expected `v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=`;
  - with `nowSeconds = 1614265330` → true.

  This is the example from Svix's « verifying manually » docs. If it fails, check the payload's exact whitespace against those docs before changing code. In addition, generate signatures in the test the way PS Hub's `svix-webhook.test.ts` does (`crypto.subtle` HMAC over a random secret).
- Tolerance: ±301 s → false.
- Multiple signatures, where the second matches → true.
- A tampered body → false.
- No `whsec_` prefix → still verifies.
- Empty secret → false.

**Commit:** `feat(functions): Svix webhook verification (ported from PS Hub)`.

---

## Task 3.10: Email functions

**Lane:** F (after Task 3.6 merges). The `[functions.*]` blocks in `config.toml` are added by the DB lane in the same merge window: ask the coordinator, or add them in this task's commit if the DB lane agrees.

**Files:** `supabase/functions/{email-preview,email-test-send,send-email,resend-webhook}/{index.ts,handler.ts,handler.test.ts}`, and `supabase/config.toml`:
```toml
[functions.email-preview]
verify_jwt = false
[functions.email-test-send]
verify_jwt = false
[functions.send-email]
verify_jwt = false
[functions.resend-webhook]
verify_jwt = false
```

**Behaviour:**
- **`email-preview`:**
  - `handleCors`; `verifyAuth(req, { permission: 'settings.email_manage' })`;
  - body `{ template_key, subject, body, button_label }` (Zod: lengths as in SQL);
  - `get_email_context` (with the caller's org); a disabled module → 403 `module_disabled`;
  - `composeEmail` with `sample: true` and the **draft** text;
  - returns `{ subject, html, text }`; the HTML is ≤ 200 KB, else 413.
- **`email-test-send`:**
  - same auth;
  - body `{ template_key, subject?, body?, button_label? }` (the draft, if any);
  - `sendTemplatedEmail` in test mode to `auth.access.email` (subject type `email_test`, id = the caller);
  - result codes map to HTTP statuses: `rate_limited` 429; `not_configured` 503; `provider_error` 502; `missing_variable` 400.
- **`send-email`:**
  - `verifyServiceRoleAuth`;
  - body `{ org_id, template_key, to_profile_id?, to_email, subject: { type, id }, values, action_url, explicit_resend? }` (internal callers only: cron and Phase 4 jobs);
  - `org_id` is accepted here because the caller is the service itself; the module gate comes from `get_email_context`.
- **`resend-webhook`:**
  1. `org` from `?org=`, a UUID, else 400.
  2. Read the raw body (≤ 64 KB).
  3. `get_org_secret(org, 'resend_webhook_secret')`: none → 401 (fail closed, `reportError('resend_webhook_secret_missing')`).
  4. `verifySvix` → false → 401.
  5. Parse `{ type, created_at, data: { email_id, tags } }`; `email_log_id` from `data.tags` (object or array form, as Resend sends).
  6. `claimEvent('resend', svix-id, org, type, { type, email_id, email_log_id })`. Store only ids, never `data.to`: the payload is minimised before storage. `duplicate` → 200; `in_progress` → 409.
  7. Map the type to a status: `email.sent` → sent, `email.delivered` → delivered, `email.delivery_delayed` → delivery_delayed, `email.bounced` → bounced, `email.complained` → complained; others are acked (200) and completed.
  8. **Module gate, in the same RPC:** `apply_email_event` reads the row's `module_key` and checks `module_enabled_for_org` itself before applying. A disabled module returns `ignored`, which the function acks with 200 and completes, so Resend does not retry forever. This is the design's `requireModuleForOrg(org, email_log.module_key)` without an extra round trip. Say so in the function header, and add a Task 3.6 pgTAP case (a disabled module's row → `ignored`, status unchanged).
  9. `apply_email_event` → complete. An exception → `failEvent(code)` → 500 (Resend retries).

  Responses via `webhookResponse` (no CORS).

**Tests** (handler level, fake deps):
- **Preview:**
  - no auth → 401; the conseillère → 403;
  - an unknown placeholder in the draft → 400 `invalid_request`, with the French message from the render code mapped in the UI;
  - an HTML response contains no `<script>` from the input.
- **Test send:** the recipient is always the caller's address, even if the body has `to`; the 11th test in an hour → 429.
- **`send-email`:** a user JWT → 401.
- **Webhook:**
  - a bad signature → 401, and no RPC is called after `get_org_secret`;
  - no secret → 401;
  - a duplicate → 200 without `apply_email_event`;
  - `in_progress` → 409;
  - `email.bounced` → `apply_email_event(status: 'bounced')`;
  - an unknown type → 200 + complete;
  - the claim payload has no `to` field;
  - another org's `email_log_id` → `not_found` → 200 + complete (no retry; reported).

**Live probe (DB token):**
1. `npx supabase functions serve --env-file supabase/functions/.env`.
2. Get an admin JWT: sign in with `curl` against `http://127.0.0.1:55321/auth/v1/token?grant_type=password`, with the seed password from `supabase/seed.sql`'s header.
3. `curl` `email-test-send` → 200; Mailpit shows « [Test] Votre accès à … ».
4. Webhook: `node scripts/send-test-webhook.mjs resend --org <seed org id> --email-log <id> --type email.delivered` (written in this task: signs with the local secret `whsec_bG9jYWwtZGV2LXJlc2VuZC13ZWJob29r`, seeded by the DB lane in `seed.sql` as the org secret `resend_webhook_secret`). The row becomes `delivered`.
5. Run it again → still `delivered`, and `webhook_events` has one row.

Record the outputs (status codes only) in the task report.

**Commit:** `feat(functions): email preview, test send, internal send and the Resend webhook`.

---

## Task 3.11: « Courriels » section

**Lane:** U (after Tasks 3.6 and 3.10 merge). **Files:**
- Create: `src/core/email/api.ts` + test, `src/core/email/hooks.ts` (`emailKeys`), `src/core/email/schemas.ts` + test
- Create: `src/core/settings/pages/EmailSettingsPage.tsx` + test, `src/core/email/components/{SenderCard,EmailKeysCard,TemplatesTable,TemplateEditorSheet,EmailPreview,EmailLogTable}.tsx` (+ tests for the editor and the log)
- Create: `src/core/settings/components/SecretField.tsx` + test (write-only « Configurée ✓ / Remplacer », reused by Task 3.34)
- Modify: `sections.ts` (entry `{ id: 'email', path: 'courriels', icon: Mail, permission: 'settings.view', editPermission: 'settings.email_manage', group: 'plateforme', component: lazyPage(…, 'EmailSettingsPage') }`), `fr-CA.json` (`settings.email.*`, `settings.sections.email` « Courriels »)

**Page:** real tabs (decision #35): « Réglages », « Modèles », « Historique d'envoi » (the last only with `settings.email_manage`).
- **Réglages:**
  - **SenderCard:** from name, from address, reply-to.
    - The domain part of « Adresse d'envoi » is shown read-only (`@gestion.cliniquemana.com`); the user types the local part only.
    - Zod mirrors SQL: local part `^[a-z0-9._-]{1,64}$`; reply-to an email or empty.
    - Outline « Enregistrer » until dirty (#34).
  - **EmailKeysCard** (`settings.integrations_manage`):
    - « Domaine d'envoi » (with the `set_email_sending_domain` confirm « Changer le domaine change aussi l'adresse d'envoi. »);
    - « Clé d'API Resend » (`SecretField` → `set_org_secret('resend_api_key')`);
    - « Secret du webhook » (`resend_webhook_secret`);
    - « Adresse du webhook » read-only with « Copier » (`${VITE_SUPABASE_URL}/functions/v1/resend-webhook?org=${org_id}`);
    - « Dernier événement reçu le … » / « Aucun événement reçu » (`last_webhook_event_at('resend')`, through `formatClinicDateTime`).
  - **Parallel loading:** the queries of both cards start together. No query depends on another's result except the secret key list, which is part of the same `list_org_secret_keys()` call already used by Phase 2.
- **Modèles:**
  - grouped by module (`modules.<key>` labels): label, « Personnalisé » / « Par défaut », last change (`formatClinicDateShort` + name);
  - a row opens **`TemplateEditorSheet`**:
    - subject, body (textarea), button label;
    - the cheat-sheet of variables (label, `{{path}}`, insert at cursor);
    - the live preview: `email-preview` debounced 400 ms, query key = `[…, key, hash(draft)]`, `placeholderData: keepPreviousData`. Rendered in `<iframe sandbox="" srcDoc={html} title="Aperçu du courriel">` at 600 px and at 375 px (« Ordinateur » / « Téléphone » toggle);
    - « M'envoyer un test » (toast « Courriel test envoyé à {email} »);
    - « Rétablir le texte par défaut » (AlertDialog confirmation);
    - « Enregistrer ».
  - The sheet uses the unsaved-changes guard. P0001 messages from `save_email_template` show under the form.
- **Historique d'envoi:**
  - filters: template, status, period (« 7 derniers jours », « 30 jours », « Tout »);
  - columns: date, template label, recipient (`to_email` or « Anonymisé »), status dot + word, with French labels (« En file », « Envoyé », « Livré », « Retardé », « Adresse introuvable » for bounced, « Signalé comme indésirable », « Échec »), error code shown as « Code : … »;
  - keyset « Charger plus » (`p_before` = the last row's `created_at`).
- **Read-only** (the adjointe with `settings.view`):
  - `ReadOnlyNotice`; the Réglages fields are `readOnly`; the editor opens in read-only with its preview; no test or save;
  - Historique is hidden without `settings.email_manage`.
- **Error mapping:** function codes → `settings.email.errors.<code>`:
  - `not_configured` « L'envoi de courriels n'est pas encore configuré. »;
  - `rate_limited` « Trop d'envois en peu de temps. Réessayez dans quelques minutes. »;
  - `provider_error` « Le service d'envoi n'a pas répondu. Réessayez. »;
  - `missing_variable` « Une variable obligatoire est vide. ».

**Tests:**
- Permission matrix: admin (all editable), adjointe (read-only, no Historique tab), adjointe + `settings.email_manage` (templates editable, keys card read-only).
- **`TemplateEditorSheet`:**
  - typing triggers one preview call after the debounce (fake timers), not one per key;
  - the iframe has `sandbox=""` and no `allow-scripts`;
  - the cheat-sheet inserts `{{clinic.name}}` at the cursor;
  - reset asks for confirmation;
  - a save error shows the P0001 text.
- **`SecretField`:** never renders a stored value; « Remplacer » reveals an empty password input; submit calls `setOrgSecret` once.
- **`EmailLogTable`:** a `bounced` row reads « Adresse introuvable »; « Charger plus » passes `p_before`.

**Browser check** (U lane; needs the token only while the DB lane is not resetting):
- as admin, edit `core.staff_invite`: preview at both widths;
- « M'envoyer un test »: Mailpit shows it;
- reset;
- as the adjointe: read-only;
- take screenshots.

**Commit:** `feat(settings): Courriels section (sender, keys, templates with preview and test, send log)`.

---

## Task 3.12: In-app notifications (database)

**Lane:** DB. **PS Hub reference:** `notifications` in `supabase/migrations/00000000000001_baseline.sql` (per-user rows, `is_read`). Deviation: recipients by permission, with a per-user read table (one row reaches every holder without fan-out), and polling instead of Realtime (P3-24).

**Files:**
- Create: `supabase/migrations/<ts>_core_notifications.sql`
- Create: `supabase/tests/database/019_core_notifications.test.sql`

**Schema:**
- **`notifications`**:
  - columns:
    - `id`, `org_id`, `module_key → modules`, `kind text check (~ '^[a-z_]+\.[a-z0-9_]+$')`;
    - `importance text check in ('normal','important')`;
    - `title text` (1–160), `body text` (≤ 500);
    - `link_path text check (link_path ~ '^/[^/\\]' and link_path !~ '[[:cntrl:]]')` (app-relative only: no open redirect);
    - `subject_type`, `subject_id`;
    - `recipient_permission text not null → permissions`, `recipient_user_id uuid null → profiles`;
    - `dedupe_key text`, `created_at`, `expires_at`;
  - `unique (org_id, dedupe_key)`;
  - indexes `(org_id, created_at desc)` plus the FK indexes.
- **`notification_reads(notification_id → notifications on delete cascade, user_id, org_id, read_at default now())`**:
  - pk `(notification_id, user_id)`;
  - composite FK `(user_id, org_id) → profiles`;
  - index `(user_id, notification_id)`.
- **RLS:**
  ```sql
  using (
    org_id = (select private.current_user_org_id())
    and recipient_permission = any ((select private.current_permission_keys())::text[])
    and (recipient_user_id is null or recipient_user_id = (select auth.uid()))
    and (expires_at is null or expires_at > now())
  )
  ```
  The permission term is the module gate: a disabled module's permissions are absent. The reads table: own rows only.
- **No client writes.** Both tables are exempt from audit (Task 3.2 list; they are an inbox, not a business record).

**Functions:**
- `private.notify(p_org_id, p_module_key, p_kind, p_importance, p_title, p_body, p_link_path, p_subject_type, p_subject_id, p_recipient_permission, p_recipient_user_id default null, p_dedupe_key default null, p_expires_at default null) returns uuid`:
  - `insert … on conflict (org_id, dedupe_key) do nothing` → returns the existing id;
  - the permission's module must equal `p_module_key` or `core` (`22023`);
  - for SQL callers (module RPCs, sql jobs).
- `public.create_notification(…)`: same arguments; service role only; wraps it (for edge functions and function jobs).
- `list_my_notifications(p_before timestamptz default null, p_limit int default 20)`: security invoker; returns the visible rows plus `is_read` (left join on reads for `auth.uid()`); `created_at desc`; clamp 1–50.
- `count_my_unread_notifications() returns table (total int, important int)`: invoker; only rows of the last 90 days (bounded).
- `mark_notifications_read(p_ids uuid[])`: definer; inserts reads only for ids visible to the caller (re-check with the same predicate), `on conflict do nothing`; at most 200 ids.
- `mark_all_notifications_read()`.
- **Job:** `core.notifications_purge` (sql, maintenance, `0 9 * * *`): deletes notifications older than 12 months, or expired more than 30 days ago.
- **Helper for the bell's « important » block:** `list_my_notifications` takes `p_importance text default null`.

**Tests:**
- **Visibility:**
  - a `users.view` notification is visible to admin A, invisible to the conseillère and to org B;
  - one narrowed to admin A's user id is invisible to another admin;
  - a `professionals.view` one disappears when the module is disabled;
  - an expired one is invisible.
- **Dedupe:** two `private.notify` calls with the same key → one row, same id.
- **Validation:**
  - `link_path = 'https://evil.test'` → `23514`; `'//evil'` → `23514`;
  - a permission of another module → `22023`.
- **Reads:**
  - `mark_notifications_read` with an id the caller cannot see → no read row;
  - the counts follow;
  - another user's read state is separate.
- **Privileges:** no client insert/update/delete; `create_notification` service role only.

**Commit:** `feat(db): in-app notifications addressed by permission`.

---

## Task 3.13: Notifications UI and the shared helper

**Lane:** U (after Task 3.12 merges); the Deno helper in lane F.

**Files:**
- Create: `supabase/functions/_shared/notifications.ts` + test: `notify(client, input)`, a typed wrapper of `create_notification`, used by Phase 4 jobs.
- Create: `src/core/notifications/{api.ts,api.test.ts,hooks.ts}` (`notificationKeys`)
- Create: `src/app/shell/NotificationBell.tsx` + test, `src/app/HomeImportantNotices.tsx` + test
- Modify: `src/app/shell/Topbar.tsx`, `src/app/HomePage.tsx`, `fr-CA.json` (`notifications.*`)

**Behaviour:**
- **The bell** (design-system icon button, 32 px) in the topbar, for every signed-in user.
  - **Dot:** teal when there are unread notifications, danger red when one of them is important. `aria-label` « Notifications, 3 non lues ».
  - **Count query:** `refetchInterval: 60_000`, `refetchOnWindowFocus: true`, `refetchIntervalInBackground: false`.
- **The popover** loads the list **only when open** (`enabled: open`), 20 at a time.
  - Each item shows the title, body, relative time (« il y a 2 h », computed with `toClinicTime`) and an « Important » badge.
  - Clicking an item marks it read and navigates to `link_path` through `confirmLeave` (unsaved-changes guard).
  - « Tout marquer comme lu ».
  - Empty state: « Aucune notification. »
- **Accueil « À surveiller »:** up to 5 unread important notifications (`p_importance: 'important'`), or nothing at all when there are none (no empty card).
- **Cache:** mutations invalidate `notificationKeys.all`. The cache is already cleared on a user change (#10).

**Tests:**
- no unread → no dot;
- 1 important → a red dot and the label;
- the list query does not run until the popover opens;
- clicking an item calls `markNotificationsRead([id])`, then navigates (and asks to confirm when the page is dirty);
- polling is set to 60 s and is off in background tabs (assert the query options);
- Accueil shows the block only with important unread items.

**Commit:** `feat(shell): notification bell and « À surveiller » on Accueil`.

---

# Batch 3c — Auth links on the clinic domain

Read decisions #9–17, #38 and ADR 0006 first. These behaviours are deliberate.

## Task 3.14: `/connexion/confirmer` and the hash-reader transition

**Lane:** U (no DB). **Files:**
- Create: `src/core/auth/pages/ConfirmPage.tsx` + `ConfirmPage.test.tsx`
- Create: `src/core/auth/confirm.ts` + `confirm.test.ts` (pure helpers)
- Modify: `src/core/auth/auth-context.ts`, `src/core/auth/AuthProvider.tsx` + test (`verifyEmailLink`)
- Modify: `src/app/App.tsx` (public route, `lazyPage`), `src/app/route-preload.ts` (+ test: preloads only on `/connexion/confirmer`), `src/i18n/fr-CA.json` (`auth.confirm.*`)

**Step 1: Pure helpers, tests first** (`confirm.ts`):
```ts
export type ConfirmType = 'recovery' | 'email' | 'email_change'
/** Validates ?type=; anything else → null (the page shows the error state). */
export function parseConfirmType(value: string | null): ConfirmType | null
/** `next` may be a path or an absolute URL ({{ .RedirectTo }}); same-origin only, then safeRedirect. */
export function confirmNext(next: string | null, origin: string): string
```
Tests:
- `parseConfirmType('signup')` → null; `('recovery')` → `'recovery'`;
- `confirmNext('http://localhost:5173/accueil?x=1', 'http://localhost:5173')` → `'/accueil?x=1'`;
- `confirmNext('https://evil.test/accueil', origin)` → `'/accueil'`;
- `confirmNext('//evil.test', origin)` → `'/accueil'`;
- `confirmNext(null, origin)` → `'/accueil'`;
- `confirmNext('/parametres/identite', origin)` → that path.

**Step 2: Auth context.** `verifyEmailLink(tokenHash: string, type: ConfirmType): Promise<{ ok: true; sessionAccessToken: string | null } | { ok: false; code: AuthErrorCode }>` calls `supabase.auth.verifyOtp({ token_hash, type })`. In `AuthProvider` tests, mock `verifyOtp`:
- success returns the session's access token;
- `otp_expired` maps to `link_invalid` (one message for expired and used, design §5 step 4).

**Step 3: The page, tests first** (`ConfirmPage.test.tsx`, `renderWithContexts` with a mocked auth context):
- **Before the click:** `verifyEmailLink` is **not** called on mount, so a mail scanner's prefetch burns nothing. One button « Continuer ».
- **Invalid `type`, or no `token_hash`:** the error state at once; no button.
- **Recovery:** after the click, `setRecoveryMarker(sessionIdOf(token))` is called **before** `navigate('/reinitialiser-mot-de-passe', { replace: true })`. Assert the call order with a shared spy log.
- **Email change:** navigates to `/mon-compte` with the neutral notice state (#38); the page shows the same notice as today.
- **Magic link:** navigates to `confirmNext(next)`.
- **Errors:**
  - an error shows « Ce lien a expiré ou a déjà été utilisé. » and « Demander un nouveau lien »: `/mot-de-passe-oublie` for recovery, `/connexion` otherwise;
  - an error **never** navigates to the reset page, and never sets the marker.
- **Another user signed in** (decision #14): the page shows « Vous êtes connecté en tant que {nom}. Ce lien concerne peut-être un autre compte. » above the button.
  - **Error:** nothing changes; that session is untouched (no sign-out call).
  - **Success:** `verifyOtp` replaces the session, and the cache-clearing rule #10 applies (already covered by `AuthProvider`). Assert that no `signOut` is called by the page.

Behaviour: the page title is `usePageTitle(t('auth.confirm.title'))`, « Confirmation ». It reads `token_hash`, `type` and `next` once, then `history.replaceState` removes them from the URL (the token is no longer in history).

**Step 4: Route.** In `App.tsx`, outside `RequireAuth`:
```tsx
const ConfirmPage = lazyPage(() => import('@/core/auth/pages/ConfirmPage'), 'ConfirmPage')
// …
<Route path="/connexion/confirmer" element={<ConfirmPage />} />
```
Declare it before `/connexion`. `App.tsx` is being reworked by the perf lane: rebase onto it, keep its structure.

**Step 5: Hash-reader transition.** Keep the module-level hash reader in `AuthProvider.tsx` (links sent before the switch stay valid for 1 h), with a comment:
```ts
// TRANSITION (Phase 3, ADR 0006 amendment): emails now link to /connexion/confirmer?token_hash=…
// Remove this reader one release after the new templates are live on staging.
```
Add a follow-up line to the status doc in Task 3.36.

**Step 6: Checks.** `npm run typecheck && npm run lint && npm run test:run`. Expected: green, including the existing ADR 0006 tests (`AuthProvider`, guards, `ResetPasswordPage`).

**Commit:** `feat(auth): /connexion/confirmer verifies email links on click (prefetch-safe)`.

---

## Task 3.15: Auth email templates from the shared layout

**Lane:** U (after Task 3.7 merges: it imports `_shared/email/layout.ts`). **Files:**
- Create: `supabase/functions/_shared/email/auth-templates.ts` + test. It exports `authTemplates(): Record<'recovery' | 'magic_link' | 'email_change' | 'confirmation' | 'reauthentication', string>`, built with `renderLayout`. The Go template tokens are kept verbatim (`{{ .SiteURL }}`, `{{ .TokenHash }}`, `{{ .Email }}`, `{{ .NewEmail }}`, `{{ .Token }}`, `{{ .RedirectTo }}`).
- Create: `scripts/build-auth-templates.ts` (writes `supabase/templates/<name>.html`); `package.json` script `"build:auth-templates": "deno run --frozen --config supabase/functions/deno.json --allow-write=supabase/templates scripts/build-auth-templates.ts"`
- Modify: the five files in `supabase/templates/` (generated; `invite.html` untouched)
- Modify: `.github/workflows/ci.yml`: a step `npm run build:auth-templates && git diff --exit-code supabase/templates`

**Links** (design §5; `&amp;` in HTML attributes, which is valid and decoded by browsers):

| Template | Button href |
|---|---|
| recovery | `{{ .SiteURL }}/connexion/confirmer?token_hash={{ .TokenHash }}&amp;type=recovery` |
| magic_link | `{{ .SiteURL }}/connexion/confirmer?token_hash={{ .TokenHash }}&amp;type=email&amp;next={{ .RedirectTo }}` (`next` **last**, see Task 3.16) |
| email_change | `{{ .SiteURL }}/connexion/confirmer?token_hash={{ .TokenHash }}&amp;type=email_change` |
| confirmation | `{{ .SiteURL }}/connexion/confirmer?token_hash={{ .TokenHash }}&amp;type=email` |
| reauthentication | no link; shows `{{ .Token }}` in a large monospace block |

Texts: keep the current French wording of each file (decision #21), moved into the new layout. The footer is static: « Clinique MANA », plus « Ce courriel vous est envoyé parce qu'une action a été demandée pour votre compte. Si ce n'est pas vous, vous pouvez l'ignorer. ». Auth emails cannot read Settings.

**Tests** (`auth-templates.test.ts`):
- every template has `lang="fr-CA"`;
- each link has the exact href above;
- no `{{ .ConfirmationURL }}` is left;
- reauthentication has no `<a href`;
- the teal `#1E837C` button and the wordmark `<img>` with `{{ .SiteURL }}/email/wordmark.png` (P3-10).

**Commands:**
```bash
npm run build:auth-templates && git diff --stat supabase/templates
npm run test:functions
```
**Commit:** `feat(auth): branded auth emails with token_hash links on the clinic domain`.

---

## Task 3.16: Mailpit verification and the ADR 0006 amendment

**Lane:** U, **with the DB token**: changing templates requires `npx supabase stop && npx supabase start`, which interrupts every lane.

**Files:** `docs/adr/0006-session-and-recovery-policy.md`, `supabase/config.toml` (comment only, if anything).

**Step 1: Restart and verify in Mailpit** (`npm run dev` on `http://localhost:5173`, Mailpit on `http://127.0.0.1:55324`):
- **Forgot password** for `adjointe@mana.test`:
  - the email link is `http://localhost:5173/connexion/confirmer?token_hash=…&type=recovery`;
  - opening it shows « Continuer » and does nothing else (check the network panel: no `/auth/v1/verify` before the click);
  - click → the reset page; reload → still the reset page (marker);
  - set a password → `/accueil`.
- **Magic link** from `/connexion?redirect=/parametres/identite`:
  - the link carries `next=http://localhost:5173/parametres/identite`; click → that page;
  - **if the `next` value arrives truncated or unencoded** (a `?` or `&` inside `RedirectTo`): try `{{ .RedirectTo | urlquery }}` in the template. If GoTrue's template engine refuses it, keep `next` last and make `confirmNext` take the raw remainder of the query string after `next=`. Add a test for whichever you implement.
- **Email change** (double confirm): both emails carry their **own** `token_hash`; opening both completes the change; the page shows the neutral notice.
- **An expired or used link:** the error state, and a signed-in other user (log in as the conseillère first in the same browser) stays signed in.

Record what you saw (links with the token replaced by `…`) in the task report.

**Step 2: ADR 0006 amendment.** Add to « Decision » the paragraph of design §5 (« Recovery, magic-link and email-change links land on `/connexion/confirmer?token_hash=…&type=…` … »), plus the rejected alternative (a Supabase custom domain). Add to « Consequences »: the hash reader's removal date (« one release after staging gets the new templates »), and that `/connexion/confirmer` must be on staging's redirect allow-list.

**Commit:**
```bash
git add docs/adr/0006-session-and-recovery-policy.md
git commit -m "docs(adr): 0006 amendment, auth links land on /connexion/confirmer"
```

---

# Batch 3d — Secure links and staff invitations

## Task 3.17: Secure links (database)

**Lane:** DB. **PS Hub reference:** `supabase/functions/get-quote-by-token/index.ts`, as the **anti-pattern** this replaces: a UUID token stored in clear and selected with `.eq('token', token)`.

**Files:**
- Create: `supabase/migrations/<ts>_core_secure_links.sql`
- Create: `supabase/tests/database/020_core_secure_links.test.sql`

**Schema** (design §3.1 + P3-16):
- **`secure_link_purposes`** (global catalogue, seeded by the owning module's migrations, not audited):
  - `key text pk check (~ '^[a-z_]+$')`, `module_key → modules`;
  - `default_ttl interval not null`, `max_ttl interval not null`, `check (default_ttl <= max_ttl and max_ttl <= interval '30 days')`;
  - `max_uses int not null default 1 check (max_uses between 1 and 10)`;
  - `requires_session boolean not null default false`, `creates_account boolean not null default false`;
  - `resolve_rpc text check (resolve_rpc ~ '^[a-z][a-z0-9_]{2,62}$')`, `accept_rpc text check (same)`;
  - `view_permission → permissions`;
  - no client privilege (only service-role functions read it).
- **`secure_links`** as in design §3.1:
  - `token_hash bytea not null unique check (length(token_hash) = 32)`;
  - `scope jsonb not null default '{}' check (jsonb_typeof(scope) = 'object' and pg_column_size(scope) <= 4096)`;
  - `expires_at timestamptz not null`;
  - **no client privilege at all** (like `org_secrets`);
  - audited with `private.audit_trigger('token_hash')`;
  - indexes: the unique `token_hash`; `(org_id, purpose, subject_type, subject_id) where revoked_at is null and used_at is null` (live-link lookup); `(created_at)` (purge); FK indexes.

**Functions:**
- **`private.issue_secure_link(p_org_id uuid, p_purpose text, p_subject_type text, p_subject_id uuid, p_token_hash bytea, p_created_by uuid, p_ttl interval default null, p_scope jsonb default '{}') returns uuid`**:
  - checks the purpose exists (`22023`) and `ttl ≤ max_ttl`;
  - revokes the live links for `(org, purpose, subject)` with `revoked_at = now(), revoked_by = p_created_by`;
  - inserts with `expires_at = now() + coalesce(p_ttl, default_ttl)` and `max_uses` from the purpose;
  - called only from definer RPCs (staff invitations here; Professionnels in 4b), never granted to a client role.
- **`private.consume_secure_link(p_token_hash bytea, p_purpose text) returns public.secure_links`**: the atomic statement of design §3.2.
  ```sql
  update public.secure_links l
     set use_count = l.use_count + 1, used_at = pg_catalog.now()
   where l.token_hash = p_token_hash and l.purpose = p_purpose
     and l.revoked_at is null and l.expires_at > pg_catalog.now() and l.use_count < l.max_uses
  returning l.*;
  ```
  It returns null when no row matches. Called by the handler RPCs.
- **`private.revoke_secure_links(p_org_id, p_purpose, p_subject_type, p_subject_id, p_by uuid) returns int`**.
- **`public.peek_secure_link(p_token_hash bytea, p_mark_opened boolean) returns jsonb`** (service role only). Exactly one of:
  - `{ "state": "invalid" }` for an unknown or revoked link: no other field, so an unknown and a revoked token give byte-identical answers;
  - `{ "state": "expired" | "used", "purpose": … }`;
  - `{ "state": "valid", "link_id", "org_id", "purpose", "module_key", "subject_type", "subject_id", "scope", "expires_at", "requires_session", "creates_account", "resolve_rpc", "accept_rpc" }`.

  With `p_mark_opened`, a valid link gets `last_opened_at = now()` (legacy A3 « opened »).
- **Job:** `core.secure_links_purge` (sql, maintenance, `20 8 * * *`): deletes links where `greatest(used_at, revoked_at, expires_at) < now() - interval '12 months'`.

**Tests:**
- **Privileges:** `secure_links` and `secure_link_purposes` have no `anon` / `authenticated` privilege; `peek_secure_link` is service role only; the private functions are executable by no client.
- **Single use under concurrency:** in one transaction, call `consume_secure_link` twice for the same hash → the first returns the row, the second null.

  Also run a manual two-session check (`psql` × 2, `begin`, consume, commit) in the review. The update's row lock makes the second wait, then see `use_count = max_uses`.
- **Rejections:**
  - an expired link → null, and `peek` → `expired`;
  - a revoked link → null, and `peek` → `{"state":"invalid"}`, byte-equal to an unknown hash's answer (`is(peek(revoked)::text, peek(unknown)::text)`);
  - a purpose mismatch → null.
- **One live link per subject:** a second `issue_secure_link` for the same subject revokes the first (`revoked_by` set); a different subject is untouched.
- **TTL:** above `max_ttl` → `22023`.
- **Audit:** the insert's audit row has `changed_fields->>'token_hash' = '[redacted]'`.
- **`p_mark_opened`:** sets `last_opened_at` only for a valid link.
- **Purge:** a link expired 13 months ago is deleted, one expired 11 months ago is kept.

**Commit:** `feat(db): hashed single-use secure links with purpose catalogue`.

---

## Task 3.18: Staff invitations (database)

**Lane:** DB. **Files:**
- Create: `supabase/migrations/<ts>_core_staff_invitations.sql`
- Create: `supabase/tests/database/021_core_staff_invitations.test.sql`

**Schema** (design §4):
- **`staff_invitations`**:
  - `email text check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')`, `display_name` (1–80), `role → roles`, `secure_link_id → secure_links on delete set null`;
  - `status check in ('pending','accepted','revoked')`, `invited_by → profiles`, `accepted_user_id → profiles`, `accepted_at`, timestamps;
  - partial unique `(org_id, email) where status = 'pending'`;
  - audited;
  - select policy: own org and `(select private.has_permission('users.view'))`;
  - no client writes.
- **Purpose seed:**
  ```sql
  insert into public.secure_link_purposes
    (key, module_key, default_ttl, max_ttl, max_uses, creates_account, resolve_rpc, accept_rpc, view_permission)
  values ('staff_invite', 'core', interval '7 days', interval '14 days', 1, true,
          'resolve_staff_invitation', 'accept_staff_invitation', 'users.view')
  on conflict do nothing;
  ```

**RPCs:**
- `create_staff_invitation(p_email text, p_display_name text, p_role text, p_token_hash bytea) returns uuid` (authenticated, definer):
  - checks `users.manage` first;
  - locks the org row (`for no key update`);
  - `provider` → P0001 « Le rôle Professionnel est attribué par le module Professionnels. »;
  - an unknown role, or another org's custom role → `22023`;
  - `admin` while the caller is not admin → P0001 « Seul un administrateur peut inviter un administrateur. » (same rule as `set_user_role`);
  - an address with a profile in this org → P0001 « Cette personne a déjà un accès. »;
  - a pending invitation for that address → P0001 « Une invitation est déjà en attente pour cette adresse. Utilisez « Renvoyer ». »;
  - then `private.issue_secure_link(org, 'staff_invite', 'staff_invitation', id, p_token_hash, auth.uid())`, and inserts the invitation with the link id.
- `renew_staff_invitation(p_id uuid, p_token_hash bytea) returns table (email text, display_name text, expires_at timestamptz)` (`users.manage`): for a pending invitation in the org, issues a new link (which revokes the old one) and returns what the email needs.
- `revoke_staff_invitation(p_id)` (`users.manage`): status `revoked`, plus `private.revoke_secure_links`.
- `list_staff_invitations()` (`users.view`, definer, **one query**):
  - returns id, email, display_name, role, role_name, status, `expires_at` (from the link), `is_expired`, invited_by_name, created_at, and `last_email_status` / `last_email_at` (lateral `limit 1` on `email_log_subject_idx`);
  - pending invitations only.
- `resolve_staff_invitation(p_link_id uuid) returns jsonb` (service role): `{ clinic_name, display_name, email, expires_at }`.
- `accept_staff_invitation(p_token_hash bytea, p_user_id uuid, p_payload jsonb) returns jsonb` (service role). In one transaction:
  1. `private.consume_secure_link(p_token_hash, 'staff_invite')`: null → `{"status":"link_used"}`;
  2. the pending invitation for that link: none → `{"status":"link_used"}` (revoked meanwhile);
  3. insert `profiles (user_id, org_id, display_name, status 'active')` (the email comes from `auth.users` by the existing trigger) and `user_roles (user_id, org_id, role)`;
  4. the invitation becomes `accepted` with the user and the date;
  5. returns `{"status":"accepted","org_id":…}`.
- **Interaction with Task 2.20:** `delete_role` also refuses a role used by pending invitations: P0001 « Ce rôle est utilisé par {n} invitation(s) en attente. ». Re-create the function with this extra check; inconsistency #15.

**Tests:**
- **Privileges:** `staff_invitations` is select-only for `authenticated`; the service RPCs are service role only.
- **`create_staff_invitation` as admin A:**
  - succeeds, with a link row whose subject is the invitation;
  - provider → the P0001 text; an admin by a non-admin manager (the adjointe with `users.manage`) → the P0001 text; an org custom role → succeeds (#40);
  - an existing member's email (mixed case, spaces) → « Cette personne a déjà un accès. »;
  - a duplicate pending → the « Renvoyer » message;
  - the conseillère → `42501`;
  - org B cannot see org A's invitations.
- **Renew:** the old link is revoked, a new link is live, and the expiry has moved.
- **Revoke:** the link is revoked; `peek` → invalid.
- **Accept** (as service role):
  - creates the profile (active, `display_name`), the role and `accepted`;
  - a second accept with the same hash → `link_used`, and no second profile;
  - accepting after a revoke → `link_used`;
  - `get_my_access()` as the new user lists the role's permissions.
- **`list_staff_invitations`:** `is_expired` is true after expiry (set `expires_at` in the past as postgres); `last_email_status` reflects an `email_log` row.
- **`delete_role`** of a custom role with a pending invitation → the new message.
- The audit rows exist for create, renew and accept.

**Commit:** `feat(db): staff invitations with secure links and acceptance`.

---

## Task 3.19: `_shared/links.ts`

**Lane:** F. **Files:** `supabase/functions/_shared/links.ts` + test.
```ts
/** 32 random bytes, base64url without padding (43 chars). Exists only in memory and in the email. */
export function generateToken(): string
/** SHA-256 of the token's UTF-8 bytes, as the `\x…` hex literal PostgREST accepts for bytea. */
export async function hashToken(token: string): Promise<string>
/** `${APP_URL}/invitation#t=${token}`: the token travels in the fragment (never sent to the server). */
export function linkUrl(appUrl: string, path: '/invitation', token: string): string
/** Rejects tokens that are not 43 base64url chars before any hashing or lookup. */
export function isWellFormedToken(value: unknown): value is string
```
**Tests:**
- 1 000 tokens are unique and 43 characters long, matching `^[A-Za-z0-9_-]{43}$`;
- `hashToken` of a known string equals the expected SHA-256 hex (`\x`-prefixed);
- `linkUrl` keeps the token after `#t=` and refuses an `appUrl` that is not https, unless it is `http://localhost:5173`;
- `isWellFormedToken('../x')` → false.

**Commit:** `feat(functions): secure link tokens, hashing and URLs`.

---

## Task 3.20: `resolve-link`, `accept-invite`, `staff-invite`, `users-set-status`

**Lane:** F (after Task 3.18 merges). **PS Hub reference:** `supabase/functions/admin-create-user/index.ts` (the `auth.admin.createUser` call and error handling).

**Files:** the four function folders (`index.ts`, `handler.ts`, `handler.test.ts`); `supabase/config.toml` (DB lane merge):
```toml
[functions.resolve-link]
verify_jwt = true     # public token function: anon key required, no user (CLAUDE.md §7)
[functions.accept-invite]
verify_jwt = true
[functions.staff-invite]
verify_jwt = false
[functions.users-set-status]
verify_jwt = false
```

**`resolve-link`** (public token function):
1. `handleCors` (`ALLOWED_ORIGINS`).
2. Rate limit `links.resolve_ip` (30 / 600 s) on `clientIp` **before** reading the body.
3. Body `{ token }`: `isWellFormedToken`, else the same answer as invalid.
4. `peek_secure_link(hash, true)`.
5. `invalid` → 410 `link_invalid`; `expired` → 410 `link_expired`; `used` → 410 `link_used`.
6. `requireModuleForOrg(org, module_key)` (a disabled module → `link_invalid`: indistinguishable on purpose).
7. `rpc(resolve_rpc, { p_link_id })`.
8. 200 `{ purpose, display }`.

`display` is passed through **as returned by the purpose RPC**, which owns its minimisation.

**`accept-invite`** (public token function, P3-16):
1. CORS.
2. Rate limit `links.accept_ip` (10 / 3 600 s).
3. Body `{ token, password, payload? }` (Zod: password 10–72 characters, the same rule as `password-schema.ts`; `payload` an object ≤ 4 KB).
4. `peek_secure_link(hash, false)`; non-valid → 410 with its code.
5. Rate limit `links.accept_link` (5 / 3 600 s) on `link_id`.
6. Module gate.
7. `creates_account` false → 400 `invalid_request`. Session-only purposes have their own module functions (Professionnels 4b).
8. `display = rpc(resolve_rpc)` → `display.email` (required).
9. `auth.admin.createUser({ email, password, email_confirm: true })`:
   - **`email_exists`** (or 422 « already registered ») → 409 `conflict`, French UI text « Ce lien ne peut plus être utilisé. Communiquez avec la clinique. », and `reportError({ code: 'invite_email_exists', ids: { link_id } })` (no address);
   - any other error → 500, **nothing consumed**.
10. `result = rpc(accept_rpc, { p_token_hash, p_user_id, p_payload })`.
11. **Compensation:** if the RPC errors, or returns `status ≠ 'accepted'`, call `auth.admin.deleteUser(user.id)` and answer `link_used` (or 500 for an RPC error). A failed delete is reported with the user id; nothing else is retried.
12. 200 `{ status: 'accepted', email }`. The email is already known to the token holder, and the page signs in with it.

**`staff-invite`:**
1. `verifyAuth(req, { permission: 'users.manage' })`.
2. Body `{ email, display_name, role }`, or `{ invitation_id }` (« Renvoyer »).
3. `generateToken`, `hashToken`.
4. With the **user client**: `create_staff_invitation(...)` or `renew_staff_invitation(id, hash)`, so RLS and the guards apply. P0001 → 400 with the message (`invalid_request`, the message passed through for the UI, as `moduleErrorMessage` shows P0001).
5. `sendTemplatedEmail`:
   - template `core.staff_invite`; subject `staff_invitation` / id;
   - values `{ invitee: { display_name }, inviter: { display_name: auth.access.display_name }, clinic: { name }, invitation: { expires_at } }`;
   - `actionUrl = linkUrl(APP_URL, '/invitation', token)`;
   - `explicitResend` for « Renvoyer ».
6. Email failure → 502 `provider_error` (or 503 `not_configured`) with `{ invitation_id }`, so the UI shows « Invitation créée, mais le courriel n'a pas pu être envoyé. Utilisez « Renvoyer ». ».
7. 200 `{ invitation_id }`.

The raw token is never returned (P3-7).

**`users-set-status`:**
1. `verifyAuth(req, { permission: 'users.manage' })`.
2. Body `{ user_id, status: 'active' | 'disabled' }`.
3. `set_user_status` with the **user client** (Phase 2 guards).
4. Service client `auth.admin.updateUserById(user_id, { ban_duration: status === 'disabled' ? '876000h' : 'none' })`.
5. A ban failure after a successful disable → 200 `{ sessions_ended: false }`, plus `reportError`. The UI warns « Accès bloqué. Les sessions ouvertes se fermeront d'ici une heure. »
6. An unban failure on re-enable → 502, and the UI says « Réessayez »: a still-banned user cannot sign in.

**Tests** (fake deps):
- **`resolve-link`:**
  - the 31st call from one IP → 429, and **no** `peek` call;
  - a malformed token, an unknown token and a revoked token give **byte-identical** responses (status, headers except `Date`, body);
  - expired → `link_expired`;
  - a disabled module → `link_invalid`;
  - `last_opened_at` marking is requested (`p_mark_opened: true`).
- **`accept-invite`:**
  - happy path: `createUser` → `accept_staff_invitation` → 200;
  - `accept_rpc` returns `link_used` → `deleteUser` was called with the created id, and 410 `link_used`;
  - the RPC errors → `deleteUser` + 500;
  - `createUser` `email_exists` → 409 `conflict`, with no `accept_rpc` call, and the report contains no address;
  - a short password → 400 before any `peek`;
  - the 11th call per IP → 429;
  - a purpose with `creates_account: false` → 400.
- **`staff-invite`:**
  - the conseillère → 403;
  - a P0001 from the RPC → 400 with that message;
  - the token in the email URL hashes to the `p_token_hash` passed to the RPC;
  - the response body has no token;
  - « Renvoyer » sets `explicitResend`.
- **`users-set-status`:** disable → RPC then `updateUserById(ban_duration '876000h')`; a ban failure → 200 `sessions_ended: false`; enable → `'none'`.

**Live probe (DB token)**, local stack, `functions serve`, `npm run dev`, Mailpit:
1. **Round trip:** as admin, `staff-invite` (curl with the admin JWT) for `nouvelle@mana.test`, role `counselor` → Mailpit email → link → `resolve-link` → `accept-invite` with a password → sign in with `signInWithPassword` → `get_my_access` shows `counselor`.
2. **Q9 / P3-9:** sign in as that user (keep the refresh token); `users-set-status` disabled; `POST /auth/v1/token?grant_type=refresh_token` → 400 with `user_banned` (record the exact code); re-enable → the refresh works again (a new sign-in if the old refresh token was revoked).
3. **The real IP header:** log `req.headers.get('x-forwarded-for')` once locally (then remove the log) to see what the local gateway passes. Staging is checked in Mise en service.

**Commit:** `feat(functions): resolve-link, accept-invite, staff-invite and users-set-status`.

---

## Task 3.21: `/invitation` page

**Lane:** U (after Task 3.20 merges). **Files:**
- Create: `src/core/invitations/api.ts` + test (`resolveLink(token)`, `acceptInvite(token, password)`; through `supabase.functions.invoke`, which sends the anon key)
- Create: `src/core/invitations/pages/InvitationPage.tsx` + test
- Modify: `App.tsx` (public route `/invitation`, `lazyPage`), `route-preload.ts` (+ test), `fr-CA.json` (`invitation.*`), `vercel.json` (header `Referrer-Policy: no-referrer` for `/invitation` and `/connexion/confirmer`; keep the SPA rewrite)

**Behaviour:**
- **On mount:**
  - read `#t=` from `location.hash`, keep it in component state, then `history.replaceState(null, '', '/invitation')` at once;
  - no token → the « invalid » state;
  - call `resolveLink` once (a `useQuery` with `retry: false`, `staleTime: Infinity`).
- **States:**
  - valid: « Bienvenue chez {clinic_name} », with name and address read-only;
  - `link_expired` « Ce lien a expiré. Demandez-en un nouveau à la clinique. »;
  - `link_used` « Ce lien a déjà été utilisé. Connectez-vous. » with a link to `/connexion`;
  - `link_invalid` « Ce lien n'est pas valide. »;
  - `rate_limited` « Trop de tentatives. Réessayez dans quelques minutes. »;
  - `conflict` « Ce lien ne peut plus être utilisé. Communiquez avec la clinique. »;
  - network error → generic text with « Réessayer ».
- **The form:** « Mot de passe » and « Confirmer le mot de passe », with `password-schema.ts`.
- **Submit:**
  1. `acceptInvite`;
  2. `signInWithPassword(email, password)` through `useAuth` (a new `signInWithPassword` passthrough if none exists);
  3. `navigate('/accueil', { replace: true })`.

  If someone else is signed in in this browser (shared PC), sign them out locally first (`signOut`, #13), then sign in. The cache rule #10 applies.
- **Robots:** add `<meta name="robots" content="noindex">` through `usePageTitle`'s companion, or a small effect.

**Tests:**
- the token is removed from the URL before the first network call (spy on `replaceState`, then on `resolveLink`);
- each error state's text;
- password mismatch / too short;
- submit success → sign-in, then navigate;
- an accept error `link_used` → the state switches with no sign-in;
- another signed-in user → `signOut` is called before `signInWithPassword`.

**Commit:** `feat(auth): /invitation page (accept a staff invitation, set a password)`.

---

## Task 3.22: « Utilisateurs et accès »: invite, pending invitations, ending sessions

**Lane:** U (after Task 3.20 merges). **Files:**
- Modify: `src/core/users/api.ts` (+ test): `inviteStaff`, `resendInvitation`, `revokeInvitation`, `listStaffInvitations`, `setUserStatus` (now via `users-set-status`)
- Modify: `src/core/users/hooks.ts`, `src/core/settings/pages/UsersSettingsPage.tsx` + test
- Create: `src/core/users/components/InviteDialog.tsx` + test, `PendingInvitationRows.tsx`
- Modify: `fr-CA.json`: `settings.users.invite.*`; remove `settings.users.addNote` and its usage

**Behaviour:**
- « Inviter » (teal, the screen's one coloured action, only with `users.manage`) replaces the « contactez l'administrateur technique » note.
- **The dialog:** « Nom », « Courriel », « Rôle » (system roles except `provider`, plus custom roles).
  - Choosing « Administrateur » asks for confirmation (#36): « Cette personne aura toutes les permissions. »
  - Submit → toast « Invitation envoyée à {email} ». Or, on 502/503, the « Invitation créée, mais… » warning.
- **Pending invitations** are rows in the same table (one combined list, sorted after active users):
  - status « Invitation envoyée » (or « Expirée », or « Adresse introuvable » when `last_email_status = 'bounced'`) and « Expire le {formatClinicDateShort} »;
  - actions « Renvoyer » and « Révoquer » (AlertDialog confirm), hidden without `users.manage`.
- **Disable / enable** goes through `users-set-status`. When `sessions_ended: false`, show the warning toast.
- **Queries:** `listOrgUsers` and `listStaffInvitations` run **in parallel**; the table renders when both resolve. Mutations invalidate `userKeys.all`.

**Tests:**
- the button is hidden without `users.manage`;
- the dialog's validation (email, name, role);
- the admin confirmation;
- a P0001 message is shown in the dialog;
- the pending row shows « Expirée » when `is_expired`;
- « Renvoyer » calls `resendInvitation(id)`;
- « Révoquer » asks for confirmation;
- both list queries start before either resolves;
- the disable warning.

**Browser check** (DB token for the stack, Mailpit): the full invitation round trip from the UI; revoke a second invitation and open its link → « Ce lien n'est pas valide. »; screenshots.

**Commit:** `feat(users): invite staff, pending invitations, disabling ends sessions`.

---

## Task 3.23: ADR 0007 « Secure links and public token functions »

**Lane:** coordinator. **Files:** `docs/adr/0007-secure-links-and-public-token-functions.md`, `docs/adr/README.md` (table row).

Content, 15–30 lines:
- **Context:** legacy A3 stored tokens in clear and let anon list them.
- **Decision:**
  - 32 random bytes; only the SHA-256 is stored; the token travels in the URL fragment;
  - a purpose catalogue with `resolve_rpc` / `accept_rpc` handlers (P3-16);
  - one live link per subject and purpose;
  - atomic consumption;
  - public token functions: anon key required, rate limit first, CORS restricted, org and module from the row;
  - no enumeration (identical answers for unknown and revoked);
  - account creation only on acceptance, with compensation.
- **Consequences:** a link is shown only at creation (P3-7); modules add purposes by migration; handlers must consume the link themselves.
- **Alternatives:** Supabase's built-in invite (random passwords, Supabase URLs), signed JWT links (cannot be revoked one by one).

**Commit:** `docs(adr): 0007 secure links and public token functions`.

---

# Batch 3e — Storage

## Task 3.24: Storage (database)

**From lane F (Task 3.25, `_shared/storage.ts`, commit 40fea35), match these:** MIME → extension map `application/pdf→pdf`, `image/png→png`, `image/jpeg→jpg`, `image/webp→webp`, `application/msword→doc`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document→docx` (exact MIME strings, no aliases); `stored_files.sha256` and `confirm_stored_file(p_sha256 text)` take **64 lower-case hex characters** (not `\x…` bytea); object paths `{org_id}/{module_key}/{subject_id}/{file_id}.{ext}` with canonical lower-case UUIDs; the DB stays the source of truth for the path. `get_pending_upload` also returns the purpose's `max_bytes` (the size cap `inspectStream` enforces). Allow `application/msword` only for purposes that truly need it (OLE sniffing accepts any compound file); Phase 4 purposes default to PDF and images.

**Lane:** DB. **Files:**
- Create: `supabase/migrations/<ts>_core_storage.sql`
- Create: `supabase/tests/database/022_core_storage.test.sql`

**Buckets** (design §7.1), in the migration:
```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('org-assets',       'org-assets',       false,  2097152, array['image/png','image/jpeg','image/webp']),
  ('documents',        'documents',        false, 10485760, array['application/pdf','image/png','image/jpeg','image/webp',
                                                                 'application/msword',
                                                                 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  ('signed-documents', 'signed-documents', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;
```

**Tables:**
- **`upload_purposes`** (global catalogue, module-seeded, not audited):
  - `key pk check (~ '^[a-z_]+$')`, `module_key → modules`, `bucket text check in (the three)`;
  - `upload_permission → permissions`, `view_permission → permissions null` (null = any active member of the org: inconsistency #8);
  - `owner_permission → permissions null` (inconsistency #12: the owner branch keeps a module gate);
  - `max_bytes int check (max_bytes <= the bucket limit)`, `mime_types text[] not null`, `retain_days int null` (staged uploads, P3-17).

  Select to `authenticated` (`using (true)`).
- **`stored_files`** as in design §7.2, plus:
  - `ext text check (ext ~ '^[a-z0-9]{1,5}$')`;
  - `owner_permission text null`;
  - `retain_until timestamptz null`;
  - `status check in ('pending','ready','deleted','purged')` (P3-30);
  - `original_name` 1–200 characters, with no `/`, `\` or control character;
  - `object_path unique check (split_part(object_path, '/', 1) = org_id::text)`;
  - indexes: `(org_id, module_key, subject_type, subject_id)`; `(status, created_at)` (cleanup); `(retain_until) where retain_until is not null`; FK indexes;
  - audited;
  - select policy:
    ```sql
    using (
      org_id = (select private.current_user_org_id())
      and status = 'ready'
      and (view_permission is null
           or view_permission = any ((select private.current_permission_keys())::text[])
           or (owner_profile_id = (select auth.uid())
               and owner_permission = any ((select private.current_permission_keys())::text[])))
    )
    ```
  - no client writes.
- **`organizations`:**
  - `add column logo_file_id uuid references public.stored_files(id) on delete set null`, `add column signature_file_id uuid references public.stored_files(id) on delete set null` (+ indexes);
  - `add column signatory_email text` with the Phase 2 email check and the `settings.manage` update grant (as for the other signatory columns).

**Object policy** (design §7.2; no insert/update/delete policy for clients):
```sql
create function private.can_read_object(p_bucket text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.stored_files f
     where f.object_path = p_name
       and f.bucket = p_bucket
       and f.status = 'ready'
       and f.org_id = private.current_user_org_id()
       and (f.view_permission is null
            or f.view_permission = any ((select private.current_permission_keys())::text[])
            or (f.owner_profile_id = auth.uid() and f.owner_permission = any ((select private.current_permission_keys())::text[])))
  )
$$;
revoke all on function private.can_read_object(text, text) from public, anon;
grant execute on function private.can_read_object(text, text) to authenticated;

create policy core_objects_select on storage.objects for select to authenticated
  using (bucket_id in ('org-assets', 'documents', 'signed-documents')
         and (select private.can_read_object(bucket_id, name)));
```

**RPCs:**
- `create_pending_upload(p_purpose text, p_subject_type text, p_subject_id uuid, p_original_name text, p_mime_type text, p_size_bytes int) returns table (file_id uuid, bucket text, object_path text)` (authenticated, definer). This is the core permission check; the function only signs the URL.
  - checks the purpose's `upload_permission` (`42501`) and its module (implied by the permission);
  - size > `max_bytes` → P0001 « Ce fichier dépasse la taille permise ({n} Mo). »;
  - a MIME type outside `mime_types` → P0001 « Ce type de fichier n'est pas accepté. »;
  - `ext` comes from the MIME type (a fixed map), never from the name;
  - path `{org}/{module}/{subject_id}/{file_id}.{ext}`;
  - `owner_profile_id = auth.uid()` when the purpose has an `owner_permission`;
  - `retain_until = now() + retain_days` when set;
  - inserts `pending`.
- `get_pending_upload(p_file_id) returns table (bucket, object_path, mime_type, size_bytes)` (authenticated): the uploader only, while `pending`.
- **Service role:**
  - `confirm_stored_file(p_file_id, p_sha256 text, p_size_bytes int)` → `ready`;
  - `reject_stored_file(p_file_id)` → `deleted`;
  - `register_system_file(p_org_id, p_bucket, p_module_key, p_purpose, p_subject_type, p_subject_id, p_mime_type, p_size_bytes, p_sha256, p_view_permission, p_original_name) returns table (file_id, object_path)`: for files written by functions (unsigned and signed PDFs), inserted directly as `ready`; the caller then uploads to the returned path;
  - `list_files_to_purge(p_limit int default 500)`: `pending` older than 24 h, `deleted` older than 30 days, and `ready` with `retain_until < now()` (staged and abandoned). Ordered by `created_at`, clamped;
  - `mark_files_purged(p_ids uuid[])` → `purged` (≤ 500 ids).
- **For module RPCs (P3-17):**
  - `private.attach_stored_file(p_file_id uuid, p_subject_type text, p_subject_id uuid, p_view_permission text, p_owner_profile_id uuid, p_owner_permission text) returns void`: same org, `ready` only; clears `retain_until`;
  - `private.soft_delete_stored_file(p_file_id, p_by uuid)`.
- `set_org_asset(p_kind text, p_file_id uuid)` (`settings.manage`):
  - `p_kind in ('logo','signature')` (`22023`);
  - the file must be `ready`, in the org, with purpose `org_logo` / `org_signature` (P0001 « Fichier introuvable. »);
  - soft-deletes the previous asset;
  - `p_file_id = null` → « Retirer » (the old file soft-deleted).
- **Purposes:**
  - `org_logo` (`org-assets`, upload `settings.manage`, view null, 2 MB, png/jpeg/webp);
  - `org_signature` (`org-assets`, upload `settings.manage`, view `settings.manage`, 2 MB, png/jpeg/webp).
- **Job:** `core.storage_cleanup` (function `storage-cleanup`, maintenance, `40 8 * * *`).

**Tests** (`022_core_storage.test.sql`; insert `storage.objects` fixtures as postgres with `bucket_id`, `name`, `owner`):
- **Buckets:** exist, private, with their limits.
- **`can_read_object`** as each fixture user:
  - own org `ready` with view null → true for the conseillère;
  - `view_permission = 'settings.manage'` → true for admin, false for the adjointe;
  - another org's path → false;
  - `pending` / `deleted` / `purged` → false;
  - **owner branch:** a provider owner with `owner_permission = 'professionals.view'` (a fixture permission they hold through the role) → true; the same with the module disabled → false;
  - disabled user → false.
- **Select through the policy:** as admin A, `select count(*) from storage.objects where bucket_id = 'documents'` returns only the readable fixtures. That proves the policy, not just the function.
- **No client writes:** `insert into storage.objects` as `authenticated` → refused (`42501`, or an RLS violation `42501`/`new row violates`; assert the SQLSTATE).
- **`create_pending_upload`:**
  - too big → the P0001 text;
  - a bad type → the text;
  - no `upload_permission` → `42501`;
  - the path format matches `^<org>/core/<subject>/<file_id>\.png$`;
  - `original_name` with `/` → `23514`.
- **`set_org_asset`:** happy path; replacing soft-deletes the old file; a `pending` file → P0001; another org's file → P0001.
- **`list_files_to_purge`:** a `pending` file 25 h old is listed, one 1 h old is not; a `ready` file with `retain_until` in the past is listed.
- **`attach_stored_file`:** clears `retain_until` and changes the subject.
- **Audit:** the `stored_files` audit row exists, and the `organizations` audit row has `logo_file_id`.

**Commit:** `feat(db): private buckets, file registry, object read policy, org logo and signature`.

---

## Task 3.25: `_shared/storage.ts`

**Lane:** F. **Files:** `supabase/functions/_shared/storage.ts` + test.
```ts
export type SniffedType = 'pdf' | 'png' | 'jpeg' | 'webp' | 'doc' | 'docx' | 'unknown'
/** Content signature from the first bytes (design §7.2); docx needs the ZIP central directory. */
export function sniff(bytes: Uint8Array): SniffedType
export function sniffMatchesMime(type: SniffedType, mime: string): boolean
export async function sha256Hex(bytes: Uint8Array): Promise<string>
```
**Rules:**
- **PDF** `%PDF-`; **PNG** `89 50 4E 47 0D 0A 1A 0A`; **JPEG** `FF D8 FF`; **WEBP** `RIFF????WEBP`; **DOC** OLE `D0 CF 11 E0 A1 B1 1A E1`.
- **DOCX:** a ZIP (`PK\x03\x04`) whose central directory lists `[Content_Types].xml` **and** `word/document.xml`. Scan for the file names in the central directory (the last 64 KB); no full unzip.

**Tests:** one minimal fixture per type, built in the test as bytes (no binary files committed); a PNG renamed `.pdf` → mismatch; a ZIP without `word/document.xml` → `unknown`; an empty file → `unknown`.

**Commit:** `feat(functions): content sniffing and hashing for uploads`.

---

## Task 3.26: `storage-upload`, `storage-confirm`, `storage-cleanup`

**From Task 3.25:** use `buildObjectPath` to check the path the RPC returns before signing it; `storage-confirm` also checks that the stored object's content type equals the declared MIME (the client sets that header on the signed upload), then streams the object through `inspectStream` (hash + sniff under the size cap).

**Lane:** F (after Task 3.24 merges). **Files:** the three function folders; `config.toml` (`verify_jwt = false` for all three).

**Behaviour:**
- **`storage-upload`:**
  1. `verifyAuth(req)` (permission and module are checked by the RPC through the user client).
  2. Body `{ purpose, subject_type, subject_id, original_name, mime_type, size_bytes }`.
  3. `create_pending_upload` with the **user client** (P0001 → 400 with the message).
  4. Service client `storage.from(bucket).createSignedUploadUrl(object_path)`.
  5. 200 `{ file_id, signed_url, token, path }`.
- **`storage-confirm`:**
  1. `verifyAuth`; body `{ file_id }`.
  2. `get_pending_upload` with the user client: the uploader and `pending` only, else 404 `not_found`.
  3. Service `download(object_path)`; a missing object → 400 « Le fichier n'a pas été reçu. »
  4. Real size within the purpose limit; `sniff` matches the declared MIME type.
  5. Mismatch → `remove([path])`, `reject_stored_file`, then 400 « Ce fichier n'est pas du type annoncé. »
  6. Success → `confirm_stored_file(file_id, sha256Hex, size)` → 200 `{ file_id }`.
- **`storage-cleanup`:**
  - `runJob('core.storage_cleanup')`, but database-wide: it runs once with org null, because `list_files_to_purge` is global;
  - in a loop, up to 5 pages of 500: group the rows by bucket; `remove(paths)` in chunks of 100 (**no per-file call**); `mark_files_purged(ids)` for the paths whose removal succeeded;
  - detail `« {n} fichiers supprimés »` (counts only).

**Tests:**
- **Upload:** a P0001 is passed through; the signed URL is created with the RPC's path, never a client path; the body has no `path` field accepted.
- **Confirm:**
  - a PNG declared as PDF → `remove` + `reject_stored_file` + 400;
  - a real size above the limit → 400;
  - success → `confirm_stored_file` with the correct SHA-256;
  - another user's `file_id` → 404 with no download.
- **Cleanup:** 250 rows over two buckets → 3 `remove` calls (100 + 100 + 50, grouped by bucket) and 1 `mark_files_purged`; a failed chunk is not marked.

**Live probe (DB token):**
1. As admin, through the UI or curl: upload `org_logo` → signed upload (`curl -X PUT` with the token) → confirm → `ready`.
2. `createSignedUrl(path, 300)` as the conseillère works (view null); as an org B user (create one in a scratch SQL session) it fails.
3. A `.txt` renamed `.png` → rejected, and the object is gone from storage.
4. `select private.invoke_job_function('core.storage_cleanup')` → a run `ok`.

**Commit:** `feat(functions): signed uploads with server-side content checks, and storage cleanup`.

---

## Task 3.27: Upload widget, logo, signatory email and signature image

**From the Task 3.25 review:** about 7 % of real `.jpg` files are really PNG or WebP, and browsers derive `file.type` from the extension. The widget sniffs the first bytes on the client (same signatures as `_shared/storage.ts`) and sends the sniffed MIME when it is allowed for the purpose, so a misnamed image is not refused with « Ce fichier n'est pas du type annoncé ».

**Lane:** U (after Task 3.26 merges). **Files:**
- Create: `src/core/storage/api.ts` + test: `uploadFile({ purpose, subjectType, subjectId, file }): Promise<{ fileId }>`. It calls `storage-upload` → `supabase.storage.from(bucket).uploadToSignedUrl(path, token, file)` → `storage-confirm`. Also `signedFileUrl(fileId, { download?: boolean })`: reads `stored_files` (`object_path, bucket, original_name`) for one id, then `createSignedUrl(path, 300, download ? { download: original_name } : undefined)`.
- Create: `src/core/storage/hooks.ts` (`storageKeys`, `useSignedFileUrl(fileId)` with `staleTime: 240_000`, so a 5-min URL is refreshed before it expires), `src/shared/components/FileDropzone.tsx` + test (accept list, size check before upload, progress, the error text from the functions)
- Modify: `src/core/settings/pages/IdentitySettingsPage.tsx` (+ test): a « Logo » card (preview, « Remplacer », « Retirer » with confirmation → `set_org_asset('logo', …)`)
- Modify: `src/core/settings/pages/SignatorySettingsPage.tsx` (+ test): « Courriel du signataire » (in the existing signatory card, Zod email) and an « Image de signature » card (PNG with transparency recommended; help text « Utilisée pour la signature de la clinique sur les documents. »)
- Modify: `src/core/settings/organization/*` (types/schema for `signatory_email`, `logo_file_id`, `signature_file_id`), `fr-CA.json` (`storage.*`, `settings.identity.logo.*`, `settings.signatory.*`)

**Rules:**
- The client checks the size and type before calling `storage-upload` (fast feedback). The server stays the authority.
- The image preview uses the signed URL in an `<img>`; nothing is cached beyond the query's `staleTime`.
- Read-only viewers see the preview, with no buttons. The signature image is visible only with `settings.manage` (the RLS makes the URL fail for others; hide the card for them).

**Tests:**
- `uploadFile` calls the three steps in order and stops at the first error;
- the dropzone refuses a 3 MB PNG for `org_logo` before any network call;
- the Logo card: replace, remove (confirmation), read-only;
- the signatory email validation;
- the signature card is hidden for the adjointe.

**Browser check** (DB token): upload a logo and a signature image as admin; check them as the adjointe (logo visible, signature card hidden); screenshots.

**Commit:** `feat(settings): logo, signatory email and signature image uploads`.

---

## Task 3.28: Legacy bucket runbook (documented, not executed)

**Lane:** coordinator. **Files:** `docs/runbooks/legacy-professional-documents-bucket.md`.

Steps for Jonathan's go-ahead (design §7, Drop #7):
1. List the 39 objects: Storage API `list` with the service key, run by Jonathan locally. Never commit the output.
2. Download them into `clinique-mana-backups/<date>-professional-documents/`, outside git.
3. Check that the count and sizes match.
4. Delete the objects, then the bucket, through the Storage API (`emptyBucket`, `deleteBucket`).
5. Record the date in the status doc.

It states clearly: **staging mutation, a Drop, only with Jonathan's explicit OK**. The plan never runs it.

**Commit:** `docs(runbook): legacy professional-documents bucket backup and drop (pending go-ahead)`.

---

# Batch 3f — E-signature and the shared PDF renderer

## Task 3.29: PDF renderer spike (Q1, first task of the batch)

**Lane:** F. It is pure Deno, so it can start in step 1 of the lanes; the edge-runtime measurement needs the DB token. **PS Hub reference:** PS Hub renders PDFs in the browser (`@react-pdf/renderer`) and uses `pdf-lib`. We do not port the browser path (design §6.1); `pdf-lib` is a candidate only for post-processing (page count, field checks).

**Goal:** decide, with numbers, whether pdfmake runs inside Supabase Edge Functions within budget for our two documents. Timebox: **one working session**.

**Files** (the spike code is kept only if adopted; otherwise it is deleted in the same task):
- `supabase/functions/_shared/pdf/spike/reference-contract.ts`: a document model for a realistic **6-page contract**: 4 pages of clauses with headings, numbered lists and bold; an Annexe A table of 12 rows × 4 columns; a signature page with two signature blocks; a header with an initials box on every page; a footer « Page x de y ». It uses FR-CA text with accents, « », ’ and `$` amounts.
- `supabase/functions/_shared/pdf/spike/reference-fiche.ts`: a 2-page fiche with a 600×200 PNG logo and a 400×400 JPEG photo.
- `supabase/functions/_shared/pdf/spike/bench.ts`: `Deno.bench` for both.
- `supabase/functions/spike-pdf/index.ts`: temporary; renders the contract and logs `performance.now()` deltas; **deleted at the end of the task**.

**Candidates and fonts:**
- pdfmake (exact version pinned; prefer the 0.2.x server `PdfPrinter`, or 0.3's Node build, whichever imports cleanly as `npm:` in Deno).
- **Inter:** `@fontsource/inter` (npm; the static weights 400 / 600 / 700, `latin` subset, woff2). Install with `npm install --save-dev @fontsource/inter@5`, and **read the font files from the package** at build time.
  - Embed them as base64 in `supabase/functions/_shared/pdf/fonts.ts`, generated by `scripts/build-pdf-fonts.ts`, so the function needs no file access.
  - Check that fontkit decodes woff2 in Deno. If not, look for an npm package that ships Inter as TTF. A direct download from GitHub releases needs Jonathan's OK (download rule), so record the need in Mise en service and continue with the fallback decision below.

**Measurements** (record them in the ADR 0008 draft):
1. `deno bench --config supabase/functions/deno.json --allow-read supabase/functions/_shared/pdf/spike/bench.ts`: the median and p95 for each document, warm.
2. Cold, in the edge runtime (DB token): `functions serve`, the first request after a restart; log the render time and the total request time.
3. Bundle size: `deno info --json supabase/functions/spike-pdf/index.ts`, the sum of module sizes (fonts included).
4. Glyph check: extract the text with `pdf-lib`, or open the PDF in the browser pane. No `.notdef` boxes for `é è à ç ô « » ’ œ`.
5. Determinism: render twice; the field coordinates (signature and initials boxes, from the model's fixed positions) are identical, and the page count is stable.

**Decision rule** (written before measuring):
- **Adopt pdfmake** if **all** of these hold:
  - (a) glyphs are complete;
  - (b) the warm median is ≤ 300 ms **and** the cold render is ≤ 800 ms for the contract on the dev Mac. That leaves at least 2.5× headroom against the 2 s CPU-per-request limit of Supabase Edge Functions; re-check the limit in the Supabase docs on the day and write it down;
  - (c) the bundle is ≤ 10 MB (half the 20 MB function limit);
  - (d) field positions are deterministic.
- **Otherwise → Gotenberg:** the same `PdfRenderer` interface, implemented as HTML (rendered from the same document model) → `POST {pdf_renderer_url}/forms/chromium/convert/html`.
  - Tests use `fake-fetch`; locally, an optional `docker run --rm -p 55391:3000 gotenberg/gotenberg:8`.
  - Its host (on the Documenso server) and URL are added to Mise en service.
  - Field coordinates then come from fixed CSS boxes at known positions, with `@page` size Letter and margins in mm.
- **Fidelity escape hatch:** if Christine later needs Word-level fidelity, switch to Gotenberg. The interface makes it a one-module change.

**Output:**
- the decision recorded in `docs/adr/0008-server-side-pdf-rendering.md` (draft; finalised in Task 3.35);
- the numbers in the commit body;
- the spike function deleted;
- the bench kept as `supabase/functions/_shared/pdf/render.bench.ts` if pdfmake is adopted.

**Commit:** `spike(pdf): measure pdfmake in Deno and the edge runtime; decision in ADR 0008 draft`.

---

## Task 3.30: `_shared/pdf/` renderer (P3-19)

**Spike result (Task 3.29, commit 46a097f, ADR 0008 draft):** pdfmake 0.3.11 adopted. Warm contract median 134 ms, cold ≤ 246 ms, glyphs complete (fonts are WOFF, not WOFF2), byte-identical output. Two constraints carried into this task:
- **Bundle isolation (decided by the coordinator).** With pdfmake in the shared `deno.json`/`deno.lock`, the CLI bundler packs it into **every** function (supabase-js-only function: 0.93 → 7.37 MB uploaded). Fix it here: only the PDF-rendering functions (`signing-*` that render, the fiche function) may pull pdfmake. Use a per-function `deno.json` for those functions (Supabase supports one per function folder), or a pre-built vendored pdfmake module imported only by `_shared/pdf/`. Adjust `scripts/` lint rules if they forbid it, and document the exception in CLAUDE.md §7. **Acceptance:** `supabase functions deploy --dry-run`/bundle of a non-PDF function is back to ≈ 1 MB; a PDF function stays ≤ 10 MB uploaded (compressed upload size is the measure: it is what the 20 MB CLI limit applies to). Deploys keep bundling with the CLI (never `--use-api`, 5 MB cap).
- Fold in the spike notes: keep headings with the next block; images as data URLs only; pdfmake URL and local-file access both denied; the signature page must be the last block; convert U+202F to U+00A0 before rendering.

**Lane:** F (after Task 3.29). **Files:**
- `supabase/functions/_shared/pdf/model.ts`: the document model, a closed set of blocks (no HTML):
  ```ts
  export type Block =
    | { type: 'heading'; level: 1 | 2 | 3; text: string }
    | { type: 'paragraph'; runs: Run[] }                       // Run = { text: string; bold?: boolean }
    | { type: 'list'; ordered: boolean; items: Run[][] }
    | { type: 'table'; columns: { label: string; width: number }[]; rows: string[][] }   // ≤ 200 rows
    | { type: 'image'; assetKey: string; width: number }       // asset resolved by the caller
    | { type: 'pageBreak' }
    | { type: 'signaturePage'; signers: { role: string; label: string }[] }
  export interface PdfDocument {
    title: string
    header?: { text: string; initialsFor?: string[] }          // signer roles that initial each page
    footer: { text: string }                                   // + « Page x de y » automatically
    blocks: Block[]
  }
  export interface SigningField { role: string; type: 'SIGNATURE' | 'INITIALS' | 'DATE' | 'NAME'; page: number; x: number; y: number; width: number; height: number }  // percent of the page
  export interface RenderedPdf { bytes: Uint8Array; pageCount: number; fields: SigningField[] }
  export interface PdfRenderer { render(doc: PdfDocument, assets: Record<string, Uint8Array>): Promise<RenderedPdf> }
  ```
- `supabase/functions/_shared/pdf/template.ts`: `fillTemplate(body: PdfDocument, variables: TemplateVariable[], values, timezone)`. It substitutes `{{path}}` in text runs, with the same formatting rules as `_shared/email/render.ts` (reuse its value formatter; move it to `_shared/format.ts` so both import it, with no duplication). Unknown or missing required → an error code.
- `supabase/functions/_shared/pdf/pdfmake-renderer.ts` (or `gotenberg-renderer.ts`, per the spike): Letter size; fixed margins; header and footer; Inter.
  - **Initials:** a box at a fixed position in each page header, per `initialsFor` role.
  - **Signature page:** always a new page, signature blocks at fixed positions.
  - Return the `fields` in percent of the page.
- `supabase/functions/_shared/pdf/index.ts`: `pdfRendererFromEnv(env, fetch)`, plus `loadAssets(serviceClient, refs: { key, fileId }[])`, which downloads the logo and signature from storage **in parallel**.

**Tests:**
- model validation: a table over 200 rows, or an unknown block type, is refused;
- `fillTemplate`: escaping is not needed (no HTML), but control characters are stripped; date-only vs datetime formatting as in email;
- render: the page count for the reference contract is stable; one `SIGNATURE` field per signer on the last page; one `INITIALS` field per page per `initialsFor` role; all fields within 0–100;
- the output starts with `%PDF-`;
- the bench (if pdfmake) stays under the spike numbers + 20 % (run in review, not in CI).

**Commit:** `feat(functions): shared server-side PDF renderer with fixed signing fields`.

---

## Task 3.31: Signing (database)

**From lane F (Task 3.32, commit a0cca70):** the local seed sets the signing base URL to `http://host.docker.internal:55390` (the fake started by `npm run fake:documenso`) and the two org secrets to `local-dev-documenso-api-key` / `local-dev-documenso-webhook-secret`. `signing-webhook` passes Documenso's raw event names (`DOCUMENT_COMPLETED`, `DOCUMENT_CANCELLED`, …) to `documensoEventId`. `signature_requests` keeps `provider_document_id` even when a later creation step fails (the client's error carries it) so the reconcile job can cancel it. **From lane F (Task 3.30, commit a03143c):** `get_signing_context` returns `{ bucket, object_path }` for the logo and signature images (the renderer's `loadAssets` takes `{ key, bucket, path }`); `update_template_version`'s placeholder check scans **every string** in the body JSON (the renderer fills all of them, with the same placeholder rule as emails); the logo and signature upload purposes (Task 3.24) accept **PNG and JPEG only**: pdfmake cannot embed WebP.

**Lane:** DB. **Files:**
- Create: `supabase/migrations/<ts>_core_signing.sql`
- Create: `supabase/tests/database/023_core_signing.test.sql`

**Tables** (design §6.2 + P3-30):
- **`signing_settings`**:
  - `org_id pk`;
  - `base_url text null`, `check (base_url ~ '^https://[a-z0-9.-]+(:[0-9]+)?(/.*)?$' or base_url ~ '^http://host\.docker\.internal:[0-9]+(/.*)?$')`, with a comment: the second form is the local fake only, since it resolves only on dev machines;
  - `expiry_days int not null default 7 check (between 1 and 60)`, `updated_at`, `updated_by`;
  - created per org by trigger + backfill;
  - select with `settings.view`; written by `set_signing_settings(p_base_url, p_expiry_days)` (`settings.integrations_manage`);
  - audited.
- **`document_templates`**:
  - `id, org_id, key (unique per org; must start with module_key || '.'), module_key → modules, title, description, view_permission → permissions, edit_permission → permissions, is_active, timestamps`;
  - select: own org and `view_permission = any ((select private.current_permission_keys())::text[])`;
  - audited.
- **`document_template_versions`** as in design §6.2:
  - `body jsonb check (jsonb_typeof(body) = 'object' and pg_column_size(body) <= 262144)` (the `PdfDocument` model);
  - `variables jsonb` (array, same item shape as email);
  - `signers jsonb` (array of `{ role, label, order, required }`, roles in `professional|clinic|client`);
  - `email_subject`, `email_message` (Documenso's invitation text);
  - partial unique `(template_id) where status = 'published'`;
  - select through the template's permission (an `exists` on `document_templates` with the indexed `template_id`);
  - audited.
- **`signature_requests`** as in design §6.2:
  - `status check in ('draft','sent','viewed','signed','rejected','cancelled','expired')`;
  - `template_version_id` null only when `purpose = 'core.signing_test'` (check);
  - `last_error text check (~ '^[a-z0-9_]{1,64}$')`;
  - `source_file_id` / `signed_file_id → stored_files`;
  - `unique (org_id, idempotency_key)`;
  - indexes: `(org_id, subject_type, subject_id, created_at desc)`; `(status, sent_at) where status in ('sent','viewed')` (reconcile); FK indexes;
  - select: own org and `view_permission = any ((select private.current_permission_keys())::text[])`;
  - audited.
- **`signature_request_signers`** as in design §6.2:
  - composite reference to the request's org;
  - `email` and `name`, redacted in the audit trigger (`private.audit_trigger('email','name')`): the request's timeline shows roles, not addresses;
  - select through the request (`exists` on the indexed `request_id`).

**RPCs:**
- **Template admin** (user; each checks the template's `edit_permission`, ported from legacy A5):
  - `create_document_template(p_key, p_module_key, p_title, p_description, p_view_permission, p_edit_permission)` (the caller must hold `p_edit_permission`);
  - `create_template_version(p_template_id) returns uuid`: refuses if a draft exists (P0001 « Une version brouillon existe déjà. »); copies the published version, else creates an empty body;
  - `update_template_version(p_id, p_body, p_variables, p_signers, p_email_subject, p_email_message)`: draft only (P0001 « Seule une version brouillon peut être modifiée. »); validates that every `{{path}}` in `p_body` text runs is declared (same message as email);
  - `publish_template_version(p_id)`: draft only; archives the previous published version, in one statement order safe for the partial unique index (archive first, then publish);
  - `archive_template_version(p_id)`.
- **User reads** (all invoker, so RLS applies):
  - `list_document_templates(p_module_key text default null)`;
  - `list_subject_signature_requests(p_subject_type, p_subject_id)` (P3-26), with the signers' roles and statuses;
  - `get_signature_request(p_id)`, one row or none (used by `signing-sync` in user mode).
- **Service role:**
  - `get_signing_context(p_org_id, p_template_version_id) returns jsonb`: one round trip with the published version (body, variables, signers, email texts), `signing_settings`, the clinic identity, timezone, `module_enabled`, and the signatory (name, title, `signatory_email`, `signature_file_id`, `logo_file_id`);
  - `create_signature_request(p jsonb) returns table (id uuid, existing boolean)`: idempotent on `(org_id, idempotency_key)`; inserts the request (`draft`) and its signers;
  - `mark_signature_request_sent(p_id, p_documenso_document_id, p_source_file_id, p_signer_recipients jsonb /* [{signer_id, recipient_id}] */, p_expires_at)`;
  - `mark_signature_request_failed(p_id, p_error_code)` (stays `draft`, sets `last_error`);
  - `apply_signing_event(p_org_id, p_request_id, p_documenso_document_id, p_event text, p_recipient_id text, p_at timestamptz, p_reason text) returns table (outcome text, request_id uuid, module_key text, needs_download boolean)`:
    - finds the row by id, else by document id; another org → `not_found`;
    - monotonic transitions: `DOCUMENT_OPENED` (sent→viewed), recipient signed (the signer → signed), `DOCUMENT_COMPLETED` (`needs_download = true` when every required signer is signed or the event says completed), `DOCUMENT_REJECTED` (→ rejected + reason, cut to 500), `DOCUMENT_CANCELLED` (→ cancelled);
    - a terminal state never moves; a disabled module → `ignored`;
  - `complete_signature_request(p_id, p_signed_file_id, p_signed_sha256)` → `signed`, `completed_at`;
  - `list_signature_requests_to_reconcile(p_limit int default 100)`: `sent`/`viewed` with `sent_at < now() - interval '1 day'`, plus `draft` older than 1 day (to clean), plus overdue `expires_at`;
  - `expire_signature_request(p_id)`.
- **Upload purposes** (for `register_system_file`): `signing_source` (bucket `documents`, view from the request) and `signing_signed` (bucket `signed-documents`). Both have `upload_permission` = `settings.integrations_manage`: no client ever uses them; that is just the strictest core key.
- **Job:** `core.signing_reconcile` (function `signing-sync`, maintenance, `50 8 * * *`).

**Tests:**
- **Privileges** on the four tables (select only) and the service RPCs.
- **Versions:**
  - one published version per template: publishing a second archives the first;
  - a draft cannot be published twice;
  - `create_template_version` with an existing draft → the P0001 text;
  - editing a published version → the P0001 text;
  - an undeclared variable in the body → P0001;
  - a non-holder of `edit_permission` → `42501`.
- **Visibility:** a request with `view_permission = 'users.view'` is visible to admin A, invisible to the conseillère and to org B; a template with a disabled module's permission is invisible.
- **Idempotency:** the same key → `existing = true` and one row.
- **Transitions:**
  - opened → viewed;
  - opened after signed → unchanged;
  - rejected stores a reason ≤ 500 characters;
  - completed → `needs_download`;
  - a cancelled request ignores later events;
  - another org's document id → `not_found`.
- **`base_url`:** `http://evil.test` → `23514`; `http://host.docker.internal:55390` → ok; `https://sign.cliniquemana.com` → ok.
- **Audit:** the signers' audit rows redact `email` and `name`.

**Commit:** `feat(db): document templates with versions, signature requests and signing settings`.

---

## Task 3.32: Documenso client and the local fake

**Lane:** F. **PS Hub reference:** `supabase/functions/approve-contract/index.ts` (`/api/v2/document/create` multipart with a `payload` field, `/api/v2/document/distribute`, `GET /api/v2/document/{id}`, `Authorization: <key>` without `Bearer`), `resend-contract-email/index.ts` (redistribute), `documenso-webhook/index.ts` + `idempotency.ts` (event names, `documensoEventId`, signed-PDF download, the stable upsert path).

**Files:**
- `supabase/functions/_shared/documenso.ts` + test:
  ```ts
  export interface DocumensoClient {
    createDocument(pdf: Uint8Array, input: { title: string; externalId: string; recipients: { email: string; name: string; role: 'SIGNER'; signingOrder: number }[];
      meta: { subject: string; message: string; language: 'fr'; distributionMethod: 'EMAIL'; signingOrder: 'SEQUENTIAL' | 'PARALLEL' } }):
      Promise<{ documentId: string; recipients: { id: string; email: string }[] }>
    addFields(documentId: string, fields: (SigningField & { recipientId: string })[]): Promise<void>
    distribute(documentId: string): Promise<void>
    get(documentId: string): Promise<{ status: 'DRAFT' | 'PENDING' | 'COMPLETED' | 'REJECTED' | 'CANCELLED'; recipients: { id: string; signingStatus: string; readStatus: string }[] }>
    redistribute(documentId: string, recipientIds: string[]): Promise<void>
    cancel(documentId: string): Promise<void>
    downloadSigned(documentId: string): Promise<Uint8Array>
    ping(): Promise<{ ok: true } | { ok: false; status: number }>
  }
  export function documensoClient(baseUrl: string, apiKey: string, fetchFn: typeof fetch): DocumensoClient
  export function documensoEventId(event: string, documentId: string, version: string | null): string  // terminal: `${event}:${id}`; else `${event}:${id}:${version}`
  ```
  - The base URL comes from `signing_settings` and the key from Vault: never a constant (deviation from PS Hub).
  - Errors throw a `DocumensoError { status, code }` with no response body. Endpoint paths are in one table at the top of the file.
  - For `cancel`, `downloadSigned` and the field API, read the instance's OpenAPI document (`{base}/api/v2/openapi.json`) once the instance exists. Until then, write them from the v2 docs and mark each endpoint `// VERIFY against the clinic instance (Mise en service)`. The fake server mirrors exactly these paths, and the staging smoke test confirms them.
- `scripts/fake-documenso.mjs` (Node, no dependency; port 55390; in-memory). It implements the client's paths, checking `Authorization: local-dev-documenso-key`. Admin routes:
  - `POST /__fake/sign/:id?recipient=…`: posts a `DOCUMENT_SIGNED` webhook;
  - `POST /__fake/complete/:id`: marks completed and posts `DOCUMENT_COMPLETED`;
  - `POST /__fake/reject/:id`;
  - `POST /__fake/open/:id`.

  Webhooks go to `FAKE_DOCUMENSO_WEBHOOK_URL` (default `http://127.0.0.1:55321/functions/v1/signing-webhook?org=<SEED_ORG_ID>`) with `X-Documenso-Secret: local-dev-documenso-webhook-secret`. `downloadSigned` returns the uploaded PDF with a one-page certificate appended (built with plain PDF text, or the original bytes when that is too complex: it is a fake).
- `supabase/functions/_shared/testing/fake-documenso.ts`: the same behaviour as a `fake-fetch` route table, for Deno tests.
- `supabase/seed.sql` (**DB lane**, same merge window):
  - `signing_settings.base_url = 'http://host.docker.internal:55390'` for the seed org;
  - org secrets `documenso_api_key = 'local-dev-documenso-key'` and `documenso_webhook_secret = 'local-dev-documenso-webhook-secret'`.
- `package.json`: `"fake:documenso": "node scripts/fake-documenso.mjs"`.

**Tests:**
- `createDocument` sends multipart with `payload` JSON (`externalId`, `language: 'fr'`, `distributionMethod: 'EMAIL'`) and the PDF part;
- the `Authorization` header has no `Bearer`;
- a 500 → `DocumensoError` without the body text;
- `documensoEventId('DOCUMENT_COMPLETED', '12', 'x')` → `'DOCUMENT_COMPLETED:12'`; `('DOCUMENT_OPENED', '12', '2026-…')` → it includes the version;
- `ping` maps 401 → `{ ok: false, status: 401 }`.

**Commit:** `feat(functions): Documenso v2 client and a local fake server`.

---

## Task 3.33: `_shared/signing.ts` and the signing functions

**From Task 3.30:** pdfmake is vendored at `_shared/pdf/vendor/pdfmake.js` and imported only by `_shared/pdf/render.ts`. Keep the code that renders (request creation) in a module that `signing-webhook` and `signing-sync` do not import, so those functions stay small (≈1.4 MB vs ≈1.9 MB uploaded).

**Lane:** F (after Tasks 3.31 and 3.30 merge). **Files:**
- `supabase/functions/_shared/signing.ts` + test:
  ```ts
  export interface CreateSignatureRequestInput {
    orgId: string; moduleKey: string; purpose: string; templateVersionId: string | null
    subject: { type: string; id: string }; title: string; viewPermission: string
    values: Record<string, unknown>; signers: { role: 'professional' | 'clinic' | 'client'; name: string; email: string; order: number }[]
    idempotencyKey: string; sentBy: string | null
    document?: PdfDocument      // only the built-in test document; otherwise from the template version
  }
  export type CreateSignatureRequestResult =
    | { ok: true; requestId: string; existing: boolean }
    | { ok: false; code: 'not_configured' | 'module_disabled' | 'missing_variable' | 'provider_error'; requestId: string | null }
  export async function createSignatureRequest(deps, input): Promise<CreateSignatureRequestResult>
  ```
  **Order:**
  1. `Promise.all([get_signing_context, get_org_secret('documenso_api_key')])`. No base URL or key → `not_configured`.
  2. `create_signature_request` (idempotent: an existing `sent` row → return it, no second document).
  3. `fillTemplate` + `loadAssets` (logo, signature image, in parallel) → `renderPdf`.
  4. `register_system_file` (`documents`, purpose `signing_source`) → upload the bytes (service storage, `upsert: false`).
  5. Documenso `createDocument` (`externalId = request id`) → `addFields` → `distribute`.
  6. `mark_signature_request_sent` (`expires_at = now + expiry_days`).

  A failure after step 5 started → `cancel` at Documenso (best-effort) + `mark_signature_request_failed(code)` → `provider_error`.
- `signing-webhook/` (design §6.3):
  1. `?org=` → `get_org_secret(org, 'documenso_webhook_secret')`; none → 401 (fail closed).
  2. `timingSafeEqual(header, secret)` → 401 on mismatch (fixes PS Hub's `!==`).
  3. Body ≤ 256 KB.
  4. Event name normalised as in PS Hub.
  5. `claimEvent('documenso', documensoEventId(...), org, event, { event, document_id, external_id })`, a minimised payload (no recipient emails).
  6. `apply_signing_event`:
     - `needs_download` → `downloadSigned` → `register_system_file` (`signed-documents`, `upsert: true` at the stable path `{org}/core/{request_id}/signed.pdf`; `register_system_file` returns the existing row for that path, so a retry is idempotent) → `complete_signature_request` with the SHA-256;
     - `ignored` / `not_found` → complete and 200.
  7. Exception → `failEvent` → 500.
- `signing-sync/`:
  - **user mode:** `verifyAuth`; body `{ request_id }`; the row read through RLS with `get_signature_request(p_id)` (user client; no row → 404); module gate; Documenso `get` → map to events → `apply_signing_event` (and the download when completed);
  - **cron mode:** `verifyServiceRoleAuth` → `runJob('core.signing_reconcile')`:
    - each org's `list_signature_requests_to_reconcile` batch is processed with a concurrency of 4 (`Promise.all` over chunks), not one by one, and not unbounded;
    - overdue → `cancel` + `expire_signature_request`;
    - stale drafts → `cancel` if they have a document id, then `mark_signature_request_failed('abandoned')`.
- `signing-test-connection/`: `verifyAuth(settings.integrations_manage)` → `ping` → `{ ok }` or `{ ok: false, status }`. Never echo the key or URL.
- `signing-test-document/`: `verifyAuth(settings.integrations_manage)` → `createSignatureRequest` with `purpose: 'core.signing_test'`:
  - the built-in one-page document (`_shared/pdf/test-document.ts`: « Document test de signature électronique — Clinique MANA »);
  - signer = the caller (`auth.access.email`, `display_name`);
  - subject `signing_test` / the caller's id;
  - `view_permission: 'settings.integrations_manage'`.
- `config.toml`: all four `verify_jwt = false` (DB lane merge).

**Tests:**
- **`createSignatureRequest`:**
  - the happy-path call order: context ∥ secret → create row → assets (parallel) → render → register + upload → create → fields → distribute → mark sent;
  - idempotency: an existing sent row → no Documenso call;
  - no key → `not_configured` and no row;
  - a distribute failure → `cancel` + `mark_signature_request_failed('provider_unavailable')`.
- **Webhook:**
  - a wrong secret, compared with `timingSafeEqual` (assert through a spy on the helper) → 401;
  - no secret → 401;
  - a duplicate → 200 with no apply;
  - completed → download + register + complete (SHA-256 checked);
  - a second completed for the same document → `duplicate` (terminal id without a version);
  - a disabled module → 200, nothing applied;
  - the claim payload has no email.
- **Sync:**
  - user mode without `view_permission` → 404;
  - cron with 10 requests → at most 4 concurrent Documenso calls (count in-flight in the fake);
  - an overdue request is expired.
- **Test connection:** a 401 from Documenso → `{ ok: false, status: 401 }`; the response contains neither the key nor the URL.

**Live probe (DB token):**
1. `npm run fake:documenso` + `functions serve` + `npm run dev`.
2. As admin: « Signature électronique » → « Tester la connexion » → ok.
3. « Envoyer un document test » → the request is `sent`; the fake shows the document; `stored_files` has the unsigned PDF.
4. `curl -X POST http://127.0.0.1:55390/__fake/open/<id>` → `viewed`.
5. `/__fake/complete/<id>` → `signed`; `signed-documents/{org}/core/{id}/signed.pdf` exists; `last_webhook_event_at('documenso')` is set.
6. Replay the same completed webhook → no change, `duplicate`.
7. `select private.invoke_job_function('core.signing_reconcile')` → a run `ok`.

**Commit:** `feat(functions): signature requests, Documenso webhook, sync and test tools`.

---

## Task 3.34: « Signature électronique » section

**Lane:** U (after Task 3.33 merges). **Files:**
- Create: `src/core/signing/{api.ts,api.test.ts,hooks.ts}` (`signingKeys`)
- Create: `src/core/settings/pages/SigningSettingsPage.tsx` + test
- Modify: `sections.ts` (`{ id: 'signing', path: 'signature-electronique', icon: FileSignature, permission: 'settings.view', editPermission: 'settings.integrations_manage', group: 'plateforme', component: lazyPage(…, 'SigningSettingsPage') }`), `fr-CA.json` (`settings.signing.*`, `settings.sections.signing` « Signature électronique »)

**Cards** (design §6.4):
- **Connexion:**
  - « Adresse de l'instance » (Zod mirrors the SQL check, message « L'adresse doit commencer par https:// »);
  - « Clé d'API » (`SecretField` → `documenso_api_key`);
  - « Tester la connexion » → « Connexion réussie », or « La connexion a échoué (code {status}). ».
- **Webhook:**
  - « Adresse du webhook » read-only + « Copier » (`${VITE_SUPABASE_URL}/functions/v1/signing-webhook?org=${org_id}`);
  - « Secret » (`SecretField` → `documenso_webhook_secret`);
  - « Dernier événement reçu le … » / « Aucun événement reçu ».
- **Envoi:**
  - « Délai d'expiration (jours) » (1–60);
  - « Envoyer un document test » → toast « Document test envoyé à {email}. Signez-le pour vérifier le circuit complet. »
  - The last test request's status is shown: one `list_subject_signature_requests('signing_test', me)` call, limit 1.
- **Read-only** for `settings.view` holders without `settings.integrations_manage`.

**Tests:** the permission matrix (admin editable; adjointe read-only); the URL validation; the test-connection results; « Copier » writes the URL to the clipboard; `SecretField` never renders values; the three cards' queries start in parallel.

**Browser check** (DB token, with the fake): the full test-document round trip from the UI, with the fake's admin routes; screenshots.

**Commit:** `feat(settings): Signature électronique section`.

---

## Task 3.35: ADR 0005 status and ADR 0008

**From Task 3.30:** update ADR 0008: pdfmake is vendored (`npm run build:pdfmake`, pinned by `scripts/build-pdfmake.lock`), not an npm import in `deno.json`; uploaded sizes are ≈1.35 MB for a non-PDF function and ≈1.86 MB for a rendering one; `isolation.test.ts` guards it.

**Lane:** coordinator. **Files:** `docs/adr/0005-documenso-replaces-docuseal.md`, `docs/adr/0008-server-side-pdf-rendering.md`, `docs/adr/README.md`.
- **ADR 0005:**
  - status « Accepted (built: Phase 3 core signing) »;
  - replace `signing-create` with « module functions call `_shared/signing.ts` »;
  - the webhook's `timingSafeEqual` and its claim;
  - Documenso sends the signing emails (P3-3).
- **ADR 0008:**
  - the spike numbers and the rule applied;
  - the `PdfRenderer` interface and the closed document model (no HTML from templates);
  - fixed-position signing fields;
  - the fallback and its trigger.

**Commit:** `docs(adr): 0005 built, 0008 server-side PDF rendering`.

---

# Batch 3g — Wrap-up

## Task 3.36: Documentation

**Lane:** coordinator. **Files:**
- `docs/modules/core.md`: every new table, RPC, catalogue (purposes, upload purposes, jobs, template defaults), permission, bucket, function and job, with « how a module plugs in »:
  - seed a link purpose with handler RPCs;
  - seed upload purposes;
  - seed email template defaults (`<module>.<name>`, variables catalogue, `view_permission`, `recipient_mode`, `allows_attachments`);
  - seed a job with `local_hour`;
  - call `private.notify`;
  - call `createSignatureRequest` / `sendTemplatedEmail` from a module function.
- `CLAUDE.md`:
  - §1 « Built so far »;
  - §4 structure: `core/email`, `core/notifications`, `core/jobs`, `core/invitations`, `core/storage`, `core/signing`, `_shared/{email,pdf}`, the new shared files, `scripts/fake-documenso.mjs`;
  - §6: `current_permission_keys` for row-level permission columns, and the operational-log exceptions;
  - §7: already done in Task 3.4; check it;
  - §8: `SecretField`, `FileDropzone`, upload via `uploadFile`, signed URLs 5 min, function error codes mapped to i18n.
- `docs/plans/2026-10-07-decisions-log.md`: a « Phase 3 decisions (delegated by Jonathan, 2026-10-08) » table, #41 onward, mirroring P3-1 … P3-30 with links to this plan.
- `docs/plans/2026-10-07-status.md`:
  - rewrite for Phase 3: what's done; how to test locally (the four accounts, Mailpit, `npm run fake:documenso`, `supabase/functions/.env`, `send-test-webhook.mjs`); what deploys on merge;
  - follow-ups: remove the hash reader after one release; the Q13 neutral email change before client accounts; an antivirus before the client portal; an outbox if 4c reminders fail.
- `docs/plans/2026-10-06-legacy-feature-inventory.md`: tick A3 (core parts), A4 (core parts), A5 (core parts), A9 (invite audit), A10.2 / A10.3 / A10.9 (fixed), and I (scheduled tasks), each with a pointer.
- `docs/plans/2026-10-08-professionals-module-design.md`: a short « Aligned with Phase 3 plan » note at the top of §7, listing P3-15–P3-20 and P3-22 (template key prefix, storage path, signed URL duration, `contract.sent` dropped, handlers, staged uploads, local-hour jobs). Do not rewrite the Phase 4 design.

**Commit:** `docs: Phase 3 core module doc, CLAUDE.md, decisions, status and inventory`.

---

## Task 3.37: Full verification, walkthrough, review, handoff

**Lane:** coordinator, DB token held throughout.

**Step 1: Full checks.**
```bash
npm run typecheck && npm run lint && npm run lint:supabase && npm run test:run && npm run build
npm run db:reset && npm run db:test && npx supabase db reset --no-seed && npm run db:test && npm run db:reset
npm run check:functions && npm run lint:functions && npm run test:functions
npm run build:auth-templates && git diff --exit-code supabase/templates
BASE_REF=origin/main npm run lint:migrations
npm run db:types && git diff --exit-code src/core/supabase/database.types.ts
```
Expected: all green, no diff.

**Step 2: Secrets scan.**
```bash
git diff feat/phase-2-core-settings --stat
git diff feat/phase-2-core-settings | grep -nE 're_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9+/=]{30,}|sk_live|eyJhbGciOi' || echo "no secret-like strings"
```
Expected: only the `local-dev-…` fakes and the Svix docs' test vector.

**Step 3: Browser walkthrough** (`http://localhost:5173`, the four accounts, Mailpit, the fake Documenso; desktop and 375 px). Record the results in the status doc:
- **admin:**
  - Courriels: sender, keys (fake), template edit + preview + test, Historique with a bounced row (`send-test-webhook.mjs --type email.bounced`);
  - Tâches planifiées: « Exécuter maintenant » on a maintenance job;
  - invite a counselor, accept in a private window, sign in;
  - disable that user, then check that the refresh fails (devtools: the next refresh 400s);
  - logo and signature image;
  - Signature électronique: test connection, test document signed through the fake;
  - the bell with a notification created by `select private.notify(…)` in SQL;
  - forgot password, magic link, email change through `/connexion/confirmer`.
- **adjointe:** Courriels, Signature électronique and Tâches planifiées read-only; Utilisateurs per her permissions; no signature-image card.
- **conseillère:** no Paramètres; the bell works; `/invitation#t=garbage` → « Ce lien n'est pas valide. »
- **professionnel:** Mon compte and the bell only.

**Step 4: Efficiency review** (Review checklist):
- `explain (analyze, buffers)` with 10 000 generated rows each for `list_email_log`, `list_subject_emails`, `list_my_notifications`, `count_my_unread_notifications`, `list_staff_invitations`, `list_scheduled_jobs`, and `storage.objects` select through `can_read_object`;
- record the plans and timings;
- any seq scan on a large table, or > 5 ms → add the index in a fix-forward migration.

**Step 5: Final review.** Dispatch `superpowers:code-reviewer` on `git diff feat/phase-2-core-settings...feat/phase-3-shared-services`, with the design, this plan and the review checklist. Fix the findings and have them re-reviewed.

**Step 6: Report to Jonathan.** Say what was built, with screenshots and the lane merge log. Hand him « Mise en service » below and the staging smoke test (design §11), then ask separately for:
1. push + PR;
2. the merge (which deploys the migrations and functions to staging; the cron jobs start, and function jobs log `configuration_missing` until the Vault secrets exist, which is harmless);
3. each Mise en service item.

---

## Mise en service (Jonathan)

Nothing below is needed to build or test Phase 3. Each item is done by Jonathan, or by an agent with his explicit go-ahead in chat for that item (CLAUDE.md §11). Never paste a key in chat or git.

| # | Item | Where | Notes / how to verify |
|---|---|---|---|
| 1 | **Resend API key for the app** | Resend → API keys: « Sending access », restricted to `gestion.cliniquemana.com`. Paste it in Paramètres → Courriels → « Clé d'API Resend » | Separate from the Supabase Auth SMTP key, so each can be rotated alone. Verify: « M'envoyer un test » arrives |
| 2 | **Resend webhook** | Resend → Webhooks: endpoint `https://vnmbjbdsjxmpijyjmmkh.supabase.co/functions/v1/resend-webhook?org=<org_id>` (copy it from Courriels), events `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`. Paste its signing secret (`whsec_…`) in Courriels → « Secret du webhook » | Verify: « Dernier événement reçu » updates; a send to `bounced@resend.dev` shows « Adresse introuvable » |
| 3 | **Tracking off** | Resend → Domains → `gestion.cliniquemana.com`: open tracking **off**, click tracking **off** | Click tracking would rewrite secure links; open tracking reveals IPs (design §2.1) |
| 4 | **Documenso instance** | Self-hosted, e.g. `sign.cliniquemana.com`, hosted in Canada if possible | Needs: a signing certificate (`.p12`) to seal PDFs; SMTP through Resend on the clinic domain; clinic branding; an admin account and team; an **API token** (« Clé d'API » in Signature électronique); a **webhook** to `…/functions/v1/signing-webhook?org=<org_id>` with a secret (« Secret »). Then run « Tester la connexion » and « Envoyer un document test ». Confirm the `// VERIFY` endpoints of `_shared/documenso.ts` against the instance's OpenAPI |
| 5 | **Gotenberg** (only if the Task 3.29 spike chose it) | On the Documenso host, not public (firewalled to Supabase egress, or behind a shared secret header) | Function secret `GOTENBERG_URL` (+ secret) |
| 6 | **DNS** | Registrar | A record + TLS for the signing domain; **fix `_dmarc.cliniquemana.com`** (missing `;` before `rua=`, noted in Phase 1); confirm `app.cliniquemana.com` points at Vercel. Verify: Gmail « Afficher l'original » shows SPF, DKIM and DMARC = PASS |
| 7 | **Staging Auth templates** | Supabase dashboard → Auth → Email templates | Paste the 5 generated templates from `supabase/templates/` (recovery, magic_link, email_change, confirmation, reauthentication) with their French subjects from `config.toml`. `invite.html` is unchanged |
| 8 | **Site URL and redirects** | Dashboard → Auth → URL configuration | Site URL `https://app.cliniquemana.com` (P3-2); redirect allow-list includes `https://app.cliniquemana.com/connexion/confirmer`, `/reinitialiser-mot-de-passe`, `/mon-compte`, `/**`. Verify: the forgot-password link points at `app.cliniquemana.com/connexion/confirmer` |
| 9 | **Function secrets** | `supabase secrets set --project-ref vnmbjbdsjxmpijyjmmkh …` | `INTERNAL_FUNCTION_SECRET` (a new random 32+ byte value, generated by Jonathan), `APP_URL=https://app.cliniquemana.com`, `ALLOWED_ORIGINS=https://app.cliniquemana.com`, `EMAIL_TRANSPORT=resend`, optional `SENTRY_DSN` |
| 10 | **Database Vault secrets** (for `pg_net`) | SQL editor, run by Jonathan | `select vault.create_secret('https://vnmbjbdsjxmpijyjmmkh.supabase.co', 'project_url', 'pg_net → edge functions');` and `select vault.create_secret('<same value as INTERNAL_FUNCTION_SECRET>', 'internal_function_secret', 'pg_net → edge functions');`. Verify: « Tâches planifiées » shows `ok` runs the next morning, not `configuration_missing` |
| 11 | **Anon key type** | Dashboard → API keys | The web app must use the legacy anon **JWT** key (`resolve-link` / `accept-invite` have `verify_jwt = true`). If the project has moved to publishable keys only, tell the agent: both functions switch to `verify_jwt = false` with an explicit `apikey` check (inconsistency #14) |
| 12 | **Client IP header** | After deploy, one `resolve-link` call | Send a request with a **forged** `X-Forwarded-For: 198.51.100.7` and log what the function receives (temporary log, with the go-ahead). If the forged value survives as the first hop, switch `clientIp` to the rightmost hop added by the trusted proxy (or `cf-connecting-ip` if present) before real use: otherwise per-IP limits on `resolve-link` / `accept-invite` can be bypassed (Task 3.4 review) |
| 13 | **Disabled-user refresh** (P3-9) | Staging smoke test step 5 | Confirm that a banned user's refresh fails on hosted GoTrue too |
| 14 | **Drop: legacy bucket** `professional-documents` (39 test files) | Runbook `docs/runbooks/legacy-professional-documents-bucket.md` | Back up into `clinique-mana-backups/`, then delete through the Storage API. **Only with Jonathan's OK**; no inventory feature is dropped |
| 15 | **Loi 25** (Christine) | Privacy officer | EFVP for Resend (United States) and the Documenso host before real personal data is sent; list the processors in the privacy policy; confirm the 24-month `email_log` anonymisation (P3-6) |
| 16 | **Inter TTF** (only if the spike needed it) | Download from the official Inter release | Requires Jonathan's OK (download rule); the agent then regenerates `_shared/pdf/fonts.ts` |
| 17 | **Merge = deploy** | GitHub | Push, PR and merge each need his go-ahead. After the merge, run the staging smoke test of design §11 step by step, each with a go-ahead |

---

## Execution handoff

Plan complete and saved to `docs/plans/2026-10-08-phase-3-shared-services-plan.md`. Jonathan delegated the choices (2026-10-08), so execution proceeds without questions. The lanes above are the default:
- **Subagent-driven (this session):** one fresh subagent per task, in its lane's worktree, holding the DB token when the task says so; spec review, then quality review, after each task (superpowers:subagent-driven-development).
- **Parallel sessions:** one session per lane with superpowers:executing-plans, coordinated through the phase branch and the DB token.

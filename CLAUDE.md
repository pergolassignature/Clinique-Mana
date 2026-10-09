# CLAUDE.md — Clinique MANA

Rules and pointers only: the how and the why live in `docs/` and in the code. Do not restate them here.

## 1. Project

Clinique MANA is the management platform of a **dispatch clinic**: conseillères receive every request and match the client with one of ~50 independent professionals, 100 % online ([business context](docs/standards/business-context.md)). It is non-clinical: motifs are orientation tags, never diagnoses, and clinical notes stay out of the app (design D8). Tone and brand: [business context §6](docs/standards/business-context.md#6-brand--tone), which supersedes `docs/standards/brand.tokens.md` (legacy tokens).

- **Read first:** [decisions log](docs/plans/2026-10-07-decisions-log.md), [ADRs](docs/adr/README.md), [status and « Mise en service »](docs/plans/2026-10-07-status.md), the module docs [`core`](docs/modules/core.md) and [`professionals`](docs/modules/professionals.md) (the module's published contract for Demandes: [« What the module publishes »](docs/modules/professionals.md#what-the-module-publishes)).
- **Built:** Phases 1–4: the core (auth, access, modules, settings, audit, secrets), the shared services (jobs, email, notifications, secure links and invitations, storage, e-signature, rate limits; [core doc](docs/modules/core.md#shared-services-phase-3)), and module **Professionnels** (batches 4a–4d; decisions P4-*, [plan](docs/plans/2026-10-08-professionals-module-plan.md)).
- **Legacy:** the old app lives in `_legacy/` (tag `legacy-v1`), **read-only**: never edit or import it (excluded from TypeScript, ESLint, Vite and CI). Its guidance (old `claude.md`, `.claude/workflows/`, `.claude/skills/`, status files, contracts, guides; listed in `_legacy/README.md`) **must not be followed**. Current rules: this file, `docs/standards/`, `docs/adr/`.
- Nothing the legacy app does may be lost silently: the parity checklist is [`docs/plans/2026-10-06-legacy-feature-inventory.md`](docs/plans/2026-10-06-legacy-feature-inventory.md).

## 2. Environments

| Environment | Where | Notes |
|---|---|---|
| Local | `supabase start` (ports **553xx**: API 55321, DB 55322, Studio 55323, Mailpit 55324) + `npm run dev` on **`http://localhost:5173`** | Use `localhost`, not `127.0.0.1` (a second origin is a second session). PS Hub's stack uses 543xx; never touch it. Test logins (four roles): header of `supabase/seed.sql`. Functions: `npx supabase functions serve --env-file supabase/functions/.env` (from `.env.example`: local fakes only); `npm run fake:documenso` (55390), `npm run fake:places` (55391). The stack is shared by every worktree: run DB work under `scripts/with-db-lock.sh`. |
| Remote | Supabase project `vnmbjbdsjxmpijyjmmkh` (Canada Central), app on `https://app.cliniquemana.com` | The only remote environment: it was staging and is becoming the clinic's production. It receives what `main` holds (§11). |

Node **22** everywhere (`.nvmrc`, `engines`, CI). `.env.local` (from `.env.example`) holds `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`; never put a service-role key in a `VITE_` variable.

## 3. Commands

```bash
npm run dev | typecheck | lint | lint:supabase | test:run | build      # web app (build = typecheck + vite build + login-chunk guard)
npm run lint:migrations                                                # migration timestamps (BASE_REF=origin/main)
npm run check:functions | lint:functions | test:functions              # deno, all of supabase/functions (--frozen lock)
deno fmt --config supabase/functions/deno.json supabase/functions/    # format the functions (CI runs it with --check)
npm run check:auth-templates                                           # supabase/templates/*.html match _shared/email
npm run build:pdfmake | build:pdf-fonts | build:auth-templates         # regenerate vendored / generated files
npm run db:start | db:reset | db:test | db:types                       # local stack, pgTAP, src/core/supabase/database.types.ts
```

Before a commit: `typecheck`, `lint`, `lint:supabase`, `test:run`; after a migration also `db:reset`, `db:test`, `db:types`. CI (`.github/workflows/ci.yml`) runs all of these, pgTAP with and without the seed, a types-drift check and Playwright; `migration-lint.yml` checks new migration timestamps.

## 4. Structure

```
src/app/              composition root: router, AuthenticatedApp, shell, modules.ts (ALL_MODULES)
src/core/<area>/      auth, access, account, modules, settings, users, audit, email, jobs, notifications,
                      storage, signing, invitations, address, preferences; supabase/ (the only client,
                      invokeFunction, generated database.types.ts: never edited)
src/modules/<name>/   manifest.ts, index.ts (public entry), api/ (the only Supabase calls, Zod-parsed),
                      hooks/ (keys.ts), schemas/, lib/ (pure), components/, pages/, test/
src/shared/           ui/ (design system), components/, lib/ (timezone, lazy-page, unsaved changes, …)
src/i18n/             fr-CA.json + typed t()
supabase/migrations/  core_* and <module>_*;  tests/database/ pgTAP (one file per migration + 000_invariants)
supabase/functions/   one folder per function (handler.ts + index.ts), _shared/, deno.json + deno.lock
supabase/seed.sql     LOCAL ONLY (local logins, local Vault secrets, fake provider secrets)
scripts/              build and check scripts, fakes, with-db-lock.sh, pii-health-check.sh, import-professionals.mjs
e2e/                  Playwright (local stack and seed logins, own dev server on 5190)
```

## 5. Module rules (design §6.2)

- A module is declared by `src/modules/<name>/manifest.ts` (`ModuleManifest`: `key`, `labelKey`, `dependsOn`, `nav`, `routes`, `settingsSections`) and listed in `ALL_MODULES`. Its `key` equals `public.modules.key`.
- **Identifiers are English, user-facing text is French**: key `professionals`, i18n `modules.professionals.*`, but route `professionnels` and label « Professionnels ».
- Other code imports a module **only through its `index.ts`** (`@/modules/<name>`); inside a module, relative imports. ESLint enforces it (`src/core/**` and `src/shared/**` never import `@/modules…` or `@/app…`; `src/app/**` no deep module path; `src/modules/**` no `@/modules/<name>/…` and no `@/app/…`). Not enforced, so review: a module importing only its `dependsOn`, and relative `../<other-module>/` paths.
- A disabled module contributes nothing (`resolveEnabledModules`); module routes and settings sections each render in their own `RouteBoundary`.
- « Paramètres » shows only when the user can access at least one settings section (decision #19).
- A module owns its tables and publishes views/RPCs for other modules; never read another module's raw tables. Migrations are additive within a release.
- Each module ships pgTAP, unit and Playwright tests, and a `docs/modules/<name>.md`.
- Before building a module, mark every item of its inventory section **Keep / Change / Drop** in its design doc (Drop needs Jonathan's OK).

## 6. Database rules

Read **[`docs/standards/database-conventions.md`](docs/standards/database-conventions.md)** before writing a migration. In short:

- **Closed by default.** Every table: `revoke all … from anon, authenticated`, then explicit grants (`select`, column-level `update`). No client `insert`/`delete`/`truncate`: writes that need checks go through RPCs.
- **RLS on every table.** Policies use only the `private` helpers (`current_user_org_id()`, `has_permission(text)`, `has_role(text)`, `current_user_role()`, `current_permission_keys()`), always wrapped in `(select …)`; a permission key from the row is tested with `col = any ((select private.current_permission_keys())::text[])` (the cast is required). Never query `profiles` / `user_roles` inline in a policy (RLS recursion). Every module policy has a `has_permission` term: that is what hides a disabled module's rows.
- **Every business table** has `org_id` and `private.audit_trigger()` (arguments = columns to redact); `audit_log` is append-only. Exceptions (seeded catalogues, operational logs) are listed with their reason in `000_invariants`.
- **Functions:** `set search_path = ''`, fully-qualified names; `security definer` only when needed, permission check first; helpers and triggers in `private`, only intended RPCs in `public`. User-facing errors: `errcode = 'P0001'`, in French.
- **Secrets** only through `set_org_secret` / `delete_org_secret` / `list_org_secret_keys` (clients, `settings.integrations_manage`) and `get_org_secret` (service role). Values live in Vault, never in the audit log.
- **PII** (SIN, account numbers) is encrypted with a key version (ADR 0004; conventions « PII »; runbooks `docs/runbooks/pii-key-*.md`). Never select a key or a decrypted value outside its RPC.
- **Modules plug into core services with data, never code** (ADR 0003): catalogue rows and the `private` helpers called from the module's definer RPCs ([core doc, « How a module plugs in »](docs/modules/core.md#how-a-module-plugs-in)).
- **Migrations:** `YYYYMMDDHHMMSS_<english_name>.sql` from `date -u +%Y%m%d%H%M%S`, seconds ≠ `00`. **Never edit an applied migration.** Seeds in migrations use `on conflict do nothing`. Write the pgTAP test first; `npm run db:types` after every migration.
- **Invariants:** `000_invariants.test.sql` checks the whole catalog (RLS, grants, `search_path`, FK indexes, audit triggers, `security_invoker` views…). Keep it green; never disable it.
- **`supabase/seed.sql` is local only.** Any reset of a remote database uses `--no-seed`.

## 7. Edge functions

Details of each function and of the shared services: [core doc, « Edge functions » and « Signing »](docs/modules/core.md#edge-functions), [professionals doc](docs/modules/professionals.md), and each `handler.ts`'s header.

- **Categories** (all in `supabase/config.toml` with `verify_jwt = false`; each authenticates itself first):
  - **user** (`verifyAuth`): `email-preview`, `email-test-send`, `staff-invite`, `users-set-status`, `storage-upload`, `storage-confirm`, `storage-sign`, `signing-test-connection`, `signing-test-document`, `places`, `professionals-invite`, `professionals-submit`, `professionals-fiche`, `professionals-set-status`, `professionals-documents`, `professionals-consent-sign`, and:
  - `professionals-contract-send` (a closed list of forms, P4-483: the service contract with `professionals.contracts.send` and `professionals.compensation`, or `form: image_consent` with `professionals.manage` through `prepare_professional_image_consent`, no Annexe A; « Préparer le contrat », « Renvoyer », « Régénérer » the service contract: the snapshot from `prepare_professional_contract` (service, `p_actor`), Annexe A as blocks for the block placeholder `pricing.annexe_a`, then `createSignatureRequest`; **it renders**; one key per action, checked before any cancel, P4-432–P4-443; `preview: true` (P4-502): the same prepare and key, then `renderSignaturePreview` (the send's fill and renderer, nothing cancelled, stored or sent), the PDF as base64 with `no-store`, bucket `professionals.contract_preview` 30/h; the send with that key prints the previewed snapshot);
  - **public token** (no user; the hashed, single-use token is the credential; per-IP limit **before any lookup**; org and module from the link row): `resolve-link`, `accept-invite`;
  - **webhook** (`?org=` names the org whose secret verifies the signature, compared with `timingSafeEqual`; one per-IP hit first; no CORS, `webhookResponse`): `resend-webhook`, `signing-webhook`;
  - **job** (`runJob` verifies `X-Job-Signature`, an HMAC: `pg_net` headers are readable by every DB role, so a job request never carries a secret or a bearer key): `storage-cleanup`, `professionals-invitation-reminders`, `professionals-insurance-expiry`; `signing-sync` is both « Synchroniser » (user) and the job `core.signing_reconcile`.
- **Shape:** `handler.ts` holds all logic (`createHandler(deps)`, no `Deno.serve`, no env read at import); `index.ts` only wires `Deno.serve(createHandler(defaultDeps()))`. Tests inject the doubles in `_shared/testing/`, which no `index.ts` imports.
- **Module gate, always:** user functions `verifyAuth(req, { module, permission })` (active profile, then module, then permission); service-role, webhook and job code resolves the org **from the database row**, then `requireModuleForOrg`. Only exception: `places` (any active profile, P4-221).
- **Never trust an org id sent by the client**: `auth.access.org_id` or the row's org.
- **Database through RPCs only** (`client.rpc`, `client.storage`), never `.from('<table>')`, except the two `stored_files` reads of `storage-sign` (caller's RLS) and `storage-confirm`. Independent awaits run in `Promise.all`.
- **Bodies:** `readJson(req, schema)` (Zod, 64 KB cap; never echo the input). Files never pass through a body: signed upload URLs only; `storage-sign` is the only way a client gets a read URL (P3-33).
- **Errors:** `{ error: { code, message } }`, English codes (`ErrorCode`, `_shared/auth.ts`) that the UI maps to French; a P0001 refusal is passed on as 400 with `refusal: true` (`refusalResponse`), the only 400 shown as written. Reports go through `reportError({ fn, code, ids })` only: never an address, token, message or body. Signer addresses and raw tokens never reach a log, a claim or an answer.
- **Signing:** the Documenso reference is the **envelope id**, and a request is matched only by its own id (Documenso's `externalId`). Only request-creating functions import `_shared/signing.ts` (it renders); the webhook and sync use the render-free `_shared/signing-events.ts`. Detect Documenso's 404 only with `isProviderNotFound`, never `status === 404`; per-request reconcile reports go through `recordAttempt`, never `reportError` directly. The Documenso server is not backed up (ADR 0005): every signed PDF is copied to our storage as soon as it exists.
- **CORS:** `ALLOWED_ORIGINS` echoed with `Vary: Origin`; pass `req` to `jsonResponse` / `errorResponse`.
- **Imports:** bare specifiers from `supabase/functions/deno.json` (exact versions); always run deno with `--config supabase/functions/deno.json` (and `--frozen`). **Every npm package in `deno.lock` ships in every function** (ADR 0008): add one only when most functions need it.
- **PDF rendering** (`_shared/pdf/`, ADR 0008): pdfmake is **vendored** (`vendor/pdfmake.js`, from `npm run build:pdfmake`, pinned by `vendor/pdfmake.js.sha256`; never edit it). Only code that renders imports `render.ts` (today `signing-test-document`, `professionals-contract-send`, `professionals-consent-sign`); `model.ts`, `template.ts` and `assets.ts` are pdfmake-free. `isolation.test.ts` keeps the renderer out of every other function.

## 8. Frontend rules

- **The auth behaviours are deliberate**: read decisions log #9–17 and ADR 0006 before changing them.
- **No Supabase client in `.tsx` files** (`npm run lint:supabase`): queries live in `api.ts` / `api/*.ts`, called through hooks (type-only imports allowed; a provider that must touch the client carries `// SUPABASE_ALLOWED: <reason>`). The only client is `supabase` from `@/core/supabase/client`.
- **Edge functions from the app:** always `invokeFunction(name, body, { signal })` (`@/core/supabase/functions`, in an `api.ts`), never `supabase.functions.invoke`. Map `FunctionCallError.code` to French per feature; `refusalMessage(error)` for a `refusal: true` 400; `retryInText(error.retryAfter)` for a 429.
- Under `RequireAuth`, use `useReadyAccess()`. Permission checks: `useAccess().can(key)` and `<RequireAccess permission="…">`: the UI hides what the user cannot do, the database enforces it. Provider files export only components.
- **React Query:** key factories named `<thing>Keys`; mutations invalidate the factory's `all` unless the factory documents narrower keys (users and roles, Professionnels' `hooks/keys.ts`, …). Never retry a `42501`. `AccessProvider` clears the cache when the user changes (`src/app/query-client.ts`).
- **All user-facing text goes through `t()`** (`@/i18n`, keys typed from `fr-CA.json`). Pages title the tab with `usePageTitle()`. Statuses are plain French (« il faut toujours être clair »).
- **Addresses:** line 1 of every address form is `AddressAutocomplete` + `addressAutofill` (`@/core/address`, P4-220–P4-223), with `autocomplete="off"` on every address field. A new modal primitive keeps the Échap guard of `SheetContent` / `DialogContent`.
- **Files:** upload only with `uploadFile` (`@/core/storage/api`) and `FileDropzone`; display only through `useSignedFileUrl(fileId)`. Never `createSignedUrl` or a bucket read from the browser (P3-33).
- **Statuses shown in several places** use one helper each (`emailStatusLabel`, `signatureStatusLabel`) with `StatusDot`.
- **Secrets in settings:** `SecretField` is write-only (« Configuré le … », never a value).
- **Never cache a revealed sensitive value** (SIN, account number): component state only (`useRevealedValue` and its wrappers), never React Query, dropped after 60 s, on tab hide and unmount; mutations carrying one use `gcTime: 0`. Sensitive inputs spread `SENSITIVE_INPUT_PROPS`.
- **RPC errors** shown to users go through `moduleErrorMessage` (`src/core/modules/errors.ts`). Never pass a raw PostgREST error to Sentry (its `details`/`hint` can hold row values).
- **Unsaved changes:** a form calls `useUnsavedChanges(dirty)`; leaving links use `GuardedNavLink` / `useConfirmLeave()`; tabs holding forms use `useGuardedTabs`.
- **Polling:** only the bell's unread count polls; other screens follow it from the cache.
- **Pages and record tabs are code-split with `lazyPage(load, exportName)`**, never a bare `React.lazy`. Record tabs read the record bundle through `useRecordData`, never refetching it (P4-71, P4-312).
- **Stale chunks:** error boundaries call `recoverFromStaleChunk()`; no global `vite:preloadError` reload. `npm run build` checks the login page's JS (`scripts/check-entry-chunk.mjs`).
- **Settings:** a section has an English `id` and a French `path`; `permission` to see, `editPermission` to change (else read-only). Settings pages are stacks of `SettingsCard`s, each with its own form and `FormActions`; fields through `FormField`; read-only fields are `readOnly`, never `disabled`.
- **Motifs** (Jonathan, P4-249): every held motif is written out by name, by category, never « Tous », « Tous sauf … » or « N sur M »; Aperçu folds each category's names under its title until opened. See the [module doc](docs/modules/professionals.md#motif-density-jonathans-rules).
- Tests: Vitest + Testing Library with `renderWithContexts` (`src/test/contexts.tsx`).

## 9. Timezone (IMPORTANT)

Timestamps are stored in UTC (`timestamptz`); the clinic's timezone is `organizations.timezone` (default `America/Toronto`), applied by `AccessProvider` (`setClinicTimezone`).

- **Never** `toLocaleDateString()`, `new Date(…)` comparisons or date-fns `format()` directly for user-facing dates. **Always** the utilities of `@/shared/lib/timezone`: `formatClinicDateShort`, `formatClinicDateFull`, `formatClinicTime`, `formatClinicDateTime`, `formatInClinicTimezone(date, pattern)`, `toClinicTime`, `isClinicToday`, `getClinicDateString`, `clinicTimeToUTC(date, time)` (form input → UTC for storage).
- **Date-only fields** (`date`: birthday, expiry dates, …) are calendar dates: format them with `formatDateOnly` / `formatDateOnlyFull` / `formatDateOnlyShort`, **never** with a timezone conversion (`"2020-01-01"` would become 31 December).
- In SQL, the clinic day is `private.clinic_today()`.

## 10. Accessibility and tab order (IMPORTANT)

- **Close buttons (X) are not in the tab order.** `SheetContent` / `DialogContent` already give their default close `tabIndex={-1}`; a custom close button uses `hideClose` on the content and `tabIndex={-1}` itself (never two X).
- **Section tabs inside a form or sheet are not in the tab order**: `NavTabs` / `NavTab` (`@/shared/ui/nav-tabs`) or `tabIndex={-1}`. **Page-level views** must be keyboard-reachable: real Radix Tabs (one tab stop, arrows switch), never `tabIndex={-1}` (decision #35).
- Form fields flow in their visual order (Prénom → Nom → …).

## 11. Deploy

- **Never mutate the remote environment without Jonathan's explicit go-ahead in chat**, every time: migrations, resets, edge-function deploys, secrets, Auth settings. The same goes for `git push`, opening PRs and GitHub secrets.
- **Never apply a migration through the Supabase MCP (`apply_migration`)** or the dashboard: migrations go through git and `supabase db push`.
- **Merging to `main` is the deploy:** `supabase-migrations.yml` (`db push --linked --include-all`, drift check, PII health check), `apply-edge-functions.yml` (changed functions; all when `_shared/` or `deno.json`/`deno.lock` change; `verify_jwt` from `config.toml`), Vercel (web app). Never also apply by hand what the merge deploys.
- `vercel.json` rewrites every path **except `/assets/`** to `/index.html` (a missing chunk must 404 for the stale-chunk recovery); `/assets/*` is `immutable`, HTML `no-cache`. Keep these rules.
- Any remote reset uses `supabase db reset --linked --no-seed`, and only with the go-ahead above.
- Pull requests must be green on CI (`ci.yml`, `migration-lint.yml`).

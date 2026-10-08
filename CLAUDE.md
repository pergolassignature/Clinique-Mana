# CLAUDE.md — Clinique MANA

## 1. Project

Clinique MANA is the management platform of a **dispatch clinic**: conseillères receive every request and match the client with one of ~50 independent professionals, 100 % online ([business context](docs/standards/business-context.md)). It is non-clinical: motifs are orientation tags, never diagnoses, and clinical notes stay out of the app (design D8). Tone and brand: [business context §6](docs/standards/business-context.md#6-brand--tone), which supersedes `docs/standards/brand.tokens.md` (legacy app tokens) for the redesign.

**The app is being rebuilt from its foundations** ([design](docs/plans/2026-10-06-foundation-rebuild-design.md), [plan](docs/plans/2026-10-06-foundation-phase-0-1-plan.md), [decisions log](docs/plans/2026-10-07-decisions-log.md), [ADRs](docs/adr/README.md)).

- The old app lives in `_legacy/` (tag `legacy-v1`). It is **read-only**: never edit or import it; it is excluded from TypeScript, ESLint, Vite and CI.
- **Legacy guidance lives in `_legacy/` too and must not be followed**: the old `claude.md`, the `.claude/workflows/` module pipeline and `.claude/skills/`, the old module status files, data contracts, deploy/testing guides and standards (listed in `_legacy/README.md`). Current rules: this file, `docs/standards/`, `docs/adr/`.
- Nothing the legacy app does may be lost silently: the parity checklist is [`docs/plans/2026-10-06-legacy-feature-inventory.md`](docs/plans/2026-10-06-legacy-feature-inventory.md).
- Built so far:
  - **Phase 1:** the core (auth, access, modules, settings shell, audit, secrets) and module `professionals` as an empty placeholder;
  - **Phase 2** ([design](docs/plans/2026-10-07-phase-2-core-settings-design.md), [plan](docs/plans/2026-10-07-phase-2-core-settings-plan.md)): the design system and shell, roles `counselor` / `admin_assistant` (replacing `staff`), « Mon compte », the clinic settings (Identité légale, Fiscalité with dated TPS/TVQ rates, Signataire, Coordonnées bancaires encrypted, Région, Confidentialité), « Utilisateurs et accès » (roles, status, permission switches, editable roles per clinic), « Journal d'audit », and the load-performance work (lazy pages, cache headers, stale-chunk recovery). Details: [core module doc](docs/modules/core.md), [status](docs/plans/2026-10-07-status.md).
  - **Phase 3** ([design](docs/plans/2026-10-08-phase-3-shared-services-design.md), [plan](docs/plans/2026-10-08-phase-3-shared-services-plan.md), decisions P3-1–P3-34 in the decisions log): the shared services every module uses. Scheduled jobs (`pg_cron` + `pg_net`, signed dispatch, « Tâches planifiées »); transactional email (Resend, templates per clinic with preview and test, send log with webhook statuses, « Courriels »); in-app notifications (the bell, « À surveiller » on Accueil); auth emails generated from the same layout and landing on `/connexion/confirmer`; hashed single-use secure links and staff invitations (`/invitation`, « Inviter » in Utilisateurs et accès; disabling ends sessions); private file storage (signed uploads, content sniffing, 5-min read URLs through `storage-sign`; logo and signature image); e-signature through Documenso with the server-side PDF renderer (pdfmake), « Signature électronique »; rate limits and webhook claims. 15 edge functions. Details: [core module doc, « Shared services »](docs/modules/core.md#shared-services-phase-3).

## 2. Environments

| Environment | Where | Notes |
|---|---|---|
| Local | `supabase start` (ports **553xx**: API 55321, DB 55322, Studio 55323, Mailpit 55324) + `npm run dev` on **`http://localhost:5173`** | Use `localhost`, not `127.0.0.1`: a second origin means a second session. PS Hub's stack uses 543xx; never touch it. Test logins (four roles): see the header of `supabase/seed.sql`. Edge functions: `npx supabase functions serve --env-file supabase/functions/.env` (copied from `.env.example`: local fakes only); the fake Documenso: `npm run fake:documenso` (port 55390). |
| Staging | Supabase project `vnmbjbdsjxmpijyjmmkh` (Canada Central), app on `https://app.cliniquemana.com` | The only remote environment. Re-baselined on 2026-10-07 (Task 1.21, [log](docs/audit/2026-10-07-staging-snapshot.md)); since then it receives what `main` holds (§11). |

Node **22** everywhere (`.nvmrc`, `package.json` `engines`, CI; decision #20). Production does not exist yet. `.env.local` (from `.env.example`) holds `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`; never put a service-role key in a `VITE_` variable.

## 3. Commands

```bash
npm run dev              # Vite on http://localhost:5173
npm run typecheck        # tsc --noEmit
npm run lint             # ESLint (incl. module import boundaries) + design-token class guard
npm run lint:supabase    # no Supabase client in .tsx files
npm run lint:migrations  # migration timestamps (BASE_REF=origin/main by default)
npm run test:run         # Vitest, once (npm test = watch)
npm run test:functions   # deno test, all of supabase/functions (--frozen lock)
npm run check:functions  # deno check, all of supabase/functions (--frozen lock)
npm run lint:functions   # deno lint, all of supabase/functions
npm run build:pdfmake    # regenerate the vendored pdfmake (_shared/pdf/vendor/pdfmake.js)
npm run check:auth-templates  # supabase/templates/*.html match _shared/email (build:auth-templates regenerates them; CI)
npm run fake:documenso   # local in-memory Documenso on 127.0.0.1:55390
npm run build            # typecheck + vite build + login-chunk guard (build:only = vite build)

npm run db:start         # supabase start
npm run db:reset         # supabase db reset (migrations + seed.sql)
npm run db:test          # supabase test db (pgTAP)
npm run db:types         # regenerate src/core/supabase/database.types.ts
```

Before a commit: `npm run typecheck && npm run lint && npm run lint:supabase && npm run test:run`; after a migration also `npm run db:reset && npm run db:test && npm run db:types`. CI (`.github/workflows/ci.yml`) runs all of these plus a types-drift check; `migration-lint.yml` checks new migration timestamps.

## 4. Structure

```
src/
  app/            composition root: App (router), AuthenticatedApp, AppShell, HomePage, modules.ts (ALL_MODULES)
  core/
    auth/         AuthProvider, auth-context (useAuth), recovery marker, safeRedirect, pages/ (login, forgot, reset)
    access/       AccessProvider, access-context (useAccess, useReadyAccess, accessKeys), org-roles (useOrgId, useOrgRoles, useRoleLabel, roleKeys), catalog (usePermissionCatalog: one query for users and audit), guards (RequireAuth, RequireAccess)
    account/      « Mon compte » (/mon-compte): api, hooks, pages/
    modules/      manifest types, resolveEnabledModules, list/toggle API + hooks (moduleKeys), error allow-list
    settings/     SettingsLayout, sections.ts (coreSettingsSections), paths, visible-sections, pages/ (one per section)
      organization/ tax/ bank/   api, hooks, Zod schemas (mirror the DB checks)
      components/ OrganizationCard, TaxRatesCard, BankDetailsCard/Form, TimezonePicker…
    users/        « Utilisateurs et accès »: api, hooks, permissions.ts (mirrors the DB guards), components/ (UserSheet, RoleMatrix, InviteDialog, PendingInvitationRows…)
    audit/        « Journal d'audit »: api, hooks, labels (French field names/values), period
    email/        « Courriels »: api, hooks (emailKeys, emailPreviewKeys), status (emailStatusLabel), schemas, components/ (templates, editor + preview, log)
    jobs/         « Tâches planifiées »: api, hooks (jobKeys), labels, schedule text
    notifications/ the bell and « À surveiller »: api, hooks (notificationKeys; the polled count), display
    storage/      uploadFile, signedFileUrl, useSignedFileUrl (storageKeys), purposes (client-side caps), errors
    signing/      « Signature électronique »: api, hooks (signingKeys), status (signatureStatusLabel), schemas, components/
    invitations/  the public /invitation page and its api (resolve-link, accept-invite)
    supabase/     client.ts (the only client), functions.ts (invokeFunction, FunctionCallError), database.types.ts (generated, never edited)
  modules/<name>/ manifest.ts, index.ts (public entry), pages/ — later api/, hooks/, components/
  shared/         ui/ (shadcn + design system: form-field, table, tabs, switch…), components/ (SettingsCard, FormActions, SaveButton, PageHeader, LoadState (Loading, LoadError), EmptyState, ReadOnlyNotice, StatusIndicator, soft-disabled, FileDropzone, UnsavedChangesProvider, GuardedNavLink, RouteBoundary, ErrorBoundary, FullPageMessage), lib/ (timezone (+ shiftCalendarDay), clinic-timezone, use-clinic-date, use-now, email (EMAIL_PATTERN, emailSchema), format, files (client-side type sniffing and image size for uploads, upload steps), retry-after (retryInText), lazy-page, app-update, router-future, unsaved-changes-* (+ useGuardedTabs), use-settings-form, regroup-on-blur, use-page-title (+ useNoIndex), sentry-scrub, utils (cn))
  i18n/           fr-CA.json + typed t()
  test/           renderWithContexts, testAccess, setup
supabase/
  migrations/     core_* (access, audit, secrets; Phase 2: roles split, organization profile, tax rates, bank details, user admin, audit viewer, editable roles…; Phase 3: shared permissions, rate limits and webhook events, scheduled jobs, email, notifications, secure links, staff invitations, storage, signing), professionals_module
  functions/      one folder per function (handler.ts + index.ts) + deno.json/deno.lock + .env.example (local fakes; .env is gitignored)
    _shared/      auth.ts, modules.ts, deps.ts, http.ts, errors.ts, report.ts, rate-limit.ts, webhooks.ts, svix.ts, jobs.ts, links.ts, notifications.ts, storage.ts, image-size.ts, bytea.ts, format.ts, timing-safe-equal.ts,
                  documenso.ts, signing.ts (renders), signing-events.ts (render-free), email/ (markup, render, layout, compose, send, transport, auth-templates), pdf/ (model, template, assets, render, vendor/, fonts), testing/ (fakes, never deployed)
  templates/      auth emails, generated by `npm run build:auth-templates` (never edit by hand)
  tests/database/ pgTAP, one file per migration + 000_invariants
  seed.sql        LOCAL ONLY (also the local Vault secrets for pg_net and the fake Resend / Documenso secrets)
scripts/          check-entry-chunk, build-pdfmake, build-pdf-fonts, build-auth-templates, fake-documenso.ts, send-test-webhook.mjs (local signed Resend events)
```

## 5. Module rules (design §6.2)

- A module is declared by `src/modules/<name>/manifest.ts` (`ModuleManifest`: `key`, `labelKey`, `dependsOn`, `nav`, `routes`, `settingsSections`) and listed in `ALL_MODULES` (`src/app/modules.ts`). Its `key` equals `public.modules.key`.
- **Identifiers are English, user-facing text is French**: key `professionals`, folder `src/modules/professionals/`, i18n `modules.professionals.*`, but route `professionnels` and label « Professionnels ».
- Other code imports a module **only through its `index.ts`** (`@/modules/<name>`); inside a module, use relative imports. ESLint (`no-restricted-imports` in `eslint.config.js`) enforces:
  - `src/core/**`, `src/shared/**`: no import of `@/modules…` or `@/app…` (alias or `../` paths);
  - `src/app/**`: no deep import `@/modules/<name>/…` or `../modules/…`;
  - `src/modules/**`: no `@/modules/<name>/…` deep path (so a module's own files are imported relatively) and no `@/app/…`.
  Not enforced yet: a module importing only the modules listed in its `dependsOn`, and relative `../<other-module>/` paths between modules — review them.
- A disabled module contributes nothing: `AuthenticatedApp` keeps only the manifests that are in `useReadyAccess().modules` and whose dependencies are enabled too (`resolveEnabledModules`); each module route is wrapped in a `RouteBoundary` (scope = module key), and `SettingsLayout` wraps each settings section in its own boundary.
- « Paramètres » follows its sections (decision #19): the nav item shows, and `parametres/*` opens, only when the user can access **at least one** settings section (core or enabled module); otherwise the route shows the forbidden page. With the defaults, the adjointe (`settings.view`) sees the clinic sections read-only; the conseillère and the professionnel see no « Paramètres ».
- A module owns its tables and publishes views/RPCs for other modules; never read another module's raw tables. Migrations are additive within a release.
- Each module ships pgTAP, unit and (from Phase 4) Playwright tests, and a `docs/modules/<name>.md`.
- Before building a module, mark every item of its inventory section **Keep / Change / Drop** in its design doc (Drop needs Jonathan's OK).

## 6. Database rules

The full rules, with examples, are in **[`docs/standards/database-conventions.md`](docs/standards/database-conventions.md)**; read it before writing a migration. The core in short ([core module doc](docs/modules/core.md)):

- **Closed by default.** Every table: `revoke all … from anon, authenticated`, then explicit grants (`select`, column-level `update`). No client `insert`/`delete`/`truncate`: writes that need checks go through RPCs.
- **RLS on every table.** Policies use only the helpers in schema `private` — `private.current_user_org_id()`, `private.has_permission(text)`, `private.has_role(text)`, `private.current_user_role()`, `private.current_permission_keys()` — always wrapped in `(select …)`. `current_permission_keys()` is the one place permissions are evaluated (P3-21); when the key comes from the row (`view_permission`, `recipient_permission`, `owner_permission`) the policy tests `col = any ((select private.current_permission_keys())::text[])` (the cast is required; conventions §5). Never query `profiles` / `user_roles` inline in a policy (legacy hit RLS recursion twice). Every module policy has a `has_permission` term: that is what makes a disabled module's rows disappear.
- **Every business table** has `org_id` and `private.audit_trigger()` (arguments = columns to redact). `audit_log` is append-only. Exceptions: catalogues seeded by migrations (git is their history) and the **operational logs** (`webhook_events`, `email_log`, `scheduled_job_runs`, `scheduled_job_dispatches`, `notifications`, `notification_reads`; `rate_limits` has no `org_id`), listed in `000_invariants` with their reason (conventions §7).
- **Functions:** `set search_path = ''`, fully-qualified names; `security definer` only when needed, permission check first; RLS helpers and trigger functions in `private`, only intended RPCs in `public`. User-facing errors use `errcode = 'P0001'` in French.
- **Secrets** only through `set_org_secret` / `delete_org_secret` (`settings.integrations_manage`, P3-12) / `list_org_secret_keys` (clients) and `get_org_secret` (service role only). Values live in Vault and never appear in the audit log.
- **Modules plug into core services with data, never code** (ADR 0003): catalogue rows (`email_template_defaults`, `upload_purposes`, `secure_link_purposes` naming handler RPCs, `scheduled_jobs`), module permissions on every row, and the `private` helpers (`notify`, `issue_secure_link`, `consume_secure_link`, `attach_stored_file`) called from the module's definer RPCs ([core doc, « How a module plugs in »](docs/modules/core.md#how-a-module-plugs-in)).
- **Migrations:** `YYYYMMDDHHMMSS_<english_name>.sql` from `date -u +%Y%m%d%H%M%S`, seconds ≠ `00`. Never rewrite an applied migration. Seeds in migrations use `on conflict do nothing`. Write the pgTAP test first; regenerate types (`npm run db:types`) after every migration.
- **Invariants:** `supabase/tests/database/000_invariants.test.sql` checks the whole catalog (RLS on, no client insert/delete, `search_path`, FK indexes, audit triggers, `security_invoker` views…). Keep it green; never disable it.
- **`supabase/seed.sql` is local only.** Any reset of a remote database uses `--no-seed`.

## 7. Edge functions

- Shared helpers in `supabase/functions/_shared/`: `verifyAuth(req, { permission, module })`, `verifyServiceRoleAuth(req)`, `requireModule(client, key)`, `requireModuleForOrg(serviceClient, orgId, key)`, `getUserClient(token)`, `getServiceRoleClient()`, `jsonResponse`, `errorResponse(code, message, status)`, `handleCors`, `isLocalAppUrl` (`auth.ts`); `timingSafeEqual`; `readJson` (`http.ts`); `FunctionError`, `rpcErrorResponse` (`errors.ts`); `reportError` (`report.ts`); `consume`, `LIMITS`, `clientIp` (`rate-limit.ts`); `claimEvent` / `completeEvent` / `failEvent`, `webhookResponse` (`webhooks.ts`); `verifySvix`; `runJob` (`jobs.ts`); `generateToken` / `hashToken` / `linkUrl` (`links.ts`); `notify` (`notifications.ts`); `sendTemplatedEmail` (`email/send.ts`); `sniff` / `inspectStream` (`storage.ts`); `documensoClient`; `createSignatureRequest` (`signing.ts`); `renderPdf` (`pdf/render.ts`).
- **Function categories** (each has its own auth, all listed in `config.toml` with their `verify_jwt`; the table is in the [core doc](docs/modules/core.md#edge-functions)):
  - **user** (`verify_jwt = false`, `verifyAuth` first): `email-preview`, `email-test-send`, `staff-invite`, `users-set-status`, `storage-upload`, `storage-confirm`, `storage-sign`, `signing-test-connection`, `signing-test-document`;
  - **public token** (`verify_jwt = true`, anon key, no user): `resolve-link`, `accept-invite`;
  - **webhook** (`verify_jwt = false`; `?org=` names the org whose secret verifies the signature, before any other read; no CORS): `resend-webhook` (Svix), `signing-webhook` (`X-Documenso-Secret`, `timingSafeEqual`);
  - **job** (`verify_jwt = false`, `runJob` verifies `X-Job-Signature`): `storage-cleanup`; `signing-sync` is both a user function (« Synchroniser ») and the job `core.signing_reconcile`.
- **Shape:** each function is `handler.ts` (all logic: `createHandler(deps)`, no `Deno.serve`, no env read at import) and `index.ts` (wiring only: `Deno.serve(createHandler(defaultDeps()))`). `Deps` (`_shared/deps.ts`) injects `env`, `fetch`, `now`, `serviceClient`, `userClient`; tests pass the doubles in `_shared/testing/` (`fake-supabase.ts`, `fake-fetch.ts`, `fixed-clock.ts`, `env.ts`), which no `index.ts` imports.
- **Database through RPCs only:** `client.rpc(…)` and `client.storage`, never `.from('<table>')`, except two reads of `stored_files`: `storage-sign` (with the caller's client, so RLS decides readability) and `storage-confirm`'s idempotency check (service client, filtered by id, org, uploader and `ready`). The fake client routes them by table (`tables`). Independent awaits run in `Promise.all`.
- **Bodies:** `readJson(req, schema)` (`_shared/http.ts`, Zod, 64 KB cap → 413; invalid → 400 `invalid_request`, never echoing the input). Files never pass through a body: signed upload URLs.
- **Storage functions (design §7):** `storage-upload` (`verifyAuth`; `create_pending_upload` as the caller; returns `{ file_id, bucket, path, token }`, never a URL; the client uploads with `uploadToSignedUrl`), `storage-confirm` (checks the stored object against the declared type and the purpose's caps; a refusal calls `reject_stored_file` **before** removing the object; a retry on a file already `ready` and uploaded by the caller → 200, a concurrent settle → 409 `conflict`), `storage-sign` (P3-33: the **only** way a client gets a read URL; body `{ file_id, download? }`; readability is the caller's RLS read of a `ready` `stored_files` row, not readable → 404, never 403; service `createSignedUrl(path, 300, { download: download ? original_name : undefined })` → `{ url, expires_at }`; `PUBLIC_API_URL` rewrites the internal origin locally), `storage-cleanup` (job). Per-user limits `storage.upload_user` 60/h, `storage.confirm_user` 120/h, `storage.sign_user` 120/h. File names are never logged. Upload names refuse `/`, `\`, C0, DEL, C1, U+2028–U+2029 and the bidirectional formatting characters (U+200E–U+200F, U+202A–U+202E, U+2066–U+2069), like `stored_files.original_name`.
- **Signing functions (design §6.3):** `_shared/signing.ts` (`createSignatureRequest`: context ∥ key → fill → `create_signature_request`, idempotent on the key: a sent row is returned, an abandoned draft → `provider_error`, any other draft is sent again on the same row → **the send claim** `begin_signature_request_send` (one send at a time per request: while another claim is younger than `STALE_SEND_MS` → `send_in_progress`, 409 `conflict` « Un envoi est déjà en cours. », nothing rendered or sent) → **a re-send settles the earlier document first** (`get_signing_request` read under the claim, then Documenso: COMPLETED → recovered, nothing sent again; DRAFT / PENDING → cancelled, a failed cancel ends the re-send `previous_cancel_failed`; cancelled, rejected or gone → sent again; the new document supersedes it) → images in parallel → render → `register_system_file` + upload → Documenso create (`externalId` = the request id), fields, distribute → `mark_signature_request_sent`; a failure marks the draft (`mark_signature_request_failed`, which releases the claim) and cancels the Documenso document; **it renders**, so only request-creating functions import it) and `_shared/signing-events.ts` (render-free, for `signing-webhook` / `signing-sync`: events from a document or a webhook, `applyEvents`, `storeSignedPdf` (download capped at 20 MB, sniffed, registered with the request's view permission from `get_signing_request`, uploaded with `upsert: false`, a failed upload → `discard_system_file`, then `complete_signature_request`), `syncRequest`, `reconcileOrg`). `signing-webhook`: `?org=` → that org's `documenso_webhook_secret` compared with `timingSafeEqual` (none → 401), body ≤ 256 KB, claim `<EVENT>:<doc>[:<version>]` with `{ event, document_id, external_id }` only, `retry` (a draft) → failed claim + 409. `signing-sync`: « Synchroniser » (caller's RLS read with `get_signature_request`, 404 when unreadable; never cancels a draft) or the job `core.signing_reconcile` (4 requests at a time; overdue: sync, then expire here, then cancel at Documenso; a draft with a document after an hour, one without after a day, both from `coalesce(last_send_at, created_at)`). A draft is settled only under its claim, re-read with `get_signing_request` once claimed and settled against its current document. **Recovery** (a draft Documenso completed) goes through `recover_signature_request`: no staged source needed (a source whose staging ended is recorded missing, reported `signing_source_missing`), and only the request's own document: Documenso's `externalId` must be the request id (checked by the functions) and the document id the draft's recorded one (checked by the RPC, 22023 otherwise). A document under another `externalId` is reported `signing_foreign_document` (ids only), never recovered nor cancelled, and treated as gone; recipients that do not match by signing order → `signing_orphan_completed`, left for a person. **Internal deadlines:** a claim is stale after `STALE_SEND_MS` (10 min); a send's Documenso calls share `SEND_TIMEOUT_MS` (120 s from the claim, independent of the caller's connection); each cleanup cancel has its own `CANCEL_TIMEOUT_MS` (20 s); each Documenso request is cut at 20 s; the reconcile has `RECONCILE_TIMEOUT_MS` (120 s) per org and starts no new batch after `RECONCILE_SOFT_DEADLINE_MS` (90 s). `signing-test-connection` / `signing-test-document` need `settings.integrations_manage`. Per-user limits `signing.sync_user` 60/h, `signing.test_connection_user` 30/h, `signing.test_document_user` 10/h. Signer addresses never reach a log, a claim or an answer.
- **Shared libraries:** `_shared/rate-limit.ts` (`consume(serviceClient, LIMITS.x, keyParts)`, HMAC-hashed keys; refused → 429 `rate_limited`, but `reason: 'unavailable'` (fails closed) → 503 `not_configured`; `clientIp(req)`: the **rightmost** `x-forwarded-for` entry (the one the gateway appends; entries to its left are client-forgeable and ignored), or `cf-connecting-ip` only with `CLIENT_IP_SOURCE=cf-connecting-ip` (default `xff-rightmost`); checked against `/^[0-9a-fA-F:.[\]%]{2,64}$/`, IPv6 grouped by /64; a missing or malformed IP → shared `'unknown'` bucket), `_shared/webhooks.ts` (`webhookResponse`, `claimEvent` / `completeEvent` / `failEvent`), `_shared/jobs.ts` (`runJob(deps, req, jobKey, perOrg, { perOrgTimeoutMs })` for cron and « Exécuter maintenant »; each org is cut at 60 s by default → `error` / `timeout`), `_shared/links.ts` (`generateToken()` 32 random bytes → 43 base64url chars; `isWellFormedToken(v)` before any hashing or lookup; `hashToken(t)` → `\x…` SHA-256 hex for `p_token_hash`; `linkUrl(APP_URL, '/invitation', t)` puts the token in the `#t=` fragment, https only except `http://localhost:5173`; the raw token is never stored, logged or returned).
- **Job auth:** `pg_net` keeps queued request headers in `net.http_request_queue`, readable by every database role, so `private.invoke_job_function` sends no secret, only `X-Job-Signature: t=<unix s>,v1=<hex HMAC-SHA256(INTERNAL_FUNCTION_SECRET, "<t>.<job_key>.<org_id or ''>.<trigger>")>`. `runJob` recomputes it from the body (`job_key` required), accepts ±300 s, answers 401 `unauthenticated` on any mismatch (a bearer is ignored) and 503 `not_configured` (reported) without the secret. Never call `verifyServiceRoleAuth` from a `pg_net` caller.
- **Error reports:** `reportError({ fn, code, ids })` (`_shared/report.ts`): Sentry when `SENTRY_DSN` is set, else one `console.error` JSON line. Only the function name, a code and row ids: never an address, token, message or body (keys such as `email`, `to`, `token`, `password` are refused; `fn` / `code` must be identifiers, id values with `@`, whitespace or over 100 characters are dropped). Sentry gets 3 s, then the console line. `FunctionError` lives in `_shared/errors.ts`.
- `verify_jwt = false` only when the function calls `verifyAuth` / `verifyServiceRoleAuth` first, verifies a webhook signature with `timingSafeEqual`, or is a job (`runJob` verifies `X-Job-Signature`).
- **Public token functions** (`resolve-link`, `accept-invite`): `verify_jwt = true` (the anon key is required) but no user; the token in the body authorizes. They rate-limit (`consume` on `clientIp`) **before any lookup**, answer with CORS restricted to `ALLOWED_ORIGINS`, and take the org and module from the link row, then `requireModuleForOrg`. Unknown, revoked and disabled-module tokens answer the same `link_invalid`. `resolve-link` peeks without marking, gates the module, then marks the link opened (a disabled module marks nothing). `accept-invite` creates the user with `app_metadata.invite_link_id` (the orphan marker, removed by `accept_staff_invitation` on acceptance: the maintenance job `core.invite_orphans_purge` deletes marked auth users with no profile, never signed in, after 1 hour). It deletes the user after a refusal or a database error (a SQLSTATE: rolled back), never after an ambiguous `accept_rpc` error (transport, gateway, no SQLSTATE: the reply may be lost after a commit): that one is reported `accept_outcome_unknown` and left to the purge.
- `verifyAuth` reads `get_my_access()`: it requires an active profile, then the module (if `module` is given), then the permission.
- **Module gate, always:**
  - user-scoped functions call `verifyAuth(req, { module: '<module>' })` or `requireModule(auth.client, '<module>')`;
  - service-role, webhook and cron functions resolve the org **from the database row** they act on, then call `requireModuleForOrg(serviceClient, orgId, '<module>')` (RPC `module_enabled_for_org`, service role only). The service role bypasses RLS, so nothing else gates them.
- **Never trust an org id sent by the client**: use `auth.access.org_id`, or the org of the row.
- `verifyServiceRoleAuth` contract: `Authorization: Bearer <key>`, where the key is `SUPABASE_SERVICE_ROLE_KEY`, one of `SUPABASE_SECRET_KEYS` or `INTERNAL_FUNCTION_SECRET`; 500 when none is configured.
- Errors are `{ error: { code, message } }` (a function may add fields next to `code`, e.g. `field`, `variable`, `invitation_id`; a 429 also sends `Retry-After` in seconds). Codes stay English (`ErrorCode`, `_shared/auth.ts`) and the UI maps each to French (P3-28): `invalid_request` (400; 413 for a body over the cap; a P0001 refusal is passed on as 400 with its French message), `missing_variable` (400: a templated email or PDF lacks a required value), `weak_password` (400: Auth refused the password at `accept-invite`; the page shows the rules), `unauthenticated` (401), `forbidden` / `module_disabled` (403), `not_found` (404), `conflict` (409), `link_invalid` / `link_expired` / `link_used` (410), `rate_limited` (429), `server_misconfigured` / `internal` (500), `provider_error` (502), `auth_unavailable` / `not_configured` (503). The client and service factories return a 500 `Response` when `SUPABASE_URL` or a key is missing: check `instanceof Response`.
- CORS: `ALLOWED_ORIGINS` (comma-separated) is echoed with `Vary: Origin`; unset means `*`, reported `cors_origins_unset` once per isolate when `APP_URL` is not local. Preflights carry `Access-Control-Max-Age: 600`. Pass `req` to `jsonResponse` / `errorResponse`. Webhooks are not browser-facing: they answer with `webhookResponse` (no CORS, `no-store`).
- Imports use bare specifiers mapped in `supabase/functions/deno.json` (exact versions, `@supabase/supabase-js` pinned to the web app's version). Run deno with `--config supabase/functions/deno.json` (the npm scripts do, with `--frozen`), so imports resolve from the functions' own `deno.lock`, not from the web app's `node_modules`. Format with `deno fmt --config supabase/functions/deno.json supabase/functions/`.
- **Every npm package in `deno.lock` ships in every function:** the edge-runtime bundler embeds the lock's whole npm graph, imported or not (ADR 0008). Add an npm dependency only when most functions need it.
- **PDF rendering (`_shared/pdf/`, P3-19), the one exception to bare specifiers:**
  - pdfmake is **vendored**, not in `deno.json`: `_shared/pdf/vendor/pdfmake.js` is pdfmake 0.3.11's Node build pre-bundled into one minified module (with its license notices), generated by `npm run build:pdfmake` (`scripts/build-pdfmake.ts`, npm resolution pinned by `scripts/build-pdfmake.lock`). Never edit it; deno lint/fmt skip it, and `vendor/pdfmake.d.ts` types the part we use. A function carries it (≈ +0.8 MB uploaded: 2.18 MB for a rendering function vs 1.35 MB, ADR 0008) only when its module graph imports `_shared/pdf/render.ts` (today only `signing-test-document`);
  - import `render.ts` (`renderPdf(doc, assets) → { bytes, pageCount, fields }`) only from code that renders. `model.ts` (the closed block model, `checkDocument`, `PdfError`), `template.ts` (`fillTemplate`) and `assets.ts` (`loadAssets(serviceClient, [{ key, bucket, path }])`, parallel, 2 MB cap) are pdfmake-free, so a module shared with non-rendering functions (e.g. the signing webhook) must not import `render.ts`;
  - the renderer validates the document (with document-wide caps: 400 table rows, 200 000 characters → `document_too_large`), embeds only PNG/JPEG assets (≤ 4000 px a side, else `image_too_large`) as data URLs, denies pdfmake's URL and local-file access, keeps headings with the next block (the headings before the signature page move onto it), never adds a blank page (a `pageBreak` or the signature page breaks only below content), maps U+202F → U+00A0, picks the Inter subset (latin, latin-ext, vietnamese) per run of text, and puts signing fields at fixed boxes (initials in each page header, signature and date on the last page, the signature page). Output is deterministic (fixed creation date). `vendor/pdfmake.js.sha256` pins the vendored file (`isolation.test.ts`); `OFL-Inter.txt` is the fonts' license (OFL 1.1).

## 8. Frontend rules

- **The auth behaviours are deliberate — read decisions log #9–17 and ADR 0006 before changing them.**

- **No Supabase client in `.tsx` files** (`npm run lint:supabase`): queries live in `api.ts` / `api/*.ts`, called through hooks. Type-only imports (`import type …`) are allowed. Providers that must touch the client carry a `// SUPABASE_ALLOWED: <reason>` comment.
- The only client is `supabase` from `@/core/supabase/client`; it fails fast without `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, and stores the session under `AUTH_STORAGE_KEY` (`clinique-mana-auth`). The password-recovery marker (`RECOVERY_STORAGE_KEY`, `src/core/auth/recovery.ts`) is bound to the recovery session's `session_id`; while it is set, `RequireAuth` sends every protected page to `/reinitialiser-mot-de-passe`.
- Contexts: `useAuth` from `@/core/auth/auth-context`; `useAccess`, `useReadyAccess`, `accessKeys` from `@/core/access/access-context`. Provider files export only components. Under `RequireAuth`, use `useReadyAccess()` (it throws unless access is ready). Permission checks: `useAccess().can(key)` and `<RequireAccess permission="…">` — the UI hides what the user cannot do, the database enforces it.
- React Query key factories are named `<thing>Keys` (`accessKeys`, `moduleKeys`, `emailKeys`, `jobKeys`, `notificationKeys`, `signingKeys`, `secretKeys`, `storageKeys`); mutations invalidate the factory's `all`. Exceptions (each documented at its factory): users and roles use narrow keys, so a change refetches only what it touched (documented in `src/core/access/org-roles.ts`): `roleKeys.list(orgId)` / `roleKeys.defaults(orgId)` (a matrix cell → the defaults; a rename → the list; a creation or deletion → both), `userKeys.list()` / `userKeys.overrides(userId)`, and `userKeys.invitations()` (the pending staff invitations: an invitation change → the invitations; after a refusal, the users list too). The permission catalogue (`permissionCatalogKeys`, `src/core/access/catalog.ts`) is its own root: no user or role change touches it. Phase 3: `emailPreviewKeys` is its own root (a save never re-renders an open preview); a job switch invalidates `jobKeys.list()` only; `storageKeys.signedUrl(userId, fileId)` is keyed per user and never invalidated (it expires: `gcTime` 30 s); `notificationKeys.important()` refetches only when the bell's polled count of important notices changes; saving signing settings also invalidates `secretKeys.all` when the address change cleared the key; organization saves cache the returned row and mark `organizationKeys.all` stale without refetching (`refetchType: 'none'`).
- **All user-facing text goes through `t()`** from `@/i18n` (keys typed from `src/i18n/fr-CA.json`). Pages title the browser tab with `usePageTitle()`.
- **Edge functions from the app:** always `invokeFunction(name, body, { signal })` from `@/core/supabase/functions` (in an `api.ts`), never `supabase.functions.invoke` directly. It throws `FunctionCallError` (`code`, `status`, `field`, `extra`, `retryAfter`; `network` when unreachable). Map `code` to French i18n per feature (`src/core/*/errors.ts`); `refusalMessage(error)` gives the French text of a P0001 refusal a function passed on; a 429 reads « Réessayez dans … » with `retryInText(error.retryAfter)` (`@/shared/lib/retry-after`).
- **Files:** upload only with `uploadFile({ purpose, subjectType, subjectId, file })` (`@/core/storage/api`: `storage-upload` → `uploadToSignedUrl` → `storage-confirm`), shown with `FileDropzone` (`@/shared/components/FileDropzone`: client pre-checks of size, type and image side from the purpose's caps in `src/core/storage/purposes.ts`, which mirror `upload_purposes`; progress steps; one tab stop). Display a stored file only through `useSignedFileUrl(fileId)` (`@/core/storage/hooks`: `storage-sign`, a 5-min URL, fresh 240 s, keyed per user; `refresh: true` for a download link). Never call `createSignedUrl` or read a bucket from the browser (P3-33: no client storage policy exists).
- **Statuses shown in several places** use one helper each, so a timeline and a settings page never disagree: `emailStatusLabel(status, errorCode)` (`@/core/email/status`: `failed` + `provider_unavailable` is « Résultat inconnu », never « Échec ») and `signatureStatusLabel(status, lastError)` (`@/core/signing/status`); render the tone with `StatusDot` (`@/shared/ui/status-dot`).
- **Secrets in settings:** `SecretField` (`src/core/settings/components/`) is write-only: it shows « Configuré le … » from `list_org_secret_keys`, never a value; its mutation uses `gcTime: 0`.
- Toasts: `toast` from `@/shared/ui/sonner`. RPC errors shown to users go through `moduleErrorMessage` (`src/core/modules/errors.ts`): `P0001` message as is, `42501` → generic permission text (not reported), `23514` (check violation) → « valeur invalide » text, also reported to Sentry (it only follows a bypass or a Zod/SQL parity bug), anything else → the caller's fallback + Sentry. Pass the third argument (`area`, e.g. `'settings'`) to tag the report. The report is a fresh `Error` named `RpcError <code>` with the message only: never pass a raw PostgREST error to Sentry (its `details`/`hint` can hold row values). `main.tsx`'s `beforeSend` (`scrubSentryEvent`) is the backstop.
- **Page tabs whose panels hold forms** use `useGuardedTabs(current, isTab, select)` (`@/shared/lib/unsaved-changes-context`): switching asks first while a form is dirty (« Courriels », « Signature électronique », « Utilisateurs et accès »).
- **Polling:** only the bell's unread count polls (every 60 s while the tab is visible, P3-24); other screens follow it from the cache instead of starting a timer.
- Route and settings crashes stay local: `RouteBoundary` (`@/shared/components/RouteBoundary`); full-page states use `FullPageMessage`.
- **Pages are code-split with `lazyPage(load, exportName)`** (`@/shared/lib/lazy-page`), never a bare `React.lazy`: module routes and settings sections only accept a `LazyPage` (it can be preloaded; the shell prefetches visible pages at idle and loads the page's chunk with the shell's on reload).
- **Stale chunks after a deploy:** the error boundaries call `recoverFromStaleChunk()` (`@/shared/lib/app-update`) on a chunk-load error: one reload (at most 3 per minute), never while a form is dirty (it asks the unsaved-changes registry), else a « Recharger » button. No global `vite:preloadError` reload. `npm run build` runs `scripts/check-entry-chunk.mjs` on the login page's JS (the entry chunk and what `index.html` preloads with it): it fails if date-fns or cmdk markers appear there (or if a marker is in no chunk at all, so a renamed one cannot check nothing), and prints the size report (raw and gzip). Other signed-in code on the entry path is stopped by ESLint's entry-path rule, not by this check.
- **Settings sections** (`SettingsSection`, `src/core/modules/types.ts`; core ones in `src/core/settings/sections.ts`): an English `id` (error scope, React key) and a French `path` (URL segment, decision #24), both unique across core and modules (unit test). `permission` (to see) and `editPermission` (to change; without it the section is read-only: a lock in the menu and one « Lecture seule » notice) take one key or an array meaning **any of**.
- **Settings pages are stacks of cards**, each with its own form and « Enregistrer »:
  - `SettingsCard` (`@/shared/components/SettingsCard`) with `FormActions` (« Annuler / Enregistrer »; the save button is teal only while the card is dirty, decision #34);
  - `OrganizationCard` (`src/core/settings/components/`) for cards that edit `organizations` columns: `useSettingsForm` + the card's Zod schema from `organization/schemas.ts` (the database checks repeat it);
  - `FormField` (`@/shared/ui/form-field`) wires label, help, error and required marker. Read-only fields are `readOnly`, never `disabled` (focusable, copyable).
- **Unsaved changes:** `UnsavedChangesProvider` wraps the signed-in app. A form calls `useUnsavedChanges(dirty)`; links that leave use `GuardedNavLink` or `useConfirmLeave()`, which confirm while any form is dirty; `beforeunload` covers closing the tab. A sheet or dialog checks its own form's dirty state, not the global one. Code outside React (error boundary, stale-chunk recovery) asks `hasUnsavedChanges()` (`unsaved-changes-registry`).
- **Never cache a revealed sensitive value**: a revealed bank account number lives in component state only (`useRevealedAccountNumber`), never in React Query, and is dropped after 60 s, when the tab is hidden and on unmount; mutations that carry one use `gcTime: 0`. The same goes for the SINs of Phase 4.
- Tests: Vitest + Testing Library; render with `renderWithContexts` (`src/test/contexts.tsx`), whose router `future` flags mirror `App.tsx` (`ROUTER_FUTURE`).

## 9. Timezone Handling (IMPORTANT)

All dates in the database are stored as UTC (`timestamptz`). The clinic operates in a configurable timezone (default: `America/Toronto` for EST/EDT).

### Rules

1. **NEVER use `new Date().toLocaleDateString()` or `format()` from date-fns directly** for user-facing dates
2. **ALWAYS use the centralized timezone utilities** from `@/shared/lib/timezone`
3. **Database storage**: Always store as UTC ISO strings
4. **Display**: Always convert to clinic timezone before display

### Timezone Utilities (`src/shared/lib/timezone.ts`)

```typescript
import {
  // For timestamptz fields (appointments, created_at, etc.)
  formatInClinicTimezone,    // Generic: formatInClinicTimezone(date, 'EEEE d MMMM')
  toClinicTime,              // Convert UTC to clinic time for comparisons
  getClinicDateString,       // Get 'yyyy-MM-dd' in clinic timezone
  getClinicTimeString,       // Get 'HH:mm' in clinic timezone
  formatClinicDateFull,      // 'mercredi 21 janvier 2026'
  formatClinicDateShort,     // '21 janv. 2026'
  formatClinicTime,          // '14:30'
  formatClinicDateTime,      // '21 janv. 2026 à 14:30'
  clinicTimeToUTC,           // Convert form inputs to UTC for storage

  // For date-only fields (birthday, expiry_date, event_date, etc.)
  formatDateOnly,            // '1 janvier 2020' - NO timezone conversion
  formatDateOnlyFull,        // 'mercredi 1 janvier 2020'
  formatDateOnlyShort,       // '1 janv. 2020'
} from '@/shared/lib/timezone'
```

### Examples

```typescript
// ❌ WRONG - will show browser's local timezone
format(new Date(apt.startTime), 'dd MMM yyyy', { locale: fr })
new Date(dateStr).toLocaleDateString('fr-CA', {...})

// ✅ CORRECT - uses clinic timezone
formatClinicDateShort(apt.startTime)
formatInClinicTimezone(apt.startTime, 'dd MMM yyyy')

// ❌ WRONG - date comparisons in wrong timezone
const aptDate = new Date(apt.startTime)
if (isToday(aptDate)) { ... }

// ✅ CORRECT - convert to clinic time first
const aptDate = toClinicTime(apt.startTime)
if (isToday(aptDate)) { ... }

// ❌ WRONG - saving form input without timezone conversion
const startTime = `${date}T${time}:00`

// ✅ CORRECT - convert clinic time to UTC before saving
const startTimeUTC = clinicTimeToUTC(date, time)
```

### Date-Only Fields (Birthday, Expiry Dates, etc.) - CRITICAL

For **date-only fields** stored as `date` type (not `timestamptz`), do NOT apply timezone conversion. These are calendar dates without time components.

**Common date-only fields:**
- `birthday` / `date_of_birth`
- `expiry_date` (licenses, external payers)
- `event_date` (IVAC)
- Any field storing just a calendar date without time

```typescript
// ❌ WRONG - will shift date by timezone offset (e.g., 2020-01-01 → 2019-12-31)
formatInClinicTimezone(client.birthday, 'dd MMMM yyyy')
formatInClinicTimezone(payer.expiry_date, 'dd MMMM yyyy')

// ✅ CORRECT - use formatDateOnly utility (no timezone conversion)
import { formatDateOnly, formatDateOnlyFull, formatDateOnlyShort } from '@/shared/lib/timezone'

formatDateOnly(client.birthday)           // "1 janvier 2020"
formatDateOnly(client.birthday, 'dd/MM/yyyy')  // "01/01/2020"
formatDateOnlyFull(payer.event_date)      // "mercredi 1 janvier 2020"
formatDateOnlyShort(payer.expiry_date)    // "1 janv. 2020"
```

**Why this bug happens:** When you pass a date-only string like `"2020-01-01"` to `formatInClinicTimezone()`, JavaScript interprets it as UTC midnight. Converting to EST/EDT shifts it back 4-5 hours, resulting in December 31, 2019 at 19:00.

### Configuration

The clinic timezone is `organizations.timezone` (validated against `pg_timezone_names`; default `America/Toronto`). It reaches the app in the access payload (`get_my_access().org_timezone`): `AccessProvider` calls `setClinicTimezone()` as soon as access loads, before any page renders, and `resetClinicTimezone()` on sign-out. It is changed in Paramètres → « Région »; saving reloads the access, which re-applies it (known gap: status doc follow-ups, « Clinic timezone propagation »).

## 10. Form Accessibility & Tab Order (IMPORTANT)

All forms must follow proper keyboard navigation patterns for professional SaaS UX.

### Tab Order Rules

1. **Close buttons (X) should NOT be in the tab order** - Users expect Tab to navigate form fields, not UI chrome
2. **Section navigation tabs inside a form or sheet should NOT be in the tab order** - These are clicked with mouse, not keyboard-navigated. **Page-level views** (e.g. « Utilisateurs / Rôles ») are different: they must be reachable by keyboard. Use real tabs (Radix Tabs: one tab stop, arrow keys switch), never `tabIndex={-1}` (decision #35).
3. **Form fields should flow naturally** - Prénom → Nom → Sexe → Langue → etc.

### Implementation

#### Sheet/Dialog Close Buttons

Both `Sheet` and `Dialog` components have `tabIndex={-1}` on their default close buttons. This is automatic.

```tsx
// If you add a CUSTOM close button in your header, use hideClose:
<SheetContent hideClose>
  <header>
    <h2>Title</h2>
    <Button onClick={onClose} tabIndex={-1}>  {/* Custom close also needs tabIndex={-1} */}
      <X />
    </Button>
  </header>
</SheetContent>

// If using the DEFAULT close button, nothing special needed:
<SheetContent>
  {/* Default X button already has tabIndex={-1} */}
</SheetContent>
```

#### Section Navigation Tabs

For form section tabs (Identité, Coordonnées, Adresse, etc.), use `NavTabs` component:

```tsx
import { NavTabs, NavTab } from '@/shared/ui/nav-tabs'

<NavTabs className="border-b border-border px-6">
  {sections.map((section) => (
    <NavTab
      key={section.id}
      active={activeSection === section.id}
      icon={<section.icon className="h-4 w-4" />}
      onClick={() => setActiveSection(section.id)}
    >
      {section.label}
    </NavTab>
  ))}
</NavTabs>
```

Or manually with `tabIndex={-1}`:

```tsx
<button
  type="button"
  tabIndex={-1}  // Exclude from tab order
  onClick={() => setActiveSection(section.id)}
>
  {section.label}
</button>
```

### hideClose Prop

Both `SheetContent` and `DialogContent` support `hideClose` prop to prevent double X buttons:

```tsx
// ❌ WRONG - will show TWO close buttons
<SheetContent>
  <header>
    <Button onClick={onClose}><X /></Button>  {/* Custom X */}
  </header>
  {/* PLUS the default X from SheetContent */}
</SheetContent>

// ✅ CORRECT - hide default X when using custom
<SheetContent hideClose>
  <header>
    <Button onClick={onClose} tabIndex={-1}><X /></Button>
  </header>
</SheetContent>
```

## 11. Deploy

- **Never mutate staging without Jonathan's explicit go-ahead in chat**, every time: migrations, resets, edge-function deploys, secrets, Auth settings. The same goes for `git push`, opening PRs and GitHub secrets.
- **Never apply a migration through the Supabase MCP (`apply_migration`)** or by pasting SQL in the dashboard: it bypasses the migration history. Migrations go through git and `supabase db push`.
- **Merging to `main` is the deploy** (plan Task 1.22):
  - `supabase-migrations.yml` runs `supabase db push --linked --include-all` on staging when `supabase/migrations/**` changes, then checks for drift;
  - `apply-edge-functions.yml` deploys the changed functions (all of them when `_shared/` or `deno.json`/`deno.lock` change), honouring `verify_jwt` from `config.toml`;
  - Vercel builds the web app from `main`.
  Both workflows need the repository secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`, and can be re-run by hand (`workflow_dispatch`). Never also apply by hand what the merge deploys.
- The web app is hosted on Vercel. `vercel.json` rewrites every path **except `/assets/`** to `/index.html`, so SPA deep links (`/accueil`, `/reinitialiser-mot-de-passe`, …) do not 404 while a missing chunk does (the stale-chunk recovery relies on it); `/assets/*` is `immutable`, HTML `no-cache`. Keep these rules when adding Vercel config.
- Any remote reset uses `supabase db reset --linked --no-seed` (the seed is local only), and only with the go-ahead above.
- Pull requests must be green on CI (`ci.yml`: typecheck, lint, `lint:supabase`, Vitest, build, Deno check/lint/test of every function, pgTAP, types drift; `migration-lint.yml`).

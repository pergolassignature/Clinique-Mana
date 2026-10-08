# CLAUDE.md — Clinique MANA

## 1. Project

Clinique MANA is the management platform of a **dispatch clinic**: conseillères receive every request and match the client with one of ~50 independent professionals, 100 % online ([business context](docs/standards/business-context.md)). It is non-clinical: motifs are orientation tags, never diagnoses, and clinical notes stay out of the app (design D8). Tone and brand: [business context §6](docs/standards/business-context.md#6-brand--tone), which supersedes `docs/standards/brand.tokens.md` (legacy app tokens) for the redesign.

**The app is being rebuilt from its foundations** ([design](docs/plans/2026-10-06-foundation-rebuild-design.md), [plan](docs/plans/2026-10-06-foundation-phase-0-1-plan.md), [decisions log](docs/plans/2026-10-07-decisions-log.md), [ADRs](docs/adr/README.md)).

- The old app lives in `_legacy/` (tag `legacy-v1`). It is **read-only**: never edit or import it; it is excluded from TypeScript, ESLint, Vite and CI.
- **Legacy guidance lives in `_legacy/` too and must not be followed**: the old `claude.md`, the `.claude/workflows/` module pipeline and `.claude/skills/`, the old module status files, data contracts, deploy/testing guides and standards (listed in `_legacy/README.md`). Current rules: this file, `docs/standards/`, `docs/adr/`.
- Nothing the legacy app does may be lost silently: the parity checklist is [`docs/plans/2026-10-06-legacy-feature-inventory.md`](docs/plans/2026-10-06-legacy-feature-inventory.md).
- Built so far: the core (auth, access, modules, settings shell, audit, secrets) and module `professionals` as an empty placeholder.

## 2. Environments

| Environment | Where | Notes |
|---|---|---|
| Local | `supabase start` (ports **553xx**: API 55321, DB 55322, Studio 55323, Mailpit 55324) + `npm run dev` on **`http://localhost:5173`** | Use `localhost`, not `127.0.0.1`: a second origin means a second session. PS Hub's stack uses 543xx; never touch it. Test logins: see the header of `supabase/seed.sql`. |
| Staging | Supabase project `vnmbjbdsjxmpijyjmmkh` (Canada Central) | The only remote environment. It still holds the legacy schema until it is re-baselined (plan Task 1.21, needs Jonathan's go-ahead). |

Node **22** everywhere (`.nvmrc`, `package.json` `engines`, CI; decision #20). Production does not exist yet. `.env.local` (from `.env.example`) holds `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`; never put a service-role key in a `VITE_` variable.

## 3. Commands

```bash
npm run dev              # Vite on http://localhost:5173
npm run typecheck        # tsc --noEmit
npm run lint             # ESLint (incl. module import boundaries)
npm run lint:supabase    # no Supabase client in .tsx files
npm run lint:migrations  # migration timestamps (BASE_REF=origin/main by default)
npm run test:run         # Vitest, once (npm test = watch)
npm run test:functions   # deno test, all of supabase/functions (--frozen lock)
npm run check:functions  # deno check, all of supabase/functions (--frozen lock)
npm run lint:functions   # deno lint, all of supabase/functions
npm run build:pdfmake    # regenerate the vendored pdfmake (_shared/pdf/vendor/pdfmake.js)
npm run build            # typecheck + vite build (build:only = vite build)

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
    access/       AccessProvider, access-context (useAccess, useReadyAccess, accessKeys), guards (RequireAuth, RequireAccess)
    modules/      manifest types, resolveEnabledModules, list/toggle API + hooks (moduleKeys), error allow-list
    settings/     SettingsLayout, coreSettingsSections, pages/ (modules toggle)
    supabase/     client.ts (the only client), database.types.ts (generated, never edited)
  modules/<name>/ manifest.ts, index.ts (public entry), pages/ — later api/, hooks/, components/
  shared/         ui/ (shadcn), components/ (RouteBoundary, ErrorBoundary, FullPageMessage), lib/ (timezone, usePageTitle, cn)
  i18n/           fr-CA.json + typed t()
  test/           renderWithContexts, testAccess, setup
supabase/
  migrations/     core_access, core_audit, core_module_settings_secrets, professionals_module
  functions/      _shared/ (auth.ts, modules.ts, timing-safe-equal.ts) + deno.json/deno.lock
  tests/database/ pgTAP, one file per migration + 000_invariants
  seed.sql        LOCAL ONLY
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
- « Paramètres » follows its sections (decision #19): the nav item shows, and `parametres/*` opens, only when the user can access **at least one** settings section (core or enabled module); otherwise the route shows the forbidden page. `settings.view` alone does not open it (staff have it but no section yet).
- A module owns its tables and publishes views/RPCs for other modules; never read another module's raw tables. Migrations are additive within a release.
- Each module ships pgTAP, unit and (from Phase 4) Playwright tests, and a `docs/modules/<name>.md`.
- Before building a module, mark every item of its inventory section **Keep / Change / Drop** in its design doc (Drop needs Jonathan's OK).

## 6. Database rules

The full rules, with examples, are in **[`docs/standards/database-conventions.md`](docs/standards/database-conventions.md)**; read it before writing a migration. The core in short ([core module doc](docs/modules/core.md)):

- **Closed by default.** Every table: `revoke all … from anon, authenticated`, then explicit grants (`select`, column-level `update`). No client `insert`/`delete`/`truncate`: writes that need checks go through RPCs.
- **RLS on every table.** Policies use only the helpers in schema `private` — `private.current_user_org_id()`, `private.has_permission(text)`, `private.has_role(text)`, `private.current_user_role()` — always wrapped in `(select …)`. Never query `profiles` / `user_roles` inline in a policy (legacy hit RLS recursion twice). Every module policy has a `has_permission` term: that is what makes a disabled module's rows disappear.
- **Every business table** has `org_id` and `private.audit_trigger()` (arguments = columns to redact). `audit_log` is append-only.
- **Functions:** `set search_path = ''`, fully-qualified names; `security definer` only when needed, permission check first; RLS helpers and trigger functions in `private`, only intended RPCs in `public`. User-facing errors use `errcode = 'P0001'` in French.
- **Secrets** only through `set_org_secret` / `delete_org_secret` / `list_org_secret_keys` (clients) and `get_org_secret` (service role only). Values live in Vault and never appear in the audit log.
- **Migrations:** `YYYYMMDDHHMMSS_<english_name>.sql` from `date -u +%Y%m%d%H%M%S`, seconds ≠ `00`. Never rewrite an applied migration. Seeds in migrations use `on conflict do nothing`. Write the pgTAP test first; regenerate types (`npm run db:types`) after every migration.
- **Invariants:** `supabase/tests/database/000_invariants.test.sql` checks the whole catalog (RLS on, no client insert/delete, `search_path`, FK indexes, audit triggers, `security_invoker` views…). Keep it green; never disable it.
- **`supabase/seed.sql` is local only.** Any reset of a remote database uses `--no-seed`.

## 7. Edge functions

- Shared helpers in `supabase/functions/_shared/`: `verifyAuth(req, { permission, module })`, `verifyServiceRoleAuth(req)`, `requireModule(client, key)`, `requireModuleForOrg(serviceClient, orgId, key)`, `getUserClient(token)`, `getServiceRoleClient()`, `jsonResponse`, `errorResponse(code, message, status)`, `handleCors`, `timingSafeEqual`.
- **Shape:** each function is `handler.ts` (all logic: `createHandler(deps)`, no `Deno.serve`, no env read at import) and `index.ts` (wiring only: `Deno.serve(createHandler(defaultDeps()))`). `Deps` (`_shared/deps.ts`) injects `env`, `fetch`, `now`, `serviceClient`, `userClient`; tests pass the doubles in `_shared/testing/` (`fake-supabase.ts`, `fake-fetch.ts`, `fixed-clock.ts`, `env.ts`), which no `index.ts` imports.
- **Database through RPCs only:** `client.rpc(…)` and `client.storage`, never `.from('<table>')`. Independent awaits run in `Promise.all`.
- **Bodies:** `readJson(req, schema)` (`_shared/http.ts`, Zod, 64 KB cap → 413; invalid → 400 `invalid_request`, never echoing the input). Files never pass through a body: signed upload URLs.
- **Shared libraries:** `_shared/rate-limit.ts` (`consume(serviceClient, LIMITS.x, keyParts)`, HMAC-hashed keys; refused → 429 `rate_limited`, but `reason: 'unavailable'` (fails closed) → 503 `not_configured`; `clientIp(req)`, IPv6 grouped by /64, no IP → shared `'unknown'` bucket), `_shared/webhooks.ts` (`webhookResponse`, `claimEvent` / `completeEvent` / `failEvent`), `_shared/jobs.ts` (`runJob(deps, req, jobKey, perOrg, { perOrgTimeoutMs })` for cron and « Exécuter maintenant »; each org is cut at 60 s by default → `error` / `timeout`), `_shared/links.ts` (`generateToken()` 32 random bytes → 43 base64url chars; `isWellFormedToken(v)` before any hashing or lookup; `hashToken(t)` → `\x…` SHA-256 hex for `p_token_hash`; `linkUrl(APP_URL, '/invitation', t)` puts the token in the `#t=` fragment, https only except `http://localhost:5173`; the raw token is never stored, logged or returned).
- **Job auth:** `pg_net` keeps queued request headers in `net.http_request_queue`, readable by every database role, so `private.invoke_job_function` sends no secret, only `X-Job-Signature: t=<unix s>,v1=<hex HMAC-SHA256(INTERNAL_FUNCTION_SECRET, "<t>.<job_key>.<org_id or ''>.<trigger>")>`. `runJob` recomputes it from the body (`job_key` required), accepts ±300 s, answers 401 `unauthenticated` on any mismatch (a bearer is ignored) and 503 `not_configured` (reported) without the secret. Never call `verifyServiceRoleAuth` from a `pg_net` caller.
- **Error reports:** `reportError({ fn, code, ids })` (`_shared/report.ts`): Sentry when `SENTRY_DSN` is set, else one `console.error` JSON line. Only the function name, a code and row ids: never an address, token, message or body (keys such as `email`, `to`, `token`, `password` are refused; `fn` / `code` must be identifiers, id values with `@`, whitespace or over 100 characters are dropped). Sentry gets 3 s, then the console line. `FunctionError` lives in `_shared/errors.ts`.
- `verify_jwt = false` only when the function calls `verifyAuth` / `verifyServiceRoleAuth` first, verifies a webhook signature with `timingSafeEqual`, or is a job (`runJob` verifies `X-Job-Signature`).
- **Public token functions** (`resolve-link`, `accept-invite`): `verify_jwt = true` (the anon key is required) but no user; the token in the body authorizes. They rate-limit (`consume` on `clientIp`) **before any lookup**, answer with CORS restricted to `ALLOWED_ORIGINS`, and take the org and module from the link row, then `requireModuleForOrg`. Unknown, revoked and disabled-module tokens answer the same `link_invalid`.
- `verifyAuth` reads `get_my_access()`: it requires an active profile, then the module (if `module` is given), then the permission.
- **Module gate, always:**
  - user-scoped functions call `verifyAuth(req, { module: '<module>' })` or `requireModule(auth.client, '<module>')`;
  - service-role, webhook and cron functions resolve the org **from the database row** they act on, then call `requireModuleForOrg(serviceClient, orgId, '<module>')` (RPC `module_enabled_for_org`, service role only). The service role bypasses RLS, so nothing else gates them.
- **Never trust an org id sent by the client**: use `auth.access.org_id`, or the org of the row.
- `verifyServiceRoleAuth` contract: `Authorization: Bearer <key>`, where the key is `SUPABASE_SERVICE_ROLE_KEY`, one of `SUPABASE_SECRET_KEYS` or `INTERNAL_FUNCTION_SECRET`; 500 when none is configured.
- Errors are `{ error: { code, message } }`. Codes stay English and the UI maps each to French (P3-28): `invalid_request` (400; 413 for a body over the cap), `unauthenticated` (401), `forbidden` / `module_disabled` (403), `not_found` (404), `conflict` (409), `link_invalid` / `link_expired` / `link_used` (410), `rate_limited` (429), `server_misconfigured` / `internal` (500), `provider_error` (502), `auth_unavailable` / `not_configured` (503). The client and service factories return a 500 `Response` when `SUPABASE_URL` or a key is missing: check `instanceof Response`.
- CORS: `ALLOWED_ORIGINS` (comma-separated) is echoed with `Vary: Origin`; unset means `*`. Pass `req` to `jsonResponse` / `errorResponse`. Webhooks are not browser-facing: they answer with `webhookResponse` (no CORS, `no-store`).
- Imports use bare specifiers mapped in `supabase/functions/deno.json` (exact versions, `@supabase/supabase-js` pinned to the web app's version). Run deno with `--config supabase/functions/deno.json` (the npm scripts do, with `--frozen`), so imports resolve from the functions' own `deno.lock`, not from the web app's `node_modules`. Format with `deno fmt --config supabase/functions/deno.json supabase/functions/`.
- **Every npm package in `deno.lock` ships in every function:** the edge-runtime bundler embeds the lock's whole npm graph, imported or not (ADR 0008). Add an npm dependency only when most functions need it.
- **PDF rendering (`_shared/pdf/`, P3-19), the one exception to bare specifiers:**
  - pdfmake is **vendored**, not in `deno.json`: `_shared/pdf/vendor/pdfmake.js` is pdfmake 0.3.11's Node build pre-bundled into one minified module (with its license notices), generated by `npm run build:pdfmake` (`scripts/build-pdfmake.ts`, npm resolution pinned by `scripts/build-pdfmake.lock`). Never edit it; deno lint/fmt skip it, and `vendor/pdfmake.d.ts` types the part we use. A function carries it (≈ +0.5 MB uploaded) only when its module graph imports `_shared/pdf/render.ts`;
  - import `render.ts` (`renderPdf(doc, assets) → { bytes, pageCount, fields }`) only from code that renders. `model.ts` (the closed block model, `checkDocument`, `PdfError`), `template.ts` (`fillTemplate`) and `assets.ts` (`loadAssets(serviceClient, [{ key, bucket, path }])`, parallel, 2 MB cap) are pdfmake-free, so a module shared with non-rendering functions (e.g. the signing webhook) must not import `render.ts`;
  - the renderer validates the document (with document-wide caps: 400 table rows, 200 000 characters → `document_too_large`), embeds only PNG/JPEG assets (≤ 4000 px a side, else `image_too_large`) as data URLs, denies pdfmake's URL and local-file access, keeps headings with the next block (the headings before the signature page move onto it), never adds a blank page (a `pageBreak` or the signature page breaks only below content), maps U+202F → U+00A0, picks the Inter subset (latin, latin-ext, vietnamese) per run of text, and puts signing fields at fixed boxes (initials in each page header, signature and date on the last page, the signature page). Output is deterministic (fixed creation date). `vendor/pdfmake.js.sha256` pins the vendored file (`isolation.test.ts`); `OFL-Inter.txt` is the fonts' license (OFL 1.1).

## 8. Frontend rules

- **The auth behaviours are deliberate — read decisions log #9–17 and ADR 0006 before changing them.**

- **No Supabase client in `.tsx` files** (`npm run lint:supabase`): queries live in `api.ts` / `api/*.ts`, called through hooks. Type-only imports (`import type …`) are allowed. Providers that must touch the client carry a `// SUPABASE_ALLOWED: <reason>` comment.
- The only client is `supabase` from `@/core/supabase/client`; it fails fast without `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, and stores the session under `AUTH_STORAGE_KEY` (`clinique-mana-auth`). The password-recovery marker (`RECOVERY_STORAGE_KEY`, `src/core/auth/recovery.ts`) is bound to the recovery session's `session_id`; while it is set, `RequireAuth` sends every protected page to `/reinitialiser-mot-de-passe`.
- Contexts: `useAuth` from `@/core/auth/auth-context`; `useAccess`, `useReadyAccess`, `accessKeys` from `@/core/access/access-context`. Provider files export only components. Under `RequireAuth`, use `useReadyAccess()` (it throws unless access is ready). Permission checks: `useAccess().can(key)` and `<RequireAccess permission="…">` — the UI hides what the user cannot do, the database enforces it.
- React Query key factories are named `<thing>Keys` (`accessKeys`, `moduleKeys`); mutations invalidate the factory's `all`.
- **All user-facing text goes through `t()`** from `@/i18n` (keys typed from `src/i18n/fr-CA.json`). Pages title the browser tab with `usePageTitle()`.
- Toasts: `toast` from `@/shared/ui/sonner`. RPC errors shown to users go through `moduleErrorMessage` (`src/core/modules/errors.ts`): `P0001` message as is, `42501` → generic permission text (not reported), `23514` (check violation) → « valeur invalide » text, also reported to Sentry (it only follows a bypass or a Zod/SQL parity bug), anything else → the caller's fallback + Sentry. Pass the third argument (`area`, e.g. `'settings'`) to tag the report. The report is a fresh `Error` named `RpcError <code>` with the message only: never pass a raw PostgREST error to Sentry (its `details`/`hint` can hold row values). `main.tsx`'s `beforeSend` (`scrubSentryEvent`) is the backstop.
- Route and settings crashes stay local: `RouteBoundary` (`@/shared/components/RouteBoundary`); full-page states use `FullPageMessage`.
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

The clinic timezone is `organizations.timezone` (validated against `pg_timezone_names`; default `America/Toronto`). It reaches the app in the access payload (`get_my_access().org_timezone`): `AccessProvider` calls `setClinicTimezone()` as soon as access loads, before any page renders, and `resetClinicTimezone()` on sign-out. The Settings section to change it comes in Phase 2 (« Région »).

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
- The web app is hosted on Vercel. `vercel.json` rewrites every path to `/index.html` so SPA deep links (`/accueil`, `/reinitialiser-mot-de-passe`, …) do not 404; keep it when adding Vercel config.
- Any remote reset uses `supabase db reset --linked --no-seed` (the seed is local only), and only with the go-ahead above.
- Pull requests must be green on CI (`ci.yml`: typecheck, lint, `lint:supabase`, Vitest, build, Deno check/lint/test of every function, pgTAP, types drift; `migration-lint.yml`).

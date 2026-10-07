# Clinique MANA — Foundation Rebuild Design

**Date:** 2026-10-06
**Status:** Approved (brainstorming session with Jonathan)
**Supersedes:** the current `src/` and `supabase/migrations/` (moved to `_legacy/`)

> **As built (2026-10-07).** Phase 1 changed some details below; where they differ, the code and these documents win: [plan amendments A1–A5](2026-10-06-foundation-phase-0-1-plan.md#amendments-2026-10-07--read-before-tasks-17-onward), [core schema review](../audit/2026-10-07-core-schema-design-review.md), [decisions log](2026-10-07-decisions-log.md), [database conventions](../standards/database-conventions.md), [core module](../modules/core.md).
>
> - **Code identifiers are English:** module key `professionals`, folder `src/modules/professionals/`, permissions `professionals.*`. URLs and labels stay French (`/professionnels`, « Professionnels »). §6.1's `professionnels/` folder is now `professionals/`.
> - **Roles are a table** (`roles`: `admin`, `staff`, `provider`); `user_roles.role` is text referencing it, not an `app_role` enum (§2). `user_roles` and `user_permission_overrides` carry `org_id`.
> - **RLS helpers live in schema `private`** (not exposed over the API): `private.current_user_org_id()`, `private.current_user_role()`, `private.has_role(text)`, `private.has_permission(text)`. Policies call `(select private.…)`. `current_professional_id()` arrives with the Professionnels tables (Phase 4).
> - **A disabled module grants nothing in the database:** `has_permission` and `get_my_access()` drop its permissions. `get_my_access()` also returns `modules`, `org_name` and `org_timezone`, and is empty unless the profile is active.
> - **Module activation (§3):** dependencies are rows in `module_dependencies` (not `modules.depends_on text[]`); `org_modules` has `enabled, updated_at, updated_by` (not `enabled_at, enabled_by`); `core` is registered as a module and is always on.
> - **Frontend (§2):** the access context exposes `status`, `access`, `problem`, `can()`, `reload()`, `isReloading` (no `hasRole`); `useReadyAccess()` returns the verified access under `RequireAuth`. `RouteBoundary` lives in `src/shared/components/`, not `src/app/`.
> - **Edge functions (§2):** `verifyAuth(req, { permission, module })` (no `role` option) reads `get_my_access()` and requires an active profile; `requireModule()` uses `module_enabled()`; functions without a user use `requireModuleForOrg()` (`module_enabled_for_org`, service role only). Errors are `{ error: { code, message } }`.
> - **Migrations (§6.1):** four files (`core_access`, `core_audit`, `core_module_settings_secrets`, `professionals_module`) instead of one `00000000000001_baseline.sql`; pgTAP tests in `supabase/tests/database/`.
> - **Local stack** runs on ports 553xx and `http://localhost:5173` (decisions log #1, #18).

---

## 1. Context

Clinique MANA was built fast. The concepts are right (professionals, motifs, services, clients, demandes, availability, billing, contracts), but the foundation is not:

- Build is red (32 TS errors, 16 ESLint errors), no CI, ~1 test file.
- 106 migrations, ~30 of them fixes/rewrites/renames; RLS recursion workarounds; no generated DB types.
- Roles only exist in the DB: no route guards, no menu filtering, no permission helper.
- No identity lifecycle: providers get a random password, invites are copy-pasted links, no reset.
- Security holes in staging: anon can list all active invite tokens + emails; `docuseal-create-submission` callable by any logged-in user; several edge functions without auth.
- Clinic identity, signer, address and tax rates (TPS 5 % / TVQ 9.975 % in `src/facturation/api.ts`) are hardcoded. Clinic TPS/TVQ registration numbers exist nowhere.

**Business model** ([business context](../standards/business-context.md)): MANA is a **dispatch clinic**. Conseillères receive every request, evaluate the need and match the client with the right professional from a bank of ~50 independent professionals, 100 % online. The clinic runs on **GOrendezvous** today. Clinique MANA is "a GOrendezvous adapted to a dispatch clinic": it adds what GOrendezvous lacks (management of the professional bank, the dispatch workflow) and progressively covers the practice features MANA relies on.

**PS Hub** (`pergolassignature/new-ps-hub`) is an unrelated but mature app on the same stack. We rebuild Clinique MANA on PS Hub's proven foundations, module by module, and fix the things PS Hub itself lacks (module registry, settings registry, shared UI kit, secrets in Vault).

### Decisions taken

| # | Decision | Choice |
|---|----------|--------|
| D1 | Starting point | Same repo, same staging Supabase project (`vnmbjbdsjxmpijyjmmkh`). Staging holds no real data → wipe and re-baseline. Old code kept read-only in `_legacy/` + git tag `legacy-v1`. |
| D2 | Email scope | The clinic sends transactional emails (invites, profile-update links, contracts) from a clinic address via **Resend**. No Gmail/Outlook connection for professionals. |
| D3 | Tenancy | Single clinic, **`org_id` on every business table from day one**. |
| D4 | E-signature | **Documenso**, separate self-hosted instance for the clinic (e.g. `sign.cliniquemana.com`) — Loi 25 separation from Pergolas Signature, clinic branding. Replaces DocuSeal. |
| D5 | Code organisation | **Module manifests + shared core** (`src/core`, `src/modules/<x>/manifest.ts`, `src/shared/ui`). Backend conventions copied from PS Hub verbatim. |
| D6 | Router | **React Router v6** (match PS Hub), replacing TanStack Router. |
| D7 | Professionals' status | **Independent contractors** → profile stores tax numbers, bank details, SIN/BN (encrypted) and compensation terms. |
| D8 | Scope vs GOrendezvous | **Replace everything except clinical notes**: agenda, reminders, client portal, invoicing/receipts, payments. Clinical notes and records stay in a specialised tool (order-specific record-keeping rules + Loi 25). Both systems coexist during the transition, module by module. |

---

## 2. Identity, roles and permissions

Follows Supabase's official *Custom Claims & RBAC* pattern and PS Hub's helpers, with one deliberate deviation (role read from table, not JWT — instant revocation).

### Tables

- `organizations` — the clinic (identity, tax, region… see §3).
- `profiles` — `user_id` → `auth.users`, `org_id`, display name, email, `status` (`active` | `disabled`).
- `user_roles` — one row per user, `role app_role` ∈ `admin`, `staff`, `provider`.
- `permissions` — catalogue of permission keys (`key text pk`, `module_key`, `description`). Modules add their keys in their own migration. A table (not an enum) so new keys are usable in the same migration.
- `role_permissions` — `(role, permission_key)`; seeded defaults.
- `user_permission_overrides` — `(user_id, permission_key, granted boolean)`; per-user grant/revoke.

### SQL helpers

All `SECURITY DEFINER`, `STABLE`, `set search_path = ''`, called wrapped in `(select …)` in policies:

- `current_user_org_id()`
- `has_role(app_role)`
- `has_permission(text)` — role defaults ∪ grants − revokes; disabled profiles → false.
- `current_professional_id()`
- `get_my_access()` — RPC returning role + effective permission list for the frontend.

**Hard rule:** no policy queries `profiles`/`user_roles` inline — only through helpers (prevents the recursion bugs seen twice in legacy).

Canonical policy shape:

```sql
using (org_id = (select current_user_org_id()) and (select has_permission('professionals.view')))
```

### Authentication

- Email + password, password reset, optional magic link (Supabase Auth). Auth emails sent through Resend SMTP with clinic branding.
- Accounts are created **only when the invitee accepts** (`accept-invite` function) — never random passwords.

### Frontend

- `AuthProvider` (session + profile), `AccessProvider` (`can(key)`, `hasRole(role)`, `accessStatus`, `reload()`), both ported from PS Hub.
- `<RequireAccess permission="…">` route guard; menu built from manifests filtered by `can()`.
- Access load failure → "Réessayer" screen, never a silent downgrade (PS Hub rule).

### Edge functions

- `_shared/auth.ts` ported from PS Hub: `verifyAuth(req, { permission?, role? })`, `verifyServiceRoleAuth`, `getServiceRoleClient`, `getUserClient`, `jsonResponse`, `errorResponse`.
- `verify_jwt = false` in `config.toml` is allowed only when the function calls `verifyAuth` or verifies a webhook signature. Checked in review.
- `_shared/modules.ts`: `requireModule(client, 'professionals')`.

---

## 3. Settings and module activation

### Settings registry

Each module manifest declares `settingsSections: { id, labelKey, icon, permission, group, component: lazy(() => …) }[]`. The settings page (`/parametres/:section`) builds its left menu from core sections + enabled modules' sections. No hardcoded admin list (PS Hub's weakness).

**Rule:** every value printed on a document or used in a calculation comes from Settings — never hardcoded.

### Groups and sections

**Clinique (core)**

| Section | Content | Storage |
|---|---|---|
| Identité légale | Raison sociale, nom commercial, NEQ, siège social, téléphone, courriel, site web, logo | `organizations` columns, logo in storage |
| Fiscalité | No TPS (RT…), no TVQ (TQ…), statut d'inscription; **tax rates with `effective_from`** | `organizations` + `tax_rates(org_id, code, rate, effective_from, effective_to)` |
| Signataire | Nom, titre, image de signature du représentant | `organizations` + storage |
| Coordonnées bancaires | Institution, transit, compte, Interac — admin only | `organization_private` (encrypted) |
| Lieux de consultation | Addresses + "en ligne" | `locations(org_id, name, address…, is_virtual, is_active)` |
| Région | Fuseau horaire, langue par défaut, devise | `organizations` |
| Confidentialité (Loi 25) | Responsable de la protection des renseignements personnels (nom, courriel), URL politique, durée de conservation des dossiers | `organizations` |

**Plateforme (core)**

| Section | Content |
|---|---|
| Utilisateurs et accès | Users list, invite staff, role, per-user overrides, read-only role × permission matrix |
| Modules | Enable/disable modules (respecting `dependsOn`) |
| Courriels | Sender name/address, reply-to, Resend domain status, templates (FR, preview, test send), footer |
| Signature électronique | Documenso URL, API key (write-only), webhook status, test connection |
| Intégrations | Google Places (and later Calendar) status/keys |
| Tâches planifiées | Cron jobs: view, enable/disable, last run — schedules live in migrations, not dashboard |
| Journal d'audit | Read-only, filterable |

**Mon compte:** profile, password.

**Module sections** (registered by each module — see §5 and §7).

### Storage of settings

- Core identity → typed columns on `organizations` (validated, queryable).
- Per-module settings → `org_module_settings(org_id, module_key, settings jsonb)`, validated by a Zod schema exported by the module (client + edge function).
- **Secrets → Supabase Vault.** `org_secrets(org_id, key, vault_secret_id)`; readable only by service role in edge functions via `get_org_secret(org_id, key)`. UI is write-only ("Configurée ✓ / Remplacer").
- Sensitive non-secret data (bank, SIN…) → `*_private` tables with pgcrypto-encrypted columns, key from Vault, read via audited RPC only.

### Module activation

- `modules(key, name, depends_on text[])`, `org_modules(org_id, module_key, enabled, enabled_at, enabled_by)`.
- Disabled module → no routes, no menu entry, no settings sections in the frontend.
- Edge functions call `requireModule()`.
- At launch only **core + Professionnels** are enabled. Everything else stays in `_legacy/` until rebuilt.

---

## 4. Shared core services

### 4.1 Email (`core/email`, `send-email`)

- Resend from a verified clinic domain; `_shared/email.ts` adapted from PS Hub's `email-router.ts` (Resend path only).
- `email_templates(org_id, key, subject, body_html, variables, updated_by)` — keys like `professional.invite`, `professional.profile_update`, `professional.document_rejected`, `professional.document_expiring`, `contract.sent`. Editable in Settings with preview + test send. Defaults seeded.
- `email_log(org_id, template_key, to_email, subject_type, subject_id, resend_id, status, error, sent_by, created_at)`; status `queued → sent → delivered → opened | bounced | complained` updated by `resend-webhook` (Svix-verified, ported from PS Hub `_shared/svix-webhook.ts`).
- Every subject (e.g. a professional) can render its email timeline from `email_log`.

### 4.2 Secure links (`core/links`)

- `secure_links(org_id, purpose, subject_type, subject_id, token_hash, scope jsonb, expires_at, used_at, revoked_at, created_by)`.
- Token generated server-side (32 random bytes, base64url), only the SHA-256 hash stored. Purposes: `professional_invite`, `profile_update`.
- Anon has **no** access to the table; links are resolved by `resolve-link` / `accept-invite` edge functions. Fixes the legacy invite-listing hole.

### 4.3 E-signature (`core/signing`)

- Keep legacy's good abstraction: `document_templates` (versioned, publish RPC) + `signature_requests(org_id, template_version_id, subject_type, subject_id, documenso_document_id, status, signers jsonb, signed_pdf_path, certificate_path, idempotency_key, …)`.
- Edge functions: `signing-create` (render variables + PDF **server-side**, permission-checked), `signing-send` (Documenso v2 create → distribute), `signing-resend`, `signing-webhook`.
- Webhook (ported from PS Hub `documenso-webhook`): secret compared with `timingSafeEqual` (fail closed if unset), events claimed once via `claim_signing_webhook_event` RPC, signed PDF + audit certificate downloaded to private storage.
- Status: `draft → sent → viewed → signed | rejected | cancelled`. Realtime subscription in UI.
- Documenso URL + API key come from Settings/Vault, not code.

### 4.4 Audit (`core/audit`)

- One `audit_log(org_id, table_name, record_id, action, changed_fields jsonb, actor_id, actor_role, source, created_at)`, append-only, written by a generic trigger ported from PS Hub `fn_production_audit_trigger`. Replaces legacy's 8 per-table audit tables.
- Trigger attached to every business table. Reads of `*_private` data are logged by their RPCs.

### 4.5 Storage (`core/storage`)

- Private buckets; paths `{org_id}/{module}/{record_id}/{uuid}-{safe_name}`; access via short-lived signed URLs; size/MIME validated in storage policies + server.

### 4.6 Errors & observability

- Sentry (frontend + `_shared/sentry.ts`), per-module error boundaries, `ChunkLoadErrorBoundary` (ported), Sonner toasts, uniform `errorResponse` from edge functions.

---

## 5. Module 1 — Professionnels

> Parity: every item in [inventory §A](2026-10-06-legacy-feature-inventory.md#a-professionnels-incl-onboarding-documents-contrats-spécialités-motifs) must be marked Keep / Change / Drop in the module's own design doc before build (Phase 4).

### 5.1 Lifecycle

`draft → invited → in_review → active → inactive`

Plus a **derived** readiness checklist « Prêt à activer » (legacy "Formulaire → Documents requis → Activation", generalised): compte créé · formulaire approuvé · documents requis valides · contrat signé. Activation requires a complete checklist from **any** non-active status (fixes legacy bug where `invited` could not be activated and reactivation skipped blockers); admin override requires a reason (audited). Completion % shown.

Deactivation always records a reason: `manual` (with free text) or `insurance_expired` (automatic). Automatic reactivation only undoes automatic deactivation.

### 5.2 Data

| Table | Purpose |
|---|---|
| `professionals` | Identity, login email, personal phone (E.164), address (Google Places + manual, 13 provinces, Canada), **languages**, years of experience, status, deactivation reason + note, `profile_id` (null until account accepted) |
| `professional_public_profiles` | Public portrait: bio, approche, courriel public, téléphone public, photo document — used by the fiche PDF and later by matching/website |
| `professional_professions` | ≤ 2 (enforced in DB): `profession_title_id`, ordre, `license_number`, `is_primary` (exactly one; removing primary promotes the other). Single source of licence number |
| `professional_specialties` | Junction + `is_specialized` (star) |
| `professional_motifs` | Junction |
| `professional_payer_numbers` | IVAC number (unique globally, one per pro); extensible to other payers |
| `professional_documents` | `document_type_id`, file path, `status` (pending/verified/rejected/expired), `expires_at`, `metadata jsonb` (per-type, Zod-validated — e.g. insurer, policy no.), reviewer, rejection reason |
| `professional_consents` | E-signed consents captured in onboarding — first: **droit à l'image** (version, signer name, signed_at, 12-month auto-renew, 3-month withdrawal notice). Counts as a verified required document until signed_at + 12 months |
| `professional_private` | Encrypted: SIN/BN, TPS no., TVQ no., bank institution/transit/account. Read via `get_professional_private()` (requires `professionals.private.view`, logged) |
| `professional_compensation` | **Clinic margin by service type**, as in the legacy contract: consultation (range, e.g. 25–30 %), ateliers/conférences (25 %), annulation tardive (30 %), autres frais (15 %); `effective_from`, history kept. Defaults come from module settings; per-professional overrides allowed. Feeds the contract's Annexe A (professional's portion = price × (1 − margin)) |
| `professional_submissions` | Onboarding / update submissions as pending field diffs, `status` (draft/submitted/reviewed/approved), requested sections, prefilled snapshot, reviewer |

Reference tables owned by the module (settings): `profession_titles` (→ profession category), `professional_orders`, `specialties` (categories `therapy_type`, `clientele`; **clientèle codes `children`, `adolescents`, `adults`, `seniors`, `couples`, `families`, `groups` are stable keys used by matching**), `motifs` + `motif_categories` (icon, display order, `is_restricted` flag), `document_types` (`required`, `expiry_rule` e.g. `next_march_31` / `months:12` / none, `reminder_days`, accepted types, max size), `deactivation_reasons`, `compensation_defaults`.

**Integration points with later modules** (module isolation §6.2 — optional, never required for Professionnels to work):
- **Services et tarifs** adds `professional_services` (services per profession title) and a « Services » tab. Until it is enabled, the fiche PDF shows "Honoraires : À confirmer" and Annexe A shows margins only.
- **Rendez-vous** adds the Google Calendar connection (« Calendrier » tab) and availability.
- **Demandes** reads the published `professionals_directory` view (active pros + professions + specialties + motifs + languages) for matching.

### 5.3 Permissions

`professionals.view`, `professionals.manage`, `professionals.invite`, `professionals.documents.review`, `professionals.documents.delete`, `professionals.contracts.send`, `professionals.private.view`, `professionals.private.manage`, `professionals.settings.manage`. Providers access only their own row via `current_professional_id()`. UI hides actions the user can't perform (fixes legacy "delete shown but denied").

### 5.4 Flows

1. **Create & invite** — no recruitment pipeline in the app (decided 2026-10-07): candidates are screened outside the app, and staff **create the professional manually** once retained, as a `draft` (name, email, profession; email trimmed + lowercased, duplicate check against profiles + auth). « Envoyer l'invitation » (default on) creates a `secure_link` (default 7 days, configurable) and **actually emails** `professional.invite` → `invited`. Resend / revoke / new link; automatic reminders per settings; every send in the « Courriels » timeline.
2. **Onboarding (public)** — link → `accept-invite` creates the auth user with the chosen password and links `profile_id` → step-by-step questionnaire with autosave (local + server draft every few seconds, on "Continuer", manual save, retry): identité · professions et permis (≤ 2, licence required) · années d'expérience (0–50) · langues · portrait public (bio required, approche, contact public) · spécialités (with star) · motifs · fiscalité et banque · photo (required, JPEG/PNG ≤ 5 MB) · assurance responsabilité (required, PDF/JPEG/PNG ≤ 10 MB) · consentement droit à l'image (e-signed: checkbox + typed name) · révision → submit → `in_review`, staff notified. Uploads are attached to the submission and only become profile documents when approved.
3. **Review** — field-by-field diff (submitted vs current) with "ce qui sera remplacé" summary; apply all or per field, **in one transaction** (RPC); documents verified/rejected individually with reason emailed; provenance kept ("voir la soumission originale").
4. **Contract** — « Préparer le contrat » → variables from clinic settings (name, address, legal form, representative + title) + professional (name, login/public email, phone, address, professions joined " et ", licence) + compensation (Annexe A) + date → preview → send via Documenso (clinic signer second if configured) → webhook stores signed PDF + certificate and ticks the checklist. Declined/expired events handled. Regenerate = cancel previous + new request.
5. **Activation** — « Activer » when the checklist is complete → `active`.
6. **Profile update** — staff send « Mettre à jour votre profil » choosing any sections (select-all available), data prefilled → link to the authenticated profile (login or magic link) → same review flow. Professional can also start an update from « Mon profil ».
7. **Expiry** — daily cron (schedule in a migration, visible in Tâches planifiées): reminder email X days before `expires_at`; on expiry → document `expired` + configurable action (alert only / auto-deactivate with reason `insurance_expired`). Insurance expiry auto-set to the next **March 31** (`next_march_31` rule). Verifying a new valid insurance reactivates a professional deactivated for `insurance_expired` (never one deactivated manually).
8. **Fiche PDF (client-facing)** — after the discovery call, the conseillère **sends the proposed professional's fiche to the client**. One fiche per profession title, generated server-side from the public profile, motifs by category, clientèle specialties, honoraires (from the Services module once enabled) and clinic identity from Settings (no hardcoded phone/URL). Actions: **download** and **« Envoyer par courriel »** (any recipient, `professional.fiche` email template with the PDF attached, logged in `email_log` and the professional's « Courriels » timeline). The Demandes module later adds « Envoyer la fiche au client » from the matching screen (same core action, linked to the demande and client). Written in the brand tone (business context §6). `fiche_generated_at` recorded.

### 5.5 Screens

- **List** — search (name, email), filters (statut, profession, « documents expirant bientôt », « invitation en attente »), sort, checklist badges, counts.
- **Detail tabs** — Aperçu (checklist, "À compléter" alerts with jump links, next action, quick actions incl. fiche PDF) · Profil (identity, address, professions et permis, IVAC) · Profil public (portrait, spécialités, motifs) · Documents (required cards + « Autres documents » with general upload for CV, diplôme…) · Contrats · Rémunération et fiscalité (admin) · Courriels · Historique (timeline grouped by date, actor or « Système », expandable details).
- **Provider** — « Mon profil », « Mes documents ».
- **Module settings** — Professions et ordres · Spécialités · Motifs et catégories · Documents requis · Consentements · Invitations · Contrats (templates with versioning: draft → published → archived, one published per key, preview with sample data, variables cheat-sheet; default signer) · Rémunération (default margins) · Raisons de désactivation.

---

## 6. Project foundation

### 6.1 Structure

```
src/
  app/          router, providers, AppShell, module registry
  core/         auth · access · settings · email · links · signing · audit · storage
  modules/
    professionnels/  manifest.ts · api/ · hooks/ · components/ · pages/ · schemas.ts
  shared/       ui/ (shadcn + DataTable, PageHeader, EmptyState, FormSheet, ConfirmDialog) · lib/ (timezone, format, cn)
  i18n/         fr-CA (keys structured so EN can be added)
_legacy/        old src + migrations + functions, read-only, excluded from tsconfig/eslint/vite
supabase/
  migrations/   00000000000001_baseline.sql, then one+ migration per module
  functions/    _shared/ (ported from PS Hub) + functions
  tests/        pgTAP RLS tests
  seed.sql      org, test users (admin/staff/provider), reference data
```

Module-internal layering: `api/` (Supabase calls, typed) → `hooks/` (React Query, `*Keys` factory) → `components/`/`pages/`. Components never call Supabase directly (`lint:supabase` guard ported from PS Hub). Keep legacy's timezone utilities (`shared/lib/timezone`) and the CLAUDE.md timezone + tab-order rules.

### 6.2 Module isolation rules (build module by module without breaking the rest)

The goal: adding, changing or disabling one module never breaks another. Enforced by tooling, not discipline.

1. **Import boundaries (ESLint `no-restricted-imports`, CI-blocking).**
   - `src/core/**` and `src/shared/**` never import from `src/modules/**`.
   - A module imports another module **only** through its public entry `src/modules/<x>/index.ts` — never deep paths. The public entry exports only types, read hooks and small components meant for reuse (e.g. `ProfessionalPicker`).
   - A module may only import modules listed in its manifest `dependsOn`.
2. **Database ownership.**
   - Each module owns its tables (prefix-free names, but listed in `docs/modules/<x>.md`). Only the owning module's migrations alter them.
   - Cross-module reads go through a **view or RPC the owner publishes** (e.g. `professionals_directory` view used by Rendez-vous), never through the other module's raw tables. Changing internals then doesn't break consumers.
   - Foreign keys across modules point only at the owner's stable primary keys.
   - Migrations are additive within a release; destructive changes need an ADR and a two-step (deprecate → remove) migration.
3. **Runtime isolation.**
   - Each module route tree is wrapped in its own error boundary + lazy chunk: a crash or failed chunk in one module shows a local error, the rest of the app keeps working.
   - A disabled module (`org_modules.enabled = false`) contributes nothing: no routes, no menu, no settings, its edge functions refuse calls (`requireModule`).
4. **Core is a stable contract.**
   - `core/` APIs (access, settings, email, links, signing, audit, storage) are versioned by ADR. A breaking change to core requires updating every enabled module in the same PR, verified by CI.
5. **Tests per module + whole-app smoke.**
   - Each module ships its own pgTAP, unit and Playwright tests. CI always runs **all** modules' tests, so a change in one module that breaks another goes red before merge.
6. **Legacy parity checklist.**
   - `docs/plans/2026-10-06-legacy-feature-inventory.md` lists every legacy feature, rule, calculation and automation per module. A module's design doc must mark each item **Keep / Change / Drop** (drop requires Jonathan's OK). Visual design and layout are free to change completely; behaviour is not lost silently.

### 6.3 Stack

React 19 · Vite · TypeScript (strict) · React Router v6 · TanStack Query · Tailwind + shadcn/ui · Zod + react-hook-form · Sonner · Framer Motion · typed `t()` i18n helper kept from legacy (fr-CA; structure allows EN later) · Sentry · typed Supabase client (`npm run db:types`).

### 6.4 Quality gates

- **CI on PR** (GitHub Actions): `typecheck`, `lint`, `lint:supabase`, `test` (Vitest), `supabase test db` (pgTAP), migration timestamp lint.
- **CD on merge to `main`** (ported from PS Hub): apply migrations, deploy changed edge functions, Vercel frontend.
- **Module Definition of Done**: 0 TS/lint errors · pgTAP tests for every table's RLS · unit tests for business logic · one Playwright happy path · `docs/modules/<module>.md` · ADRs for decisions · enabled via `org_modules`.

### 6.5 Docs

- `CLAUDE.md` rewritten using PS Hub's structure (deploy surfaces, RLS rules, do-not list).
- `docs/adr/`: 0001 Foundation rebuild · 0002 Permissions model · 0003 Module & settings registry · 0004 Secrets in Vault & encrypted private tables · 0005 Documenso replaces DocuSeal.

---

## 7. Roadmap

| Phase | Scope |
|---|---|
| **0. Preparation** | Push pending commit `7d5d48c`; tag `legacy-v1`; **back up staging (schema + data dump) and record its live grants/cron jobs**; move old code to `_legacy/`. **Owner actions:** rotate PS Hub secrets exposed in `docs/CONTRACT_SIGNATURE_MODULE.md`; provision clinic Documenso instance; verify clinic domain in Resend. |
| **1. Base** | Scaffold, CI/CD, baseline migration (organizations, profiles, roles/permissions, modules, settings, secrets, audit), auth (login, reset, magic link), AppShell + module registry, shared UI kit. **Staging DB wipe — requires explicit go-ahead.** |
| **2. Core Settings** | All Clinique + Plateforme sections (§3). |
| **3. Shared services** | Email + templates + log, secure links, Documenso signing, storage. |
| **4. Professionnels** | 4a data + list + detail → 4b invite + onboarding → 4c review + documents + expiry → 4d contract + activation. |
| **Next modules** | One at a time, each with its own design doc and inventory Keep/Change/Drop pass. Order: **Services et tarifs** (feeds fiche honoraires + contract Annexe A) → Clients → Demandes (+ matching) → Rendez-vous (+ Google Calendar) → Facturation (+ Payeurs externes IVAC/PAE). |

### Later-module settings (captured so nothing is lost)

- **Services et tarifs** — catalogue, durations, price per profession category, tax-exempt rules.
- **Facturation** — invoice numbering/prefix, file-opening fee, cancellation policy (delay, % fee), payment terms, legal mentions, payment methods.
- **Payeurs externes** — clinic IVAC provider number, IVAC rates, PAE providers.
- **Rendez-vous** — opening hours, holidays/closures, rooms, reminders.
- **Clients** — consent versions, file numbering.
- **Demandes** — recommendation weights.

---

## 8. Open items

- **Data migration from GOrendezvous** (clients, appointments, invoices): plan it in each replacing module's design.
- **Videoconference platform** for sessions (100 % online): link per appointment?
- **B2B** (ateliers, conférences, MANA's own PAE offer, schools): a future area, not in legacy.

- Legacy bugs to decide per module (examples): taxable categories not taxed server-side, free invoices auto-voided, PAE never applicable, no booking conflict check — see inventory "Half-built / broken" lists.
- Annexe A wording: legacy says "taxes incluses" while prices are stored pre-tax — confirm intended wording.

- Confirm with the accountant which slips are required for contractors (T4A box 048; Quebec equivalent if any) — affects whether SIN or BN is mandatory.
- Check the Supabase plan for the clinic org supports Branching (PR preview DBs); otherwise CI runs migrations + pgTAP against a local Supabase in Actions.
- Production Supabase project to be created before go-live (staging-only today).

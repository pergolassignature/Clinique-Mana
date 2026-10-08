# Phase 2 — Core Settings: design

**Date:** 2026-10-07 · **Status:** Approved (brainstorming with Jonathan, sections 1–3 validated in chat) · **Branch:** `feat/phase-2-core-settings`
**Builds on:** [foundation design §3](2026-10-06-foundation-rebuild-design.md#3-settings-and-module-activation), [decisions log](2026-10-07-decisions-log.md) (#22–#28 come from this design), [database conventions](../standards/database-conventions.md), [ADR 0004](../adr/0004-secrets-in-vault.md), [business context](../standards/business-context.md).

## 1. Goal and scope

Every value printed on a document or used in a calculation comes from Settings, never from code. Phase 2 gives the clinic its identity, tax setup, signatory, bank details, region and Loi 25 data. It also gives administrators control of who can do what, a readable audit trail, and gives every user a « Mon compte » page. It also lays the visual foundation the following modules are built on.

| Batch | Content |
|---|---|
| **2a. Foundation** | Visual foundation (brand tokens, self-hosted Raleway, shell, form kit) · roles `counselor` and `admin_assistant` replace `staff` · French settings URLs · « Mon compte » |
| **2b. Clinique** | Identité légale · Fiscalité (TPS/TVQ numbers + dated rates) · Signataire · Coordonnées bancaires (encrypted) · Région · Confidentialité (Loi 25) |
| **2c. Utilisateurs et accès** | Users list, role, enable/disable, per-user permission overrides, read-only role × permission matrix |
| **2d. Journal d'audit** | Filterable, paginated viewer with before/after details |

### Deferred to where they belong

| Item | Goes to | Why |
|---|---|---|
| Staff invitations | After Phase 3 | Accounts are created on acceptance only; that needs secure links + clinic emails (decision #22). Until then accounts are added by hand (dashboard + `scripts/bootstrap-admin.sql` pattern). |
| Logo, signature image | Phase 3 (storage) | Only generated documents use them, and those arrive in Phase 3+. |
| Courriels, Signature électronique | Phase 3 | They configure the Phase 3 services. |
| Tâches planifiées | Phase 4 | The first cron job (insurance expiry notice) arrives with Professionnels. |
| Intégrations (Google) | With the module that uses them | Nothing to configure before. |
| Lieux de consultation | Rendez-vous, if ever needed | The clinic is 100 % online; legacy had no locations (business context §5). |
| Tax registration status | Facturation | Whether a service is taxable is decided per service there. |
| IVAC provider number | Payeurs externes settings | Legacy kept it in clinic settings; it is module data (inventory §I). |

No legacy feature is dropped: inventory §I items are either built here or have a home above.

## 2. Roles and permissions

### Roles (decision #23)

| Key | Label | Default permissions |
|---|---|---|
| `admin` | Administrateur | every core permission, every module permission |
| `counselor` | Conseillère | `professionals.view` (later: clients, demandes, matching, rendez-vous) |
| `admin_assistant` | Adjointe administrative | `professionals.view`, `settings.view` (later: facturation) |
| `provider` | Professionnel | none in core |

The migration inserts the two roles and moves any remaining `staff` user to `admin_assistant` (none on staging). It then removes `staff` and its `role_permissions`. `users.view` is no longer a default for non-admins. Labels shown in the app come from i18n (`roles.<key>`), with `roles.name` as fallback.

### Permissions

New core permission: **`settings.bank_manage`** — see and change the clinic's bank details (admin only).

| Section | URL | Visible with | Editable with |
|---|---|---|---|
| Identité légale | `/parametres/identite` | `settings.view` | `settings.manage` |
| Fiscalité | `/parametres/fiscalite` | `settings.view` | `settings.manage` |
| Signataire | `/parametres/signataire` | `settings.view` | `settings.manage` |
| Coordonnées bancaires | `/parametres/banque` | `settings.bank_manage` | `settings.bank_manage` |
| Région | `/parametres/region` | `settings.view` | `settings.manage` |
| Confidentialité | `/parametres/confidentialite` | `settings.view` | `settings.manage` |
| Utilisateurs et accès | `/parametres/utilisateurs` | `users.view` | `users.manage` |
| Modules | `/parametres/modules` | `modules.manage` | `modules.manage` |
| Journal d'audit | `/parametres/journal` | `audit.view` | — |

Decision #19 still holds: « Paramètres » appears when at least one section is visible. With the defaults, the adjointe sees the clinic sections read-only and the conseillère sees no Paramètres.

## 3. Data model

Six migrations, each with its pgTAP file written first. `000_invariants` must stay green. Types are regenerated after each migration.

### 3.1 `core_roles_split`

Described in §2. It also updates `seed.sql`: `staff@mana.test` is replaced by `conseillere@mana.test` (counselor) and `adjointe@mana.test` (admin_assistant).

### 3.2 `core_organization_profile`

New nullable columns on `organizations`. Each has a column-level `update` grant; the existing `organizations_update` policy requires `settings.manage`. All are audited by the existing trigger.

| Group | Columns | Database check |
|---|---|---|
| Identité | `legal_name`, `neq`, `address_line1`, `address_line2`, `city`, `province`, `postal_code`, `country` (default `CA`), `phone`, `email`, `website` | NEQ `^\d{10}$`; province ∈ 13 Canadian codes; postal code `^[A-Z]\d[A-Z] \d[A-Z]\d$` (stored normalised); website starts with `https://`; email has one `@` |
| Fiscalité | `gst_number`, `qst_number` | `^\d{9}RT\d{4}$`, `^\d{10}TQ\d{4}$` |
| Signataire | `signatory_name`, `signatory_title` | non-blank when set |
| Confidentialité | `privacy_officer_name`, `privacy_officer_email`, `privacy_policy_url`, `record_retention_years` | retention 1–50 |

`name` stays the display name (« nom commercial »). Every org member can read these values, providers included, because they appear on contracts and invoices.

### 3.3 `core_tax_rates`

```
tax_rates(id uuid pk, org_id, tax text check in ('gst','qst'), rate numeric(7,6) check (0 <= rate < 1),
          effective_from date not null, effective_to date null check (effective_to > effective_from),
          created_at, created_by)
exclude using gist (org_id with =, tax with =, daterange(effective_from, effective_to, '[)') with &&)
```

- **Reads:** every org member (`select` + RLS on org). `public.tax_rate_on(p_tax text, p_date date)` (security invoker, stable) gives Facturation « the rate on that date ». Invoices will still store the applied rate.
- **Writes**, through RPCs only, with `settings.manage`:
  - `add_tax_rate(p_tax, p_rate, p_effective_from)` closes the open rate on that date. It refuses a start date that is not after the open rate's start.
  - `delete_tax_rate(p_id)` only accepts a rate that is not yet in force, and reopens the previous one.
- **Defaults:** a trigger on `organizations` insert seeds GST 5 % from 2008-01-01 and QST 9.975 % from 2013-01-01. The migration seeds the existing orgs (`on conflict do nothing`).
- **Extension and audit:** needs `btree_gist` (schema `extensions`). The table is audited.

### 3.4 `core_bank_details` (first use of ADR 0004's encrypted private tables)

- **Key:** a Vault secret `pii_encryption_key` (32 random bytes), created by the migration if absent. `private.pii_key()`, `private.encrypt_pii(text) → bytea` and `private.decrypt_pii(bytea) → text` use pgcrypto (`pgp_sym_encrypt`, AES-256). They are not granted to any client role. Vault's root key lives outside the database, so a dump alone does not reveal the data.
- **Table:** `organization_bank_details(org_id pk, institution_number text, transit_number text, account_number bytea, account_last4 text, etransfer_email text, updated_at, updated_by)`.
  - Only the account number is encrypted. Institution and transit numbers are not personal data and are needed for display.
  - No client privilege at all, as for `org_secrets`.
  - Audited with `account_number` redacted.
- **RPCs** (`settings.bank_manage`, own org):
  - `get_bank_details()` returns the masked view (`••••1234`);
  - `reveal_bank_account_number()` returns the full number **and writes an audit row with action `read`**;
  - `set_bank_details(institution, transit, account, etransfer_email)` validates `^\d{3}$`, `^\d{5}$`, `^\d{7,12}$`.
- **Audit change:** `audit_log.action` gains the value `read`. Widening a check constraint is additive.

Phase 4 reuses the same helpers for professionals' SIN and bank accounts. The audit trigger redacts every bank value (account, last 4 digits, institution, transit, Interac email). The journal shows that the bank details changed, but the values are only readable through the `settings.bank_manage` RPCs. (Changed after the Task 2.17 review: `audit.view` can be granted to non-admins by override.)

### 3.5 `core_user_admin`

- **`list_org_users()`** (`users.view`, security definer): profile, role, status, `last_sign_in_at` (from `auth.users`) and override count for the caller's org.
- **Writes** (`users.manage`, target in the same org):
  - `set_user_role(p_user_id, p_role)`;
  - `set_user_status(p_user_id, p_status)`;
  - `set_permission_override(p_user_id, p_key, p_granted)`;
  - `clear_permission_override(p_user_id, p_key)`;
  - `clear_permission_overrides(p_user_id)` (« Rétablir les permissions du rôle », decision #39): removes all of the user's overrides in one call and returns how many. A non-admin manager is refused if any revoke is on a permission they lack.
- **Guards**, enforced in the database with French `P0001` messages:
  - nobody changes their own role or status;
  - the `provider` role can be neither given nor removed here, since the Professionnels module owns it;
  - no overrides on an admin, who already has every permission;
  - a constraint trigger keeps **at least one active admin** per org, checked when an admin row changes or an admin profile is disabled.
- **Disabling:** a disabled user loses data access on their next request (`has_permission` and `get_my_access` already check `status`). Signing out their open sessions needs the Auth admin API; it comes with the Phase 3 invitation function.

### 3.6 `core_audit_viewer`

- **RPC:** `list_audit_entries(p_table, p_actor, p_from, p_to, p_before_id, p_limit)` (`audit.view`, security definer). It returns entries newest first, using keyset pagination on `id`, and joins the actor's display name.
- **Scope:** it never returns other orgs' rows, nor rows without `org_id`.

## 4. Frontend

### 4.1 Visual foundation (decision #26)

- **Fonts:** Raleway self-hosted through `@fontsource-variable/raleway`, bundled by Vite (decision #25). The Google Fonts links and Inter are removed from `index.html`. Raleway draws old-style figures by default, so `lining-nums` applies everywhere and `tabular-nums` applies in tables, amounts and inputs.
- **Colour tokens** (CSS variables on `:root`, mapped in `tailwind.config`; the legacy sage palette goes):

  | Token | Value | Use |
  |---|---|---|
  | wine | `#9B1B3C` | primary actions |
  | charcoal | `#4D4D4F` | text |
  | teal | `#249D95` | accents, success icons |
  | dark teal | `#1B7A73` | teal text, for contrast |
  | mint | `#E2F1EB` | calm surfaces |
  | off-white | `#F8F8F9` | page background |
  | red | `#B42318` | destructive actions |

  The destructive red is distinct from the wine, so « Supprimer » never looks like « Enregistrer ». Text contrast meets WCAG AA.
- **Shell:** left sidebar (wordmark, role-filtered nav from manifests) and a user menu (name, « Mon compte », « Se déconnecter »). Below `md` the sidebar becomes a sheet.
- **Kit** (in `src/shared`):
  - `PageHeader`;
  - `SettingsCard` (title, description, read-only badge, save footer);
  - `FormField` (label/help/error wiring for react-hook-form + Zod);
  - `Table` (shadcn);
  - `EmptyState`;
  - `MaskedValue`;
  - a `useUnsavedChanges` guard.

### 4.2 Settings

- **Section ids and URLs:** `SettingsSection` gains a **`path`** (French URL segment) next to `id` (English, used for error scopes and React keys). Both must be unique across core and modules (unit test). Decision #24.
- **Section pages:** each one is a stack of `SettingsCard`s.
  - Each card has its own form, Zod schema (shared with the DB rules) and « Enregistrer » button.
  - On success, a toast and the access/organization queries are invalidated. On error, the message goes through `moduleErrorMessage`.
  - Without the edit permission, the same cards render disabled, with « Lecture seule ».
- **Unsaved changes:** the app uses `BrowserRouter`, so React Router's `useBlocker` is not available. A card with unsaved changes registers itself with `SettingsLayout`, which then confirms before switching section; `beforeunload` covers closing the tab. Moving to a data router was rejected for now: it would touch the deliberate auth flows (decisions #9–17).
- **Fiscalité:** the numbers, then a rate history per tax with « Nouveau taux à partir du… » and « Supprimer » on future rates only.
- **Banque:** masked values, « Afficher » (logged) and « Modifier ».
- **Région:** the timezone is chosen from the Canadian zones, with « Autre… » searching the full list. Saving calls `setClinicTimezone()` through the access reload. Locale and currency stay read-only (fr-CA, CAD) until a second one exists.
- **Utilisateurs:** a table (nom, courriel, rôle, statut, dernière connexion). Clicking a row opens a sheet with:
  - the role;
  - enable/disable (confirm dialog);
  - permission overrides grouped by module, each with three states: « Selon le rôle » / « Accordée » / « Retirée », with the role default shown.

  A read-only tab shows the role × permission matrix.
- **Journal:** filters (table, person, period), « Charger plus », and expandable rows showing before → after. Field names come from `audit.fields.<table>.<column>` in i18n; a technical name is the fallback.

### 4.3 Mon compte (`/mon-compte`, every signed-in user)

- **Nom affiché:** uses the existing column grant.
- **Courriel:** `updateUser({ email })`. Both addresses must confirm (double confirm), which also closes the open staging check (plan Task 1.21 step 10).
- **Mot de passe:** `updateUser({ password })`. When Auth answers that reauthentication is needed, the page sends the code (`reauthenticate()`, French template « Votre code de vérification ») and asks for it.
- **« Se déconnecter de tous les appareils »:** `signOut({ scope: 'global' })`, then the usual sign-out path (decision #13 anticipated it).

## 5. Error handling

- Every write goes through an RPC or a column grant checked by RLS. The UI hiding a control is never the protection.
- Database checks repeat the Zod rules. A bypassed client gets a French `P0001` message, never a raw constraint name: RPCs validate before writing, and constraint errors on direct column updates are mapped in `moduleErrorMessage`'s allow-list.
- Each section stays inside its own `RouteBoundary`, so a crash in one section never takes down Paramètres.

## 6. Testing

- **pgTAP:**
  - grants and RLS for each new table;
  - every RPC: permission refusal (`42501`), other-org refusal, validation messages;
  - tax-rate overlap and closing;
  - encryption round-trip and the `read` audit row;
  - every user-admin guard (self, provider, admin overrides, last admin);
  - the role split defaults.
- **Vitest:**
  - each section page: rendering by permission (editable / read-only / hidden), validation, save success and error;
  - users sheet three-state overrides;
  - audit pagination;
  - Mon compte reauthentication path;
  - settings `path` uniqueness;
  - the unsaved-changes guard.
- **In the browser:** walkthrough with the four local accounts (admin, conseillère, adjointe, professionnel) at `http://localhost:5173`, including a full Mailpit round-trip for email and password change.
- **Process:** each batch goes through subagent-driven development with spec review and quality review (with live probes), as in Phase 1.

## 7. Risks and open points

- **Concurrent edits** of the same card by two admins: last write wins. The audit log shows both. Acceptable for a clinic of this size.
- **`last_sign_in_at`** is read from `auth.users` inside a security-definer RPC. If Supabase restricts that read in future, the column disappears from the table and nothing else changes.
- **The encryption key is per database,** not per org. Multi-clinic would still be safe (RLS plus RPC org checks); a per-org key can come later without changing the RPCs.
- **Staging after merge:** CD applies the six migrations. Jonathan's admin account keeps working, since `admin` is unchanged.

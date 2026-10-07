# Phase 2 — Core Settings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development in this session) to implement this plan task-by-task.

**Goal:** Give the clinic its settings: identity, tax (numbers and dated rates), signatory, encrypted bank details, region, Loi 25; plus user administration, an audit viewer, « Mon compte », and the brand visual foundation the following modules build on.

**Architecture:** [Design](2026-10-07-phase-2-core-settings-design.md).
- **Data:** typed columns on `organizations` (column grants + RLS), a dated `tax_rates` table, and an encrypted `organization_bank_details` table (pgcrypto, key in Vault, ADR 0004).
- **Writes:** every write that needs checks goes through a `public` RPC that checks its permission first.
- **Frontend:** the settings sections register in `coreSettingsSections` with an English `id` and a French `path`. Each section is a stack of `SettingsCard` forms (react-hook-form + Zod) whose queries live in `api.ts` files called through hooks.

**Tech Stack:** React 19 · Vite 6 · TypeScript strict · React Router 6.30 (`BrowserRouter`) · TanStack Query 5 · Tailwind 3 + shadcn/ui · Zod 4 · react-hook-form + @hookform/resolvers · Sonner · Vitest + Testing Library · Supabase (Postgres 17, Auth, Vault, pgcrypto, btree_gist) · pgTAP.

---

## Ground rules for the executor

- **Where:** work in the worktree `/Users/jonathanharvey/Documents/Claude Projects/Clinique-Mana/.claude/worktrees/clinique-mana-architecture-477a6b`, on branch `feat/phase-2-core-settings`.
- **Read first:** `CLAUDE.md`, `docs/standards/database-conventions.md` and the design above.
- **Approvals:** nothing in this plan pushes, opens a PR or touches staging. Merging to `main` deploys the migrations to staging (CD), so pushing and the PR need Jonathan's explicit go-ahead in chat.
- **Docker:** needed for the local stack. Run `open -a OrbStack`, then `npm run db:start`. The local stack uses ports 553xx; never touch PS Hub's 543xx stack.
- **Migration names:** `$(date -u +%Y%m%d%H%M%S)_<name>.sql`, with seconds ≠ `00` (re-run `date` if needed). Each new file must sort after the previous one.
- **After every migration:**
  ```bash
  npm run db:reset && npm run db:test && npm run db:types
  ```
  `db:reset` re-applies `seed.sql`.
- **Before every commit:**
  ```bash
  npm run typecheck && npm run lint && npm run lint:supabase && npm run test:run
  ```
- **Commits:** Conventional Commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Error codes in SQL:**
  - `42501`: permission refused;
  - `22023`: invalid technical argument (unknown key);
  - `P0001` with a **French** message: anything the user can cause and should read.
  - The UI shows `P0001` messages as is (`moduleErrorMessage`).
- **Detail level:** the infrastructure and one representative page (Identité) are given in full. The other pages follow the same pattern with the fields, schemas and tests listed. Reproduce the pattern exactly; do not invent a new one.

## Conventions used throughout

```ts
// Query keys: one factory per domain, mutations invalidate `all`.
export const organizationKeys = { all: ['organization'] as const, profile: () => [...organizationKeys.all, 'profile'] as const }
```

```sql
-- RPC skeleton (copy the Phase 1 style in 20261007140741_core_module_settings_secrets.sql)
create function public.some_rpc(p_x text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('settings.manage') then
    raise exception 'Permission refusée : settings.manage' using errcode = '42501';
  end if;
  -- …
end;
$$;
revoke all on function public.some_rpc(text) from public, anon, authenticated;
grant execute on function public.some_rpc(text) to authenticated, service_role;
```

**Regex digits (amended after the Task 2.7 review):** in SQL patterns, write `[0-9]`, never `\d`. The local database uses the ICU locale provider, where `\d` also matches Arabic-Indic and fullwidth digits, and staging may differ. Apply this to every SQL block below (tax rates, bank details), and use `[0-9]` in the Zod schemas too, for parity. Blank checks use `btrim(x, E' \t\r\n')`. Name check constraints `<table>_<column>_check`, one per column.

In plpgsql functions that `return query` with `returns table (…)` columns named like table columns, put `#variable_conflict use_column` as the first line of the body **and** qualify every column with its table alias.

pgTAP fixtures reuse the Phase 1 pattern (insert `auth.users`, `organizations`, `profiles`, `user_roles` as `postgres`, then `set local role authenticated` and `select set_config('request.jwt.claims', '{"sub":"…","role":"authenticated"}', true)`). Copy a fixture block from `supabase/tests/database/003_core_module_settings_secrets.test.sql`. Assert privileges with `table_privs_are` / `column_privs_are` / `function_privs_are`. Set `plan(n)` to the final count.

---

# Batch 2a — Foundation

## Task 2.1: Split `staff` into `counselor` and `admin_assistant`

**Files:**
- Create: `supabase/migrations/<ts>_core_roles_split.sql`
- Create: `supabase/tests/database/005_core_roles_split.test.sql`
- Modify: `supabase/tests/database/001_core_access.test.sql`, `002_core_audit.test.sql`, `003_core_module_settings_secrets.test.sql`, `004_professionals_module.test.sql` (fixtures use role `staff`)
- Modify: `supabase/seed.sql`
- Modify: `src/test/contexts.tsx`, `src/core/access/access.ts` (comment), `src/core/access/AccessProvider.test.tsx`, `src/core/access/access.test.ts`, `src/app/AuthenticatedApp.test.tsx` (role `staff` in fixtures)
- Modify: `src/i18n/fr-CA.json` (add `roles`)
- Create: `src/core/access/roles.ts` + `src/core/access/roles.test.ts`

**Step 1: Write the failing pgTAP test** `005_core_roles_split.test.sql`:

```sql
-- Roles split (migration <ts>_core_roles_split.sql): counselor + admin_assistant replace staff.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select results_eq($$ select key, name from public.roles order by key $$,
  $$ values ('admin'::text, 'Administrateur'::text), ('admin_assistant', 'Adjointe administrative'),
            ('counselor', 'Conseillère'), ('provider', 'Professionnel') $$,
  'roles are admin, admin_assistant, counselor, provider');
select ok(not exists (select 1 from public.role_permissions where role = 'staff'), 'staff has no permissions left');
select results_eq($$ select permission_key from public.role_permissions where role = 'counselor' order by 1 $$,
  array['professionals.view'], 'counselor defaults');
select results_eq($$ select permission_key from public.role_permissions where role = 'admin_assistant' order by 1 $$,
  array['professionals.view', 'settings.view'], 'admin_assistant defaults');
select results_eq($$ select module_key from public.permissions where key = 'settings.bank_manage' $$,
  array['core'], 'settings.bank_manage is a core permission');
select results_eq($$ select role from public.role_permissions where permission_key = 'settings.bank_manage' $$,
  array['admin'], 'only admin gets settings.bank_manage by default');
select ok((select count(*) from public.permissions where module_key = 'core')
          = (select count(*) from public.role_permissions rp join public.permissions p on p.key = rp.permission_key
              where rp.role = 'admin' and p.module_key = 'core'),
  'admin has every core permission');

-- Behaviour (fixtures as in 004: org A with the professionals module on)
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('a0000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cons@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adj@a.test',  '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email) values
  ('a0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'cons@a.test'),
  ('a0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A',    'adj@a.test');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant');
insert into public.org_modules (org_id, module_key, enabled) values ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
select ok(private.has_permission('professionals.view'), 'counselor sees professionals');
select ok(not private.has_permission('settings.view'), 'counselor has no settings.view');
select ok(not private.has_permission('users.view'), 'counselor has no users.view');
select is(public.get_my_access() -> 'permissions', '["professionals.view"]'::jsonb, 'counselor access payload');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000012","role":"authenticated"}', true);
select ok(private.has_permission('settings.view'), 'admin_assistant reads settings');
select ok(not private.has_permission('settings.manage'), 'admin_assistant cannot edit settings');
select is(public.get_my_access() -> 'permissions', '["professionals.view", "settings.view"]'::jsonb, 'admin_assistant access payload');

select * from finish();
rollback;
```

**Step 2: Run it and check that it fails.**
Run: `npm run db:test`. Expected: 005 fails (`admin_assistant` unknown, FK violation on `user_roles`).

**Step 3: Write the migration** `<ts>_core_roles_split.sql`:

```sql
-- =============================================================================
-- Roles: « Conseillère » and « Adjointe administrative » replace `staff`
-- =============================================================================
-- Design:  docs/plans/2026-10-07-phase-2-core-settings-design.md §2 (decision #23)
-- Also adds core permission settings.bank_manage (admin), used by core_bank_details.
-- Role defaults for professionals.view live here because the role is new; the
-- permission itself belongs to the professionals module.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:core_roles_split', true);

insert into public.roles (key, name, is_system) values
  ('counselor',       'Conseillère',             true),
  ('admin_assistant', 'Adjointe administrative', true)
on conflict do nothing;

insert into public.permissions (key, module_key, description) values
  ('settings.bank_manage', 'core', 'Voir et modifier les coordonnées bancaires de la clinique')
on conflict do nothing;

insert into public.role_permissions (role, permission_key) values
  ('admin',           'settings.bank_manage'),
  ('counselor',       'professionals.view'),
  ('admin_assistant', 'professionals.view'),
  ('admin_assistant', 'settings.view')
on conflict do nothing;

-- Any remaining staff account becomes an adjointe (none on staging when written).
update public.user_roles set role = 'admin_assistant' where role = 'staff';

delete from public.role_permissions where role = 'staff';
delete from public.roles where key = 'staff';
```

**Step 4: Update the Phase 1 pgTAP fixtures.** In 001–004, replace role `'staff'` with `'admin_assistant'` and rename the comments and labels « staff » to « adjointe ». Then adjust:
- the role list assertion in 001 (line ~117): it now has four roles;
- 004's default-roles assertion: `array['admin', 'admin_assistant', 'counselor']`.

Assertions that relied on staff having `users.view` by default: admin_assistant doesn't. The 001 fixture already revokes it by override, so keep the override (harmless). Re-read each failing assertion before changing it: change the fixture, never weaken what is asserted.

**Step 5: Update the seed.** In `supabase/seed.sql`:
- replace `staff@mana.test` with two accounts:
  - `conseillere@mana.test` (id `22222222-…`, display name « Conseillère Locale », role `counselor`);
  - `adjointe@mana.test` (id `44444444-4444-4444-4444-444444444444`, « Adjointe Locale », role `admin_assistant`);
- update the header comment (four logins, same password).

**Step 6: Run the database checks.**
Run: `npm run db:reset && npm run db:test && npm run db:types`. Expected: all pass, no diff in `database.types.ts` (no schema change).

**Step 7: Add the frontend role labels.**
- `src/i18n/fr-CA.json`: add a top-level block
  ```json
  "roles": { "admin": "Administrateur", "counselor": "Conseillère", "admin_assistant": "Adjointe administrative", "provider": "Professionnel" }
  ```
- `src/core/access/roles.ts`:
  ```ts
  import { t, type TranslationKey } from '@/i18n'

  const KNOWN = ['admin', 'counselor', 'admin_assistant', 'provider'] as const

  /** French label of a role key; the database name (roles.name) for roles added later, else the key. */
  export function roleLabel(key: string, databaseName?: string | null): string {
    if ((KNOWN as readonly string[]).includes(key)) return t(`roles.${key}` as TranslationKey)
    return databaseName ?? key
  }
  ```
- `roles.test.ts`:
  - known keys return the i18n label;
  - unknown keys return the database name, then the key.
- Replace `role: 'staff'` with `'admin_assistant'` in `src/test/contexts.tsx` and the other test fixtures listed above. Update the comment in `access.ts`.

**Step 8: Run the checks, then commit.**
```bash
npm run typecheck && npm run lint && npm run test:run
git add -A && git commit -m "feat(access): conseillère and adjointe administrative roles replace staff"
```

---

## Task 2.2: Brand tokens and self-hosted Raleway

**Files:**
- Modify: `package.json` (add `@fontsource-variable/raleway`), `index.html`, `src/main.tsx`, `tailwind.config.js`, `src/styles/globals.css`, `src/shared/ui/*.tsx` (only where a legacy token disappears)
- Modify: `docs/standards/brand.tokens.md` (mark legacy; point to business context §6 and the new tokens)

**Step 1: Install the font.**
Run: `npm install @fontsource-variable/raleway@5`. Expected: added to `dependencies`, `package-lock.json` updated.

**Step 2: Load it locally.**
- Remove the three Google Fonts `<link>` tags from `index.html`.
- In `src/main.tsx`, add as the first import: `import '@fontsource-variable/raleway'`.

**Step 3: Rewrite the tokens.**
- In `globals.css` `@layer base`, define CSS variables on `:root` with these exact values:
  ```css
  :root {
    --wine: 155 27 60;          /* #9B1B3C primary actions */
    --wine-dark: 130 22 51;     /* #821633 hover */
    --charcoal: 77 77 79;       /* #4D4D4F text */
    --charcoal-soft: 107 107 110; /* #6B6B6E secondary text */
    --teal: 36 157 149;         /* #249D95 accents, success icons */
    --teal-dark: 27 122 115;    /* #1B7A73 teal text (AA on white) */
    --mint: 226 241 235;        /* #E2F1EB calm surfaces */
    --offwhite: 248 248 249;    /* #F8F8F9 page background */
    --line: 229 229 232;        /* #E5E5E8 borders */
    --danger: 180 35 24;        /* #B42318 destructive */
  }
  ```
- Rewrite `tailwind.config.js` `theme.extend.colors` to use `rgb(var(--x) / <alpha-value>)`. The legacy `sage`, `honey` and `wine` scales and cream backgrounds are removed. Keep the semantic names used by the shadcn components:
  - `background` (`DEFAULT` → offwhite), `foreground` (`DEFAULT` → charcoal, `secondary`/`muted` → charcoal-soft);
  - `border` (`DEFAULT` → line), `card` (white + charcoal);
  - `primary` (wine + white), `muted` (offwhite + charcoal-soft);
  - `accent` (mint + teal-dark), `success` (teal-dark), `destructive` (danger + white);
  - `ring` (wine).
- Set `fontFamily.sans` to `['"Raleway Variable"', 'system-ui', 'sans-serif']`.
- In `globals.css`:
  - remove the Inter `font-feature-settings` and add `font-variant-numeric: lining-nums;` on `body`;
  - add a utility `.tabular { font-variant-numeric: lining-nums tabular-nums; }`;
  - change `.focus-ring` to `ring-primary/30`.

**Step 4: Fix references to removed tokens.**
Run: `grep -rn "sage-\|honey-\|wine-\|foreground-muted\|background-secondary\|background-tertiary\|shadow-small" src --include=*.tsx --include=*.ts --include=*.css`. Replace each hit with the semantic token (`text-muted-foreground`, `bg-muted`, `shadow-sm`…). Expected afterwards: no hit.

**Step 5: Check the build and the network.**
```bash
npm run build
```
Expected: success, and `dist/assets` contains `raleway-*.woff2`.
```bash
grep -rn "googleapis\|gstatic" dist/ index.html
```
Expected: no output.

**Step 6: Look at it in the browser.** `preview_start` with `{name}` from `.claude/launch.json`, sign in as `admin@mana.test`. Check:
- the login page and the shell render in Raleway, with charcoal text and a wine primary button;
- no request to `fonts.googleapis.com` (`read_network_requests`).

Take a screenshot.

**Step 7: Run the checks, then commit.**
```bash
npm run typecheck && npm run lint && npm run test:run
git add -A && git commit -m "feat(ui): brand tokens and self-hosted Raleway"
```

---

## Task 2.2b: Apply the Clinique MANA design system

*(Added 2026-10-07 after Jonathan shared the design system; decisions #29–30. Runs after Task 2.3 and before Task 2.4. It supersedes Task 2.2's colours and font. The rest of Task 2.2 stays: the no-Google-request rule, the `--input` idea and the destructive-variant reasoning.)*

**Source of truth:** `docs/design-system/`.
- `README.md`: the handoff. Its rules, tokens, component values and screens are final, at high fidelity.
- `design_system/tokens/*.css`: the tokens.
- `design_system/components/SOURCE.md` and `components/<group>/*.prompt.md`: exact values and props per component.
- `ui_kit/screen-*.jsx`: reference screens. These are references only: never import or copy the JSX, and never load `_ds_bundle.js` in the app.

**Files:**
- `package.json`: remove `@fontsource-variable/raleway`, add `@fontsource-variable/inter`.
- `src/main.tsx`, `src/styles/globals.css`, `tailwind.config.js`.
- Every primitive in `src/shared/ui/`, plus `src/shared/components/` (SettingsCard, PageHeader, EmptyState, FullPageMessage, SaveButton), and `src/core/auth/pages/AuthCard.tsx`.
- Create: `src/shared/ui/status-dot.tsx` (Badge « statut » = 6 px dot + word) and `src/shared/components/StatusIndicator.tsx`, if not covered by Badge.
- Create: `src/assets/logo-header.svg` (copied from `docs/design-system/assets/`), used by AuthCard (26 px) and, in Task 2.4, by the sidebar (22 px).
- Rewrite: `docs/standards/brand.tokens.md` as the short « how the design system maps to Tailwind » page.

**Steps**
1. **Tokens.**
   - Port `tokens/colors.css`, `typography.css`, `spacing.css` and `effects.css` into `globals.css` as CSS variables. Use RGB triplets for colours, so Tailwind's `<alpha-value>` works. Keep the token names of the design system.
   - Map them in `tailwind.config.js` to the shadcn semantic names:
     - `background` = bg, `foreground` = text-body, `muted` = bg-secondary (`muted-foreground` = text-secondary), `border` = border;
     - `input` = border; hover uses border-strong;
     - `primary` = teal-600 (with `hover` / `active`) and `primary-soft`;
     - `ink`;
     - `destructive` = danger;
     - `success` / `warning` / `info` dots;
     - `sidebar` = surface-sidebar.
   - Font sizes `2xs`–`3xl` with their line heights. Radii: `sm` 3, `md` 4, `lg` 6, `xl` 6, `2xl` 8. Shadows: `soft` none, `medium` and `large` as in `effects.css`. Durations and easing as given.
   - Remove the Task 2.2 tokens (offwhite, mint surfaces, wine as an action colour).
2. **Font.** Inter via `@fontsource-variable/inter`, with no Google request (check `dist/` as in Task 2.2). Body: `font-feature-settings: "cv02","cv03","cv04","cv11","ss01"`, 13/18, antialiased. Keep `font-variant-numeric: inherit` on form controls and `.tabular` for figures.
3. **Primitives.** Port the exact values from the handoff « Composants » section and `SOURCE.md`:
   - Button: 32 px, radius 4, the variants including `ink`, and the sizes.
   - Input, Select and Textarea; Label; Checkbox; Switch.
   - Badge (status dot + word; `filled` only for « Urgent »); Avatar; Card; Alert (white with a coloured icon); Tooltip (ink); Skeleton.
   - NavTabs (ink underline); DropdownMenu, Popover and Command; Dialog, AlertDialog and Sheet.
   - Toast (ink background; restyle sonner through its CSS variables, as Task 2.2 did); AuthCard; PageHeader (20/28 600).
   - EmptyState: two lines of text, no icon, no box. Remove the `icon` prop.
   - SettingsCard: Card values (border, radius 6, padding 16, title 14/600, description 12) and no shadow.
4. **Accessibility adjustments (decision #30):**
   - informative secondary text uses `text-secondary` (#6B6B6E), never `text-muted` (#8E8E92);
   - the focus ring is solid teal: `0 0 0 2px #fff, 0 0 0 4px #1E837C` for buttons and controls; fields use a teal border plus a 1 px teal ring, as designed;
   - `FormField` `required`: a teal `*` (`aria-hidden`) plus an `sr-only` « (requis) ». This replaces the visible « (requis) » from the Task 2.3 review.
5. **Tests.** Update the tests whose expectations change (EmptyState without icon, the required marker, toast styling). Never weaken a behavioural assertion.
6. **Browser check.** Login page and Paramètres → Modules at desktop and mobile widths, compared side by side with `docs/design-system/ui_kit` (open `ui_kit/index.html` in the browser pane). Take screenshots.
7. **Commit.** `feat(ui): apply the Clinique MANA design system`.

**Also applies to the later tasks.** Tasks 2.4 and later follow the handoff's screens:
- Task 2.4 shell: SidebarNav 220/56 collapsible, collapsed state persisted, footer with avatar, name, role and sign-out; a 48 px Topbar with breadcrumb and title; ⌘K palette with navigation only (this restores the legacy palette, inventory §D « Shared »). No bell and no help icon until they do something.
- Task 2.5: SettingsNav 200 px with overline groups and a lock icon on read-only sections; read-only sections show the Alert « Lecture seule — Seule l'administration peut modifier ces informations. »
- Forms: max 640, two-column grid with gap 12, Annuler / Enregistrer aligned right.
- Tables: header overline 11 px, rows 40 px, footer with count and pagination.

---

## Task 2.3: Shared UI kit, error mapping, unsaved-changes guard

**Files:**
- Create: `src/shared/ui/table.tsx` (shadcn Table: `Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption`, styled with the tokens, `tabular` on cells)
- Create: `src/shared/ui/form-field.tsx` + `form-field.test.tsx`
- Create: `src/shared/components/PageHeader.tsx`, `SettingsCard.tsx` + `SettingsCard.test.tsx`, `EmptyState.tsx`
- Create: `src/shared/lib/unsaved-changes-context.ts`, `src/shared/components/UnsavedChangesProvider.tsx`, `src/shared/components/GuardedNavLink.tsx` + `UnsavedChangesProvider.test.tsx`
- Create: `src/shared/lib/format.ts` + `format.test.ts`
- Modify: `src/core/modules/errors.ts` + `errors.test.ts`, `src/i18n/fr-CA.json`

**Step 1: `FormField`. Write the test first** (`form-field.test.tsx`):
- the label is associated with the input (`getByLabelText`);
- `help` is linked by `aria-describedby`;
- with `error`, the error text is linked too and `aria-invalid="true"` is set (no `role="alert"`: react-hook-form focuses the first invalid field, whose description reads the error; alerts on every field would announce them all at once);
- `required` adds a **visible** « (requis) » to the label (muted, normal weight), not a bare asterisk: one text for sighted and screen-reader users (WCAG 3.3.2). *(Amended after the Task 2.3 review.)*

Implementation:
```tsx
import { useId, type ReactNode } from 'react'
import { t } from '@/i18n'
import { Label } from './label'

export interface FieldControlProps {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
}

interface FormFieldProps {
  label: string
  help?: string
  error?: string
  required?: boolean
  children: (props: FieldControlProps) => ReactNode
}

/** Label + control + help + error, wired for screen readers. The control is a render prop. */
export function FormField({ label, help, error, required, children }: FormFieldProps) {
  const id = useId()
  const helpId = help ? `${id}-help` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required && <span className="font-normal text-muted-foreground"> {t('common.form.required')}</span>}
      </Label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {help && <p id={helpId} className="text-xs text-muted-foreground">{help}</p>}
      {error && <p id={errorId} className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
```

**Step 2: `SettingsCard`. Write the test first:**
- the title renders as an `h3`;
- with `readOnly`, a « Lecture seule » badge shows, the footer is not rendered, and the `fieldset` is `disabled`;
- otherwise the footer (save button) renders.

Implementation:
```tsx
import type { FormEventHandler, ReactNode } from 'react'
import { t } from '@/i18n'
import { Badge } from '@/shared/ui/badge'

interface SettingsCardProps {
  title: string
  description?: string
  readOnly?: boolean
  onSubmit?: FormEventHandler<HTMLFormElement>
  footer?: ReactNode
  children: ReactNode
}

/** One block of a settings page: its own form, its own save button, read-only without the edit permission. */
export function SettingsCard({ title, description, readOnly, onSubmit, footer, children }: SettingsCardProps) {
  return (
    <form onSubmit={onSubmit} noValidate className="rounded-xl border border-border bg-card shadow-soft">
      <div className="flex items-start justify-between gap-4 p-6 pb-4">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {readOnly && <Badge variant="secondary">{t('common.readOnly')}</Badge>}
      </div>
      <fieldset disabled={readOnly} className="space-y-4 px-6 pb-6">
        {children}
      </fieldset>
      {!readOnly && footer && (
        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-3">{footer}</div>
      )}
    </form>
  )
}
```
`PageHeader({ title, description, actions })` renders an `h2` (inside Paramètres, whose `h1` is « Paramètres ») plus the description and actions. `EmptyState({ icon, title, body, action })` is a centred muted block.

**Step 3: Error mapping.** Extend `moduleErrorMessage`. Tests first in `errors.test.ts`:
- `42501` → `t('common.errors.forbidden')`: the message is now generic, and the `settings.modules.forbidden` key is removed and its usages updated;
- `23514` (check violation) → `t('common.errors.invalidValue')`, **without** Sentry: the client validates first, so this only happens on a bypass;
- `P0001` and the fallback behave as before.

**Step 4: Formatting helpers.** Tests first in `format.test.ts`:
- `formatPhone('+15145551234') === '514 555-1234'`, and `formatPhone(null) === ''`;
- `parsePhone(' (514) 555-1234 ') === '+15145551234'`;
- `parsePhone('1 514 555 1234') === '+15145551234'`;
- `parsePhone('555-1234') === null` (invalid);
- `formatPostalCode('h2x1y4') === 'H2X 1Y4'`;
- `formatRate(0.09975) === '9,975 %'` and `formatRate(0.05) === '5 %'`: French decimal comma, no trailing zeros, via `Intl.NumberFormat('fr-CA', { maximumFractionDigits: 4 })` on `rate * 100` (4 = every digit `numeric(7,6)` stores, so a pre-filled form saved untouched never changes the rate);
- `parseRate('9,975') === 0.09975`: accepts a comma or a dot, returns `null` when invalid, and rounds to 6 decimals.

Implement in `src/shared/lib/format.ts`.

**Step 5: Unsaved-changes guard.**
- **Context** (`unsaved-changes-context.ts`):
  ```ts
  export interface UnsavedChangesValue {
    /** A form reports whether it has unsaved edits; call with false (or unmount) to clear. */
    setDirty: (id: string, dirty: boolean) => void
    /** Runs `proceed` at once when nothing is dirty, else after the user confirms leaving. */
    confirmLeave: (proceed: () => void) => void
  }
  export const UnsavedChangesContext = createContext<UnsavedChangesValue | null>(null)
  /** Registers a form's dirty state for the lifetime of the component. No-op outside a provider. */
  export function useUnsavedChanges(dirty: boolean) { /* useId + useEffect(setDirty) + cleanup setDirty(false) */ }
  export function useConfirmLeave() { /* returns ctx?.confirmLeave ?? ((p) => p()) */ }
  ```
- **Provider** (`UnsavedChangesProvider.tsx`): holds a `Set` of dirty ids in a ref, plus a `beforeunload` listener while the set is non-empty. `confirmLeave` opens an `AlertDialog` with:
  - title `t('common.unsaved.title')`;
  - body `t('common.unsaved.body')`;
  - buttons « Rester » / « Quitter sans enregistrer ».

  Confirming clears the set and runs `proceed`.
- **`GuardedNavLink`:** wraps `NavLink`. Its `onClick` calls `e.preventDefault()` and `confirmLeave(() => navigate(to))` **only** when something is dirty. Plain clicks stay native, so middle-click and cmd-click keep working: let the browser handle them when `e.metaKey || e.ctrlKey || e.button !== 0`.
- **Tests** (`UnsavedChangesProvider.test.tsx`):
  - clean form → the link navigates directly;
  - dirty form → the dialog opens; « Rester » keeps the page, « Quitter » navigates;
  - unmounting the dirty form clears the guard;
  - `beforeunload` is prevented only while dirty.

**Step 6: Add the i18n keys.**
```json
"common": {
  "readOnly": "Lecture seule",
  "save": "Enregistrer",
  "saving": "Enregistrement…",
  "cancel": "Annuler",
  "edit": "Modifier",
  "form": { "required": "(requis)" },
  "errors": {
    "forbidden": "Vous n'avez pas la permission de faire cette modification.",
    "invalidValue": "Une des valeurs saisies n'est pas valide. Vérifiez le formulaire.",
    "generic": "Un imprévu, ça arrive. Réessayez dans un instant."
  },
  "unsaved": {
    "title": "Quitter sans enregistrer ?",
    "body": "Vos modifications seront perdues.",
    "stay": "Rester",
    "leave": "Quitter sans enregistrer"
  }
}
```
Merge them into the existing `common` block.

**Step 7: Run the checks, then commit.**
```bash
npm run typecheck && npm run lint && npm run test:run
git add -A && git commit -m "feat(ui): form field, settings card, table, unsaved-changes guard"
```

---

## Task 2.4: App shell redesign and user menu

**Files:**
- Modify: `src/app/AppShell.tsx`, `src/app/AuthenticatedApp.tsx`, `src/app/AuthenticatedApp.test.tsx`
- Create: `src/app/AppShell.test.tsx`
- Modify: `src/i18n/fr-CA.json` (`nav.account`, `nav.openMenu`, `nav.userMenu`)

**Behaviour:**
- **Desktop (`md` and up):**
  - a fixed 240 px sidebar on a white card with a right border;
  - a wordmark at the top: « Clinique MANA » in wine, semibold (from `org_name`, falling back to `app.name`);
  - the nav items use `GuardedNavLink`; the active item gets `bg-accent text-primary font-medium`, others `text-muted-foreground hover:bg-muted`;
  - at the bottom, a user menu button (`DropdownMenu`) showing the display name and role label (`roleLabel`), with two entries: « Mon compte » → `/mon-compte` (through `confirmLeave`) and « Se déconnecter » (the existing sign-out logic, `disabled` while signing out).
- **Mobile (below `md`):** a top bar with the wordmark and a menu button (`aria-label={t('nav.openMenu')}`) that opens a `Sheet` (side left) with the same nav and user entries. Selecting an item closes the sheet.
- **Wrapping and content:** `AuthenticatedApp` wraps `AppShell` in `UnsavedChangesProvider`. The skip link and `main#contenu` stay as they are.

**Tests** (`AppShell.test.tsx`, with `renderWithContexts`):
- the nav items render as links to their paths;
- the user menu shows the display name and « Adjointe administrative » for role `admin_assistant`;
- « Mon compte » navigates to `/mon-compte`;
- « Se déconnecter » calls `signOut` once and disables itself;
- the mobile menu button opens the sheet, which contains the nav.

Keep the existing `AuthenticatedApp` tests green.

**Commit:** `feat(shell): branded sidebar, user menu and mobile navigation`.

---

## Task 2.5: Settings sections with French paths

**Files:**
- Modify: `src/core/modules/types.ts`, `src/core/settings/SettingsLayout.tsx` + test, `src/core/settings/sections.ts`, `src/app/AuthenticatedApp.tsx`
- Create: `src/core/settings/sections.test.ts`
- Modify: `src/i18n/fr-CA.json` (`settings.sections.*`)

**Step 1: Extend the type.** Add a `path` field to `SettingsSection`:
```ts
export interface SettingsSection {
  /** Stable English identifier, unique across core and modules (error scopes, React keys). */
  id: string
  /** French URL segment under /parametres, unique across core and modules: 'identite'. */
  path: string
  // … unchanged
}
```

**Step 2: Write the failing tests.**
- `sections.test.ts`:
  - ids and paths of `coreSettingsSections` plus every module's sections in `ALL_MODULES` are unique;
  - paths match `^[a-z][a-z0-9-]*$`.

  It imports `ALL_MODULES` from `@/app/modules`. Core may not import app (ESLint), so put this test in `src/app/settings-sections.test.ts` instead.
- `SettingsLayout.test.tsx`: links and routes use `path` (`/parametres/identite`); the error scope still uses `id`.

**Step 3: Implement.**
- `SettingsLayout`:
  - `to={`${basePath}/${s.path}`}`, `<Route path={s.path}>`, `<Navigate to={first.path}>`;
  - nav links become `GuardedNavLink`;
  - restyle with the new tokens: active item `bg-accent text-primary`.
- Register in `sections.ts` the full core list, in this order. Pages not built yet point to a temporary `lazy(() => import('./pages/ComingSoonSection'))`, which renders `EmptyState` with « Bientôt disponible ». Remove it in Task 2.18.

  | id | path | labelKey | icon (lucide) | permission | group |
  |---|---|---|---|---|---|
  | identity | identite | settings.sections.identity | Building2 | settings.view | clinique |
  | tax | fiscalite | settings.sections.tax | Percent | settings.view | clinique |
  | signatory | signataire | settings.sections.signatory | PenLine | settings.view | clinique |
  | bank | banque | settings.sections.bank | Landmark | settings.bank_manage | clinique |
  | region | region | settings.sections.region | Globe | settings.view | clinique |
  | privacy | confidentialite | settings.sections.privacy | ShieldCheck | settings.view | clinique |
  | users | utilisateurs | settings.sections.users | Users | users.view | plateforme |
  | modules | modules | settings.sections.modules | Blocks | modules.manage | plateforme |
  | audit | journal | settings.sections.audit | ScrollText | audit.view | plateforme |

  Labels: Identité légale, Fiscalité, Signataire, Coordonnées bancaires, Région, Confidentialité, Utilisateurs et accès, Modules, Journal d'audit.
- Update `AuthenticatedApp.test.tsx` for decision #19:
  - an `admin_assistant` (`settings.view`) now **sees** Paramètres;
  - a `counselor` does not, and `/parametres` shows « Accès refusé ».

**Step 4: Run the checks, then commit.** `feat(settings): French section paths and the Phase 2 section registry`.

---

## Task 2.6: « Mon compte »

**Files:**
- Modify: `src/core/auth/auth-context.ts`, `src/core/auth/AuthProvider.tsx` + test, `src/i18n/fr-CA.json`
- Create: `src/core/account/api.ts` + `api.test.ts`, `src/core/account/hooks.ts`, `src/core/account/pages/AccountPage.tsx` + test
- Modify: `src/app/AuthenticatedApp.tsx` (route `mon-compte`)

Read decisions #9–17 and ADR 0006 first: sign-out and recovery behaviours must not change.

**Step 1: Extend the auth context.** Write the tests first (`AuthProvider.test.tsx`, mocking `supabase.auth` as the existing tests do).
- `updatePassword(password, nonce?)` passes `nonce` to `updateUser` when given. The recovery behaviour is unchanged.
- `sendReauthenticationCode(): Promise<AuthErrorCode | null>` calls `supabase.auth.reauthenticate()`.
- `updateEmail(email): Promise<AuthErrorCode | null>` calls `updateUser({ email }, { emailRedirectTo: `${window.location.origin}/mon-compte` })`.
  New codes, mapped in `toCode` with their i18n messages:
  - `email_exists` → « Ce courriel est déjà utilisé par un autre compte. »
  - `email_address_invalid` → `invalid_email`
  - `reauthentication_not_valid` → `invalid_code`, « Code invalide ou expiré. »
- `signOutEverywhere(): Promise<AuthErrorCode | null>` calls `supabase.auth.signOut({ scope: 'global' })`.
  - **On error:** return the code and keep the local session, so the user can retry or knows it failed.
  - **On success:** run the same cleanup as `signOut` (`setSignedOutHere(true)`, recovery marker cleared, session null). Factor the shared cleanup into a local function; do not duplicate it.

**Step 2: Account API.** `src/core/account/api.ts`:
```ts
/** Renames the caller's own profile (column grant on display_name + self-update policy). */
export async function updateDisplayName(userId: string, displayName: string): Promise<void>
```
Test it with a mocked client:
- it trims the name;
- it filters on `user_id`;
- it throws on error;
- it throws when no row was updated (`.select('user_id')` returns `[]`, i.e. disabled or wrong user).

`hooks.ts`: `useUpdateDisplayName()` invalidates `accessKeys.all`, since the name comes from `get_my_access`.

**Step 3: The page.** `/mon-compte`, under `RequireAuth` and outside Paramètres, so every role reaches it. Title « Mon compte ». Four `SettingsCard`s:
1. **Nom affiché:** one field (required, 1–80 characters), « Enregistrer ».
2. **Courriel:** the current email shown, a new-email field and « Changer le courriel ». On success, show the notice « Confirmez le changement dans les deux boîtes : l'ancienne et la nouvelle adresse. »
3. **Mot de passe:** new and confirm fields; reuse the Zod rules of `ResetPasswordPage` by moving them to `src/core/auth/password-schema.ts`. Flow:
   - submit → `updatePassword`;
   - if it returns `reauthentication_needed`: call `sendReauthenticationCode()`, show a « Code reçu par courriel » field and submit again with `nonce`;
   - success → toast « Mot de passe mis à jour. » and the form resets.
4. **Sessions:** « Se déconnecter de tous les appareils », behind a confirm dialog; an error is shown inline.

**Tests** (`AccountPage.test.tsx`):
- each card's validation;
- the reauthentication path: first call returns `reauthentication_needed` → the code field appears → the second call receives the nonce;
- the email notice;
- the global sign-out confirm, and its error;
- the name save invalidates access.

**Step 4: Check in the browser** (local, Mailpit at `http://127.0.0.1:55324`):
- change the name, then the email of `adjointe@mana.test`: both addresses get mail; after confirming both, the profile email updates;
- change the password: the session is fresh, so no code is asked.

Write down what you saw for the final report.

**Commit:** `feat(account): Mon compte (name, email, password, sign out everywhere)`.

---

# Batch 2b — Clinique

## Task 2.7: Organization profile columns

**Files:**
- Create: `supabase/migrations/<ts>_core_organization_profile.sql`
- Create: `supabase/tests/database/006_core_organization_profile.test.sql`

**Step 1: Write the failing pgTAP test.** Fixtures: org A with an admin, an adjointe (`admin_assistant`) and a provider; org B with an admin. Assert:
- `column_privs_are` for `authenticated` on each new column: `SELECT, UPDATE` for the editable ones, and `SELECT` only for `country`;
- as admin A:
  - `update public.organizations set legal_name = '9999-9999 Québec inc.', neq = '1234567890', gst_number = '123456789RT0001', qst_number = '1234567890TQ0001', postal_code = 'H2X 1Y4', province = 'QC', phone = '+15145551234', website = 'https://cliniquemana.com', record_retention_years = 7` succeeds and the values are read back;
  - one `throws_ok(…, '23514')` for each check: `neq = '123'`, `gst_number = '123456789'`, `qst_number = '1234567890RT0001'`, `postal_code = 'h2x1y4'`, `province = 'XX'`, `phone = '514-555-1234'`, `website = 'http://x.ca'`, `email = 'pas-un-courriel'`, `record_retention_years = 0`, `legal_name = '   '`;
- an audit row exists for the update, with `changed_fields ? 'neq'`;
- as the adjointe: the same update affects 0 rows (`update … returning 1` gives an empty result) and the values are unchanged; she can read them;
- as the provider: can read `legal_name` (it appears on contracts);
- as admin B: cannot see or update org A (0 rows).

**Step 2: Run it and check that it fails** (columns missing).

**Step 3: Write the migration.**

```sql
-- =============================================================================
-- Organization profile: identity, tax numbers, signatory, Loi 25
-- =============================================================================
-- Design:  docs/plans/2026-10-07-phase-2-core-settings-design.md §3.2
-- Every value printed on a document comes from here (design §3 rule).
-- Readable by every member of the org (contracts and invoices show them);
-- writable with settings.manage through the existing organizations_update
-- policy and the column grant below. Audited by organizations_audit.
-- Checks mirror the Zod schemas in src/core/settings/organization/schemas.ts.
-- =============================================================================

alter table public.organizations
  add column legal_name text,
  add column neq text,
  add column address_line1 text,
  add column address_line2 text,
  add column city text,
  add column province text,
  add column postal_code text,
  add column country text not null default 'CA',
  add column phone text,
  add column email text,
  add column website text,
  add column gst_number text,
  add column qst_number text,
  add column signatory_name text,
  add column signatory_title text,
  add column privacy_officer_name text,
  add column privacy_officer_email text,
  add column privacy_policy_url text,
  add column record_retention_years smallint;

alter table public.organizations
  add constraint organizations_text_not_blank check (
        (legal_name is null or length(trim(legal_name)) between 1 and 200)
    and (address_line1 is null or length(trim(address_line1)) between 1 and 200)
    and (address_line2 is null or length(trim(address_line2)) between 1 and 200)
    and (city is null or length(trim(city)) between 1 and 100)
    and (signatory_name is null or length(trim(signatory_name)) between 1 and 120)
    and (signatory_title is null or length(trim(signatory_title)) between 1 and 120)
    and (privacy_officer_name is null or length(trim(privacy_officer_name)) between 1 and 120)
  ),
  add constraint organizations_neq_check check (neq ~ '^\d{10}$'),
  add constraint organizations_province_check check (
    province in ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')),
  add constraint organizations_postal_code_check check (postal_code ~ '^[A-Z]\d[A-Z] \d[A-Z]\d$'),
  add constraint organizations_country_check check (country ~ '^[A-Z]{2}$'),
  add constraint organizations_phone_check check (phone ~ '^\+1\d{10}$'),
  add constraint organizations_email_check check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add constraint organizations_privacy_officer_email_check check (privacy_officer_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add constraint organizations_website_check check (website ~ '^https://\S+$'),
  add constraint organizations_privacy_policy_url_check check (privacy_policy_url ~ '^https://\S+$'),
  add constraint organizations_gst_number_check check (gst_number ~ '^\d{9}RT\d{4}$'),
  add constraint organizations_qst_number_check check (qst_number ~ '^\d{10}TQ\d{4}$'),
  add constraint organizations_record_retention_years_check check (record_retention_years between 1 and 50);

-- country stays 'CA' (no UI): the clinic is in Quebec and every check above is Canadian.
grant update (
  legal_name, neq, address_line1, address_line2, city, province, postal_code,
  phone, email, website, gst_number, qst_number, signatory_name, signatory_title,
  privacy_officer_name, privacy_officer_email, privacy_policy_url, record_retention_years
) on public.organizations to authenticated;
```

**Step 4: Run the database checks**, then commit.
Run: `npm run db:reset && npm run db:test && npm run db:types`. Expected: all green; `database.types.ts` gains the columns.
Commit: `feat(db): organization identity, tax numbers, signatory and Loi 25 columns`.

---

## Task 2.8: Organization API, hooks and schemas

**Files:**
- Create: `src/core/settings/organization/api.ts` + `api.test.ts`
- Create: `src/core/settings/organization/hooks.ts`
- Create: `src/core/settings/organization/schemas.ts` + `schemas.test.ts`

**Step 1: Schemas, test first.** Each card has a Zod schema that **normalises**:
- trims;
- turns empty strings into `null`;
- uppercases postal codes and inserts their space;
- strips spaces and dashes from NEQ/TPS/TVQ and uppercases them;
- turns the phone into E.164 via `parsePhone`.

Each schema also **validates** with the same patterns as the SQL checks, and gives French messages:

| Field | Message |
|---|---|
| NEQ | « Le NEQ compte 10 chiffres. » |
| TPS | « Format attendu : 123456789 RT 0001. » |
| TVQ | « Format attendu : 1234567890 TQ 0001. » |
| Code postal | « Code postal invalide (ex. : H2X 1Y4). » |
| Téléphone | « Numéro à 10 chiffres. » |
| Site web / politique | « L'adresse doit commencer par https:// » |
| Courriel | « Courriel invalide. » |
| Durée | « Entre 1 et 50 ans. » |

```ts
import { z } from 'zod'
import { parsePhone } from '@/shared/lib/format'

const optionalText = (max: number) =>
  z.string().trim().max(max).transform((v) => (v === '' ? null : v))
const optionalPattern = (re: RegExp, message: string, normalize: (v: string) => string = (v) => v) =>
  z.string().transform((v) => normalize(v.trim())).pipe(z.union([z.literal(''), z.string().regex(re, { error: message })]))
    .transform((v) => (v === '' ? null : v))

export const identitySchema = z.object({
  name: z.string().trim().min(1, { error: 'Le nom est requis.' }).max(200),
  legal_name: optionalText(200),
  neq: optionalPattern(/^\d{10}$/, 'Le NEQ compte 10 chiffres.', (v) => v.replace(/[\s-]/g, '')),
  address_line1: optionalText(200),
  address_line2: optionalText(200),
  city: optionalText(100),
  province: z.enum(['AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT']).nullable(),
  postal_code: optionalPattern(/^[A-Z]\d[A-Z] \d[A-Z]\d$/, 'Code postal invalide (ex. : H2X 1Y4).',
    (v) => { const c = v.replace(/\s/g, '').toUpperCase(); return c.length === 6 ? `${c.slice(0, 3)} ${c.slice(3)}` : c }),
  phone: z.string().transform((v, ctx) => {
    if (v.trim() === '') return null
    const parsed = parsePhone(v)
    if (!parsed) { ctx.addIssue({ code: 'custom', message: 'Numéro à 10 chiffres.' }); return z.NEVER }
    return parsed
  }),
  email: optionalPattern(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Courriel invalide.'),
  website: optionalPattern(/^https:\/\/\S+$/, "L'adresse doit commencer par https://"),
})
export const taxNumbersSchema = z.object({ gst_number: /* \d{9}RT\d{4} */, qst_number: /* \d{10}TQ\d{4} */ })
export const signatorySchema = z.object({ signatory_name: optionalText(120), signatory_title: optionalText(120) })
export const privacySchema = z.object({
  privacy_officer_name: optionalText(120),
  privacy_officer_email: optionalPattern(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Courriel invalide.'),
  privacy_policy_url: optionalPattern(/^https:\/\/\S+$/, "L'adresse doit commencer par https://"),
  record_retention_years: /* '' → null; integer 1–50, message « Entre 1 et 50 ans. » */,
})
export const regionSchema = z.object({ timezone: z.string().min(1) })
```

Each schema's tests check:
- normalisation, e.g. `' 1234 567 890 '` → `'1234567890'` and `'h2x1y4'` → `'H2X 1Y4'`;
- that empty strings become `null`;
- each error message.

The forms work on string values. Each schema has a matching `toFormValues(org)` that turns `null` into `''`; put it in the same file and test it.

**Amendments from the Task 2.7 review:**
- `province`: `toFormValues` turns `null` into `''`, so the schema must accept `''` and turn it into `null` (`z.preprocess((v) => (v === '' ? null : v), z.enum([...]).nullable())`). Test the « no province » case.
- `website` and `privacy_policy_url`: lowercase the scheme, and prepend `https://` when it is missing (`www.cliniquemana.com` becomes `https://www.cliniquemana.com`). Test it.
- `src/core/modules/errors.ts`: also send `23514` to Sentry, still showing the generic message. By design it only happens after a bypass or a Zod/SQL parity bug, and we want to hear about either.

**Step 2: API, test first.**
```ts
export const ORGANIZATION_COLUMNS = 'id, name, timezone, default_locale, currency, legal_name, neq, address_line1, address_line2, city, province, postal_code, country, phone, email, website, gst_number, qst_number, signatory_name, signatory_title, privacy_officer_name, privacy_officer_email, privacy_policy_url, record_retention_years, updated_at' as const
export type Organization = Pick<Tables<'organizations'>, /* the columns above */>
export type OrganizationUpdate = Partial<Omit<Organization, 'id' | 'default_locale' | 'currency' | 'country' | 'updated_at'>>

/** The caller's organization (RLS returns only their own). */
export async function fetchOrganization(): Promise<Organization>
/** Updates the caller's org. RLS needs settings.manage: zero rows updated means refused, so it throws a 42501-shaped error. */
export async function updateOrganization(id: string, patch: OrganizationUpdate): Promise<Organization>
```
`updateOrganization` uses `.update(patch).eq('id', id).select(ORGANIZATION_COLUMNS)`. When the result is empty it throws `{ code: '42501', message: 'no row updated' }`, which `moduleErrorMessage` turns into the permission text.

Tests:
- the select columns;
- `.single()` on fetch;
- update throws on error;
- update throws a 42501-shaped error on an empty result.

**Step 3: Hooks** (`hooks.ts`):
```ts
export const organizationKeys = { all: ['organization'] as const, current: () => [...organizationKeys.all, 'current'] as const }
export function useOrganization() { return useQuery({ queryKey: organizationKeys.current(), queryFn: fetchOrganization }) }
/** Saves one settings card. Invalidates the organization and, for name/timezone, the access payload (shell name, clinic timezone). */
export function useUpdateOrganization(successMessage: string) { /* toast.success / toast.error(moduleErrorMessage(e, t('common.errors.generic'))) */ }
```

**Step 4: Run the checks, then commit.** `feat(settings): organization API, hooks and validation schemas`.

---

## Task 2.9: Section « Identité légale » (reference page)

**Files:**
- Create: `src/core/settings/pages/IdentitySettingsPage.tsx` + `IdentitySettingsPage.test.tsx`
- Create: `src/core/settings/components/OrganizationCard.tsx`, the shared card wrapper for organization forms
- Modify: `src/core/settings/sections.ts` (component), `src/i18n/fr-CA.json` (`settings.identity.*`)

**Step 1: Write the failing page test:**
- loading state, then the form filled from `fetchOrganization` (mocked like `ModulesSettingsPage.test.tsx`);
- with `settings.manage`: editing NEQ to `'123'` and saving shows « Le NEQ compte 10 chiffres. » and does not call `updateOrganization`;
- a valid save calls `updateOrganization('o1', { …normalised values… })` with **only this card's fields**, then shows the toast « Identité enregistrée. »;
- `P0001`/`23514` errors show the mapped message;
- with `settings.view` only: the « Lecture seule » badge shows, the inputs are disabled and there is no « Enregistrer » button;
- dirty state: after typing, the guard reports dirty (assert through `UnsavedChangesProvider`: clicking a `GuardedNavLink` opens the dialog).

**Step 2: The reusable card wrapper.**
```tsx
// src/core/settings/components/OrganizationCard.tsx
interface OrganizationCardProps<S extends z.ZodTypeAny> {
  title: string
  description?: string
  schema: S
  /** Form values (strings) from the organization row. */
  defaults: z.input<S>
  /** Organization columns this card may write. */
  successMessage: string
  children: (form: UseFormReturn<z.input<S>, unknown, z.output<S>>) => ReactNode
}
```
Behaviour:
- **Form:** `useForm({ resolver: zodResolver(schema), values: defaults })`. `values` (not `defaultValues`) re-syncs after a save, once the refetch lands.
- **Permissions:** `readOnly = !can('settings.manage')`.
- **Dirty guard:** `useUnsavedChanges(form.formState.isDirty)`.
- **Submit:** `useUpdateOrganization(successMessage).mutate({ id, patch: parsedValues })`.
- **Footer:** `SaveButton pending={mutation.isPending} disabled={!isDirty}` (Task 2.3), and pass `pending` to `SettingsCard` as well. *(Amended after the Task 2.3 review.)*
- **Guard:** call `useUnsavedChanges(isDirty && !readOnly)`. After a successful save, call `form.reset(toFormValues(saved))`, so the guard disarms even when the saved values normalise to what was already stored.

**Step 3: The page.**
- `PageHeader`: title « Identité légale », description « Ces renseignements figurent sur les contrats, reçus et factures. »
- **Card « Clinique »:**
  - Nom affiché (`name`, required; help « Le nom qui apparaît dans l'application. »);
  - Raison sociale (`legal_name`);
  - NEQ (`neq`, `inputMode="numeric"`, help « Numéro d'entreprise du Québec, 10 chiffres. »).
- **Card « Adresse du siège social »:**
  - Adresse (`address_line1`, `autoComplete="address-line1"`);
  - Complément (`address_line2`);
  - Ville (`city`);
  - Province (`Select` of the 13 codes with French names, default QC);
  - Code postal (`postal_code`, `autoComplete="postal-code"`, uppercase on blur).
- **Card « Coordonnées »:**
  - Téléphone (`phone`, shown with `formatPhone`, `type="tel"`);
  - Courriel (`email`, `type="email"`);
  - Site web (`website`, placeholder `https://`).
- **Layout:** one column on mobile; on `md` and up, short fields go two per row (`grid gap-4 md:grid-cols-2`).
- **Tab order:** follows reading order (CLAUDE.md §10).

**Step 4: Run the checks.** Then look at the page in the browser as admin and as adjointe, at desktop and mobile widths (`resize_window`). Take a screenshot.

**Step 5: Commit.** `feat(settings): Identité légale section`.

---

## Task 2.10: Sections « Signataire », « Région », « Confidentialité »

Same pattern as Task 2.9: one page each, `OrganizationCard`, and tests mirroring 2.9 (read-only, validation, save payload, toast).

| Page | Cards and fields |
|---|---|
| `SignatorySettingsPage` | « Représentant de la clinique »: Nom (`signatory_name`), Titre (`signatory_title`, placeholder « Directrice »). Note under the card: « L'image de la signature s'ajoutera avec les contrats. » |
| `RegionSettingsPage` | « Fuseau horaire »: a `Select` with the Canadian zones (`America/Toronto` « Heure de l'Est (Montréal, Toronto) », `America/Halifax`, `America/St_Johns`, `America/Winnipeg`, `America/Regina`, `America/Edmonton`, `America/Vancouver`). « Autre fuseau… » opens a searchable `Command` list built from `Intl.supportedValuesOf('timeZone')`. Read-only lines « Langue : Français (Canada) », « Devise : dollar canadien (CAD) ». Saving invalidates access, so `setClinicTimezone` runs with the new zone. Test: after a save, `accessKeys.all` is invalidated. |
| `PrivacySettingsPage` | « Responsable de la protection des renseignements personnels »: Nom, Courriel. « Politique et conservation »: URL de la politique, Durée de conservation des dossiers administratifs (années; help « Les notes cliniques ne sont pas conservées dans l'application. »). |

The database rejects an unknown timezone with `22023`. The UI only offers valid zones, so a `22023` here is unexpected and goes to Sentry (fallback message).

**Commit:** `feat(settings): Signataire, Région and Confidentialité sections`.

---

## Task 2.11: Dated tax rates

**Files:**
- Create: `supabase/migrations/<ts>_core_tax_rates.sql`
- Create: `supabase/tests/database/007_core_tax_rates.test.sql`

**Step 1: Write the failing pgTAP test.** Fixtures: org A (admin, adjointe, provider) and org B (admin); both orgs are created **after** the migration, so the seeding trigger runs. Assert:
- **Seeding:** each org has exactly `gst 0.05 from 2008-01-01` and `qst 0.09975 from 2013-01-01`, both open (`effective_to is null`).
- **Privileges:** `table_privs_are` → `authenticated` has `SELECT` only; `anon` has none.
- **`tax_rate_on`** (as admin A): `('qst', '2020-06-01')` = 0.09975; `('gst', '2007-12-31')` is null.
- **`add_tax_rate`** (as admin A):
  - `('qst', 0.1, <clinic today + 30>)` returns an id; the old QST row gets `effective_to = <that date>`; `tax_rate_on` before and after the date returns the old and new rates;
  - `('qst', 0.11, '2013-01-01')` throws `P0001` (« Le nouveau taux doit commencer après le … »);
  - `('hst', 0.13, …)` throws `22023`;
  - a rate of `1.2` throws `P0001`.
- **`delete_tax_rate`:**
  - on the future QST row succeeds, and the previous row is open again;
  - on the GST row in force throws `P0001` (« Un taux déjà en vigueur ne peut pas être supprimé. »);
  - on a closed row throws `P0001`.
- **Exclusion constraint** (as `postgres`): inserting an overlapping QST row directly throws `23P01`.
- **Other roles:** adjointe calling `add_tax_rate` throws `42501`, but she reads the rates (2 rows); the provider reads the rates.
- **Isolation:** admin B sees only org B's rows.
- **Audit:** `tax_rates` changes are audited (insert rows, plus an update for the closing).

**Step 2: Run it and check that it fails.**

**Step 3: Write the migration.**

```sql
-- =============================================================================
-- Dated tax rates (TPS / TVQ)
-- =============================================================================
-- Design:  docs/plans/2026-10-07-phase-2-core-settings-design.md §3.3
-- A rate applies on [effective_from, effective_to). The open rate has
-- effective_to = null. Periods never overlap (exclusion constraint). Facturation
-- asks tax_rate_on(tax, date) and stores the applied rate on each invoice.
-- Writes only through add_tax_rate / delete_tax_rate (settings.manage).
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

create table public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  tax text not null check (tax in ('gst', 'qst')),
  rate numeric(7, 6) not null check (rate >= 0 and rate < 1),
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  constraint tax_rates_period_check check (effective_to is null or effective_to > effective_from),
  constraint tax_rates_no_overlap exclude using gist (
    org_id with =,
    tax with =,
    daterange(effective_from, effective_to, '[)') with &&
  )
);
-- The exclusion index leads with org_id, but keep a plain one for the FK invariant and lookups.
create index tax_rates_org_id_idx on public.tax_rates (org_id, tax, effective_from);
create index tax_rates_created_by_idx on public.tax_rates (created_by);

revoke all on public.tax_rates from anon, authenticated;
grant select on public.tax_rates to authenticated;
alter table public.tax_rates enable row level security;

-- Every member of the org: invoices and receipts need the rates.
create policy tax_rates_select on public.tax_rates
  for select to authenticated
  using (org_id = (select private.current_user_org_id()));

create trigger tax_rates_audit
  after insert or update or delete on public.tax_rates
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- Defaults for every organization: GST 5 % (2008) and QST 9.975 % (2013)
-- -----------------------------------------------------------------------------
create function private.seed_org_tax_rates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.tax_rates (org_id, tax, rate, effective_from) values
    (new.id, 'gst', 0.05,    date '2008-01-01'),
    (new.id, 'qst', 0.09975, date '2013-01-01');
  return null;
end;
$$;

create trigger organizations_seed_tax_rates
  after insert on public.organizations
  for each row execute function private.seed_org_tax_rates();

revoke all on function private.seed_org_tax_rates() from public, anon, authenticated, service_role;

insert into public.tax_rates (org_id, tax, rate, effective_from)
select o.id, d.tax, d.rate, d.effective_from
  from public.organizations o
 cross join (values ('gst', 0.05, date '2008-01-01'), ('qst', 0.09975, date '2013-01-01')) as d(tax, rate, effective_from)
 where not exists (select 1 from public.tax_rates t where t.org_id = o.id and t.tax = d.tax);

-- -----------------------------------------------------------------------------
-- Clinic-local date (the session runs in UTC)
-- -----------------------------------------------------------------------------
create function private.clinic_today()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (pg_catalog.now() at time zone o.timezone)::date
    from public.organizations o
   where o.id = private.current_user_org_id()
$$;
revoke all on function private.clinic_today() from public, anon;
grant execute on function private.clinic_today() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------
-- The rate in force on a date for the caller's org (null when none).
create function public.tax_rate_on(p_tax text, p_date date)
returns numeric
language sql
stable
set search_path = ''
as $$
  select t.rate
    from public.tax_rates t
   where t.org_id = (select private.current_user_org_id())
     and t.tax = p_tax
     and t.effective_from <= p_date
     and (t.effective_to is null or p_date < t.effective_to)
$$;

-- Appends a rate: closes the open one on p_effective_from.
create function public.add_tax_rate(p_tax text, p_rate numeric, p_effective_from date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_open public.tax_rates;
  v_id uuid;
begin
  if not private.has_permission('settings.manage') then
    raise exception 'Permission refusée : settings.manage' using errcode = '42501';
  end if;
  if p_tax is null or p_tax not in ('gst', 'qst') then
    raise exception 'Taxe inconnue : %', p_tax using errcode = '22023';
  end if;
  if p_rate is null or p_rate < 0 or p_rate >= 1 then
    raise exception 'Le taux doit être compris entre 0 et 100 %%.' using errcode = 'P0001';
  end if;
  if p_effective_from is null then
    raise exception 'La date d''entrée en vigueur est requise.' using errcode = 'P0001';
  end if;

  -- One writer per org at a time.
  perform 1 from public.organizations o where o.id = v_org for update;

  select * into v_open
    from public.tax_rates t
   where t.org_id = v_org and t.tax = p_tax and t.effective_to is null;

  if v_open.id is not null then
    if p_effective_from <= v_open.effective_from then
      raise exception 'Le nouveau taux doit commencer après le %.', pg_catalog.to_char(v_open.effective_from, 'YYYY-MM-DD')
        using errcode = 'P0001';
    end if;
    update public.tax_rates t set effective_to = p_effective_from where t.id = v_open.id;
  end if;

  insert into public.tax_rates (org_id, tax, rate, effective_from, created_by)
  values (v_org, p_tax, round(p_rate, 6), p_effective_from, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Removes the last rate if it is not in force yet, and reopens the previous one.
create function public.delete_tax_rate(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_row public.tax_rates;
begin
  if not private.has_permission('settings.manage') then
    raise exception 'Permission refusée : settings.manage' using errcode = '42501';
  end if;

  perform 1 from public.organizations o where o.id = v_org for update;

  select * into v_row from public.tax_rates t where t.id = p_id and t.org_id = v_org;
  if v_row.id is null then
    raise exception 'Taux introuvable.' using errcode = 'P0001';
  end if;
  if v_row.effective_to is not null then
    raise exception 'Seul le dernier taux peut être supprimé.' using errcode = 'P0001';
  end if;
  if v_row.effective_from <= private.clinic_today() then
    raise exception 'Un taux déjà en vigueur ne peut pas être supprimé.' using errcode = 'P0001';
  end if;

  delete from public.tax_rates t where t.id = v_row.id;
  update public.tax_rates t
     set effective_to = null
   where t.org_id = v_org and t.tax = v_row.tax and t.effective_to = v_row.effective_from;
end;
$$;

revoke all on function
  public.tax_rate_on(text, date),
  public.add_tax_rate(text, numeric, date),
  public.delete_tax_rate(uuid)
from public, anon, authenticated;
grant execute on function
  public.tax_rate_on(text, date),
  public.add_tax_rate(text, numeric, date),
  public.delete_tax_rate(uuid)
to authenticated, service_role;
```

**Step 4: Run the database checks** (`db:reset`, `db:test`, `db:types`). Every organization insert now also writes two `tax_rates` rows and their audit rows. If a Phase 1 test counts `audit_log` rows without filtering on `table_name`, add the filter; never change the expected number to make it pass. Check that the seed org got its two rates: `psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -c "select tax, rate, effective_from from public.tax_rates"`.

**Step 5: Commit.** `feat(db): dated TPS/TVQ rates with add/delete RPCs`.

---

## Task 2.12: Section « Fiscalité »

**Files:**
- Create: `src/core/settings/tax/api.ts` + test, `src/core/settings/tax/hooks.ts`
- Create: `src/core/settings/pages/TaxSettingsPage.tsx` + test
- Modify: `sections.ts`, `fr-CA.json` (`settings.tax.*`)

**API:**
- `fetchTaxRates(): Promise<TaxRate[]>`: select from `tax_rates`, ordered by `tax`, then `effective_from desc`;
- `addTaxRate(tax, rate, effectiveFrom)`;
- `deleteTaxRate(id)`.

`taxRateKeys` with `all`. Both mutations invalidate `taxRateKeys.all` and toast.

**Page:**
1. **Card « Numéros d'inscription »** (`OrganizationCard` + `taxNumbersSchema`): « Numéro de TPS » (help « 9 chiffres + RT + 4 chiffres ») and « Numéro de TVQ » (« 10 chiffres + TQ + 4 chiffres »). Values display grouped: `123456789 RT 0001`.
2. **Two cards « TPS » and « TVQ »** (not forms, so not `OrganizationCard`), each with:
   - a `Table` with columns Taux (`formatRate`), En vigueur du, Jusqu'au (`formatDateOnlyShort`, or « — » when open) and Statut (badge « En vigueur » / « À venir » / « Terminé », computed against `getClinicDateString()`);
   - « Supprimer » on the « À venir » row only, behind a confirm dialog;
   - with `settings.manage`, a « Nouveau taux » button that opens a `Dialog` form:
     - Taux en % (`parseRate`; error « Taux invalide. »);
     - À partir du (`<input type="date">`; error « Date requise. »);
     - help: « Le taux actuel se terminera la veille de cette date. »
     - when the date is before today (clinic time), show an inline warning before saving: « Cette date est passée : le nouveau taux s'appliquera aussi aux calculs faits depuis cette date. Les factures déjà émises gardent leur taux. » The RPC accepts back-dating on purpose, to allow corrections. *(Added after the Task 2.11 review.)*

**Tests:**
- the rates table renders the statuses for today = `2026-10-07`: mock `getClinicDateString`, or set the system time with `vi.setSystemTime`;
- the add dialog sends `0.1` for « 10 » and the date string unchanged (no timezone conversion: it is a date-only field);
- a `P0001` error is shown in the dialog;
- read-only: no « Nouveau taux » and no « Supprimer »;
- the delete confirm calls `deleteTaxRate`.

**Commit:** `feat(settings): Fiscalité section (TPS/TVQ numbers and dated rates)`.

---

## Task 2.13: Encrypted bank details

**Files:**
- Create: `supabase/migrations/<ts>_core_bank_details.sql`
- Create: `supabase/tests/database/008_core_bank_details.test.sql`
- Modify: `docs/standards/database-conventions.md` §8 (how to encrypt a column), `docs/adr/0004-secrets-in-vault.md` (status: encrypted private tables built)

**Step 1: Write the failing pgTAP test.** Fixtures: org A admin, org A adjointe given an override `settings.manage = true` (to prove `settings.manage` is not enough), org B admin. Assert:
- **Privileges:** `table_privs_are(… organization_bank_details …, 'authenticated', array[]::text[])`; `function_privs_are` → nobody but the owner can execute `private.encrypt_pii`, `private.decrypt_pii`, `private.pii_key`; the three RPCs are executable by `authenticated`.
- **Key:** a Vault secret named `pii_encryption_key` exists, and the migration is idempotent about it (`select count(*) = 1`).
- **`set_bank_details`** (as admin A):
  - `('815', '30000', '1234567', 'paiement@clinique.test')` succeeds;
  - `get_bank_details()` returns `815 | 30000 | 4567 | paiement@clinique.test`;
  - the stored `account_number` is `bytea` and does not contain `1234567` (checked as postgres with `position('1234567' in encode(account_number, 'escape')) = 0`);
  - `reveal_bank_account_number()` returns `'1234567'` and adds one `audit_log` row with `action = 'read'` and `source = 'rpc:reveal_bank_account_number'`;
  - the audit rows for the table show `account_number` as `"[redacted]"`;
  - `set_bank_details('815', '30001', null, null)` keeps the account (reveal still `'1234567'`), changes the transit and clears the Interac email;
  - validation, each `P0001`: institution `'81'`, transit `'3000'`, account `'123'`, email `'x'`;
  - `set_bank_details('815','30000', null, null)` on an org **without** a row throws `P0001` (« Le numéro de compte est requis. »). Test this as admin B.
- **Adjointe** (with the `settings.manage` override): all three RPCs throw `42501`.
- **Isolation:** admin B's `get_bank_details()` returns no row for org A's data.
- **Audit constraint:** `audit_log` accepts `action = 'read'` and still rejects `'select'` (as postgres, `throws_ok(…, '23514')`).

**Step 2: Run it and check that it fails.**

**Step 3: Write the migration.**

```sql
-- =============================================================================
-- Clinic bank details, account number encrypted (ADR 0004)
-- =============================================================================
-- Design:  docs/plans/2026-10-07-phase-2-core-settings-design.md §3.4
-- * The data key is a Vault secret (pii_encryption_key). Vault encrypts it with
--   a root key kept outside the database, so a dump alone does not reveal it.
-- * private.encrypt_pii / decrypt_pii (pgcrypto, AES-256) are callable only by
--   SECURITY DEFINER functions (their owner); no client role can execute them.
-- * Clients have no privilege on the table: they use get_bank_details (masked),
--   reveal_bank_account_number (audited read) and set_bank_details.
-- * Phase 4 reuses the helpers for professionals' SIN and bank accounts.
-- =============================================================================

-- Reads of sensitive data are audited too.
alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('insert', 'update', 'delete', 'read'));

-- -----------------------------------------------------------------------------
-- Encryption key and helpers
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets s where s.name = 'pii_encryption_key') then
    perform vault.create_secret(
      pg_catalog.encode(extensions.gen_random_bytes(32), 'base64'),
      'pii_encryption_key',
      'Clé de chiffrement des renseignements sensibles (ADR 0004). Ne jamais supprimer ni remplacer.'
    );
  end if;
end;
$$;

create function private.pii_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ds.decrypted_secret from vault.decrypted_secrets ds where ds.name = 'pii_encryption_key'
$$;

create function private.encrypt_pii(p_value text)
returns bytea
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if p_value is null then
    return null;
  end if;
  v_key := private.pii_key();
  if v_key is null then
    raise exception 'Clé de chiffrement introuvable' using errcode = '55000';
  end if;
  return extensions.pgp_sym_encrypt(p_value, v_key, 'cipher-algo=aes256');
end;
$$;

create function private.decrypt_pii(p_value bytea)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if p_value is null then
    return null;
  end if;
  v_key := private.pii_key();
  if v_key is null then
    raise exception 'Clé de chiffrement introuvable' using errcode = '55000';
  end if;
  return extensions.pgp_sym_decrypt(p_value, v_key);
end;
$$;

revoke all on function private.pii_key(), private.encrypt_pii(text), private.decrypt_pii(bytea)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Table
-- -----------------------------------------------------------------------------
create table public.organization_bank_details (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  institution_number text not null check (institution_number ~ '^\d{3}$'),
  transit_number text not null check (transit_number ~ '^\d{5}$'),
  account_number bytea not null,
  account_last4 text not null check (account_last4 ~ '^\d{4}$'),
  etransfer_email text check (etransfer_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id) on delete set null
);
create index organization_bank_details_updated_by_idx on public.organization_bank_details (updated_by);

create trigger organization_bank_details_set_updated_at
  before update on public.organization_bank_details
  for each row execute function private.set_updated_at();

create trigger organization_bank_details_audit
  after insert or update or delete on public.organization_bank_details
  for each row execute function private.audit_trigger('account_number');

revoke all on public.organization_bank_details from anon, authenticated;
alter table public.organization_bank_details enable row level security;
-- No policy and no grant on purpose: only the SECURITY DEFINER RPCs below touch it.

-- -----------------------------------------------------------------------------
-- RPCs (settings.bank_manage)
-- -----------------------------------------------------------------------------
create function public.get_bank_details()
returns table (
  institution_number text,
  transit_number text,
  account_last4 text,
  etransfer_email text,
  updated_at timestamptz,
  updated_by_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.has_permission('settings.bank_manage') then
    raise exception 'Permission refusée : settings.bank_manage' using errcode = '42501';
  end if;
  return query
    select b.institution_number, b.transit_number, b.account_last4, b.etransfer_email, b.updated_at, p.display_name
      from public.organization_bank_details b
      left join public.profiles p on p.user_id = b.updated_by
     where b.org_id = private.current_user_org_id();
end;
$$;

create function public.reveal_bank_account_number()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_value bytea;
begin
  if not private.has_permission('settings.bank_manage') then
    raise exception 'Permission refusée : settings.bank_manage' using errcode = '42501';
  end if;

  select b.account_number into v_value from public.organization_bank_details b where b.org_id = v_org;
  if v_value is null then
    return null;
  end if;

  insert into public.audit_log (org_id, table_name, record_id, action, changed_fields, actor_id, actor_role, source)
  values (
    v_org, 'organization_bank_details', v_org::text, 'read',
    jsonb_build_object('fields', jsonb_build_array('account_number')),
    auth.uid(), private.current_user_role(), 'rpc:reveal_bank_account_number'
  );
  return private.decrypt_pii(v_value);
end;
$$;

-- p_account_number null keeps the stored account (editing the transit alone).
create function public.set_bank_details(
  p_institution_number text,
  p_transit_number text,
  p_account_number text,
  p_etransfer_email text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_account text := nullif(pg_catalog.regexp_replace(coalesce(p_account_number, ''), '\D', '', 'g'), '');
  v_email text := nullif(trim(coalesce(p_etransfer_email, '')), '');
begin
  if not private.has_permission('settings.bank_manage') then
    raise exception 'Permission refusée : settings.bank_manage' using errcode = '42501';
  end if;
  if p_institution_number is null or p_institution_number !~ '^\d{3}$' then
    raise exception 'Le numéro d''institution compte 3 chiffres.' using errcode = 'P0001';
  end if;
  if p_transit_number is null or p_transit_number !~ '^\d{5}$' then
    raise exception 'Le numéro de transit compte 5 chiffres.' using errcode = 'P0001';
  end if;
  if v_account is not null and v_account !~ '^\d{7,12}$' then
    raise exception 'Le numéro de compte compte de 7 à 12 chiffres.' using errcode = 'P0001';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Courriel Interac invalide.' using errcode = 'P0001';
  end if;

  if v_account is null then
    update public.organization_bank_details b
       set institution_number = p_institution_number,
           transit_number = p_transit_number,
           etransfer_email = v_email,
           updated_by = auth.uid()
     where b.org_id = v_org;
    if not found then
      raise exception 'Le numéro de compte est requis.' using errcode = 'P0001';
    end if;
  else
    insert into public.organization_bank_details
      (org_id, institution_number, transit_number, account_number, account_last4, etransfer_email, updated_by)
    values
      (v_org, p_institution_number, p_transit_number, private.encrypt_pii(v_account), right(v_account, 4), v_email, auth.uid())
    on conflict (org_id) do update
      set institution_number = excluded.institution_number,
          transit_number = excluded.transit_number,
          account_number = excluded.account_number,
          account_last4 = excluded.account_last4,
          etransfer_email = excluded.etransfer_email,
          updated_by = excluded.updated_by;
  end if;
end;
$$;

revoke all on function
  public.get_bank_details(),
  public.reveal_bank_account_number(),
  public.set_bank_details(text, text, text, text)
from public, anon, authenticated;
grant execute on function
  public.get_bank_details(),
  public.reveal_bank_account_number(),
  public.set_bank_details(text, text, text, text)
to authenticated;
```

`service_role` gets no grant: nothing server-side needs these yet.

**Step 4: Run the database checks** (`db:reset`, `db:test`, `db:types`). Make sure `000_invariants` is green: the table has `org_id` and an audit trigger, and its FK is indexed (it is the primary key).

**Step 5: Document.**
- `database-conventions.md` §8: add « Encrypted columns », a 6-line recipe:
  - a `bytea` column;
  - `private.encrypt_pii` in a SECURITY DEFINER RPC;
  - a `*_last4` or masked column for display;
  - a reveal RPC that writes an `audit_log` row with action `read`;
  - the audit trigger redacts the column;
  - never grant the helpers.
- ADR 0004: status line « encrypted private tables built (`organization_bank_details`, Phase 2) ».

**Step 6: Commit.** `feat(db): encrypted clinic bank details with audited reveal`.

---

## Task 2.14: Section « Coordonnées bancaires »

**Files:**
- Create: `src/core/settings/bank/api.ts` + test, `hooks.ts`
- Create: `src/core/settings/pages/BankSettingsPage.tsx` + test
- Modify: `sections.ts`, `fr-CA.json` (`settings.bank.*`)

**API:**
- `fetchBankDetails()`: `rpc('get_bank_details')`, returning the first row or `null`;
- `revealAccountNumber()`;
- `setBankDetails({ institution, transit, account | null, etransferEmail | null })`.

`bankKeys`. **Never cache the revealed number in React Query:** keep it in component state, and clear it on unmount and after 60 s.

**Page** (visible only with `settings.bank_manage`, so no read-only mode):
- PageHeader description: « Visibles par les administrateurs seulement. Chaque affichage du numéro de compte est inscrit au journal d'audit. »
- **Empty state:** when nothing is stored, show « Aucune coordonnée bancaire » with a « Ajouter » button that opens the form.
- **Display mode:**
  - Institution `815` · Transit `30000` · Compte `••••4567`, with an « Afficher » button. Clicking it calls reveal, shows the full number and the button becomes « Masquer »;
  - Courriel Interac;
  - « Modifié le … par … » (`formatClinicDateTime`).
- **Edit form** (`SettingsCard`):
  - Institution (3 digits) and Transit (5 digits);
  - Numéro de compte, empty with placeholder « Inchangé » when a row exists, required otherwise; `autoComplete="off"`;
  - Courriel Interac.

  Zod mirrors the SQL rules and messages.

**Tests:**
- masked display;
- reveal calls the RPC once, shows the number, and « Masquer » hides it;
- the number is not in the query cache (`queryClient.getQueryCache().findAll()` holds no query with the value);
- the edit form with an empty account sends `account: null`;
- validation messages;
- the empty state.

**Commit:** `feat(settings): Coordonnées bancaires section (masked, audited reveal)`.

---

# Batch 2c — Utilisateurs et accès

## Task 2.15: User administration RPCs and guards

**Files:**
- Create: `supabase/migrations/<ts>_core_user_admin.sql`
- Create: `supabase/tests/database/009_core_user_admin.test.sql`

**Step 1: Write the failing pgTAP test.** Fixtures:
- **Org A:**
  - admin A1 and admin A2;
  - counselor C;
  - adjointe D, with an override `users.manage = true` and an override `users.view = true` (a non-admin manager);
  - provider P;
  - a profile E with no role.
- **Org B:** admin B.

Assert:
- **Privileges:** the five RPCs are executable by `authenticated`, not `anon`.
- **`list_org_users()`:**
  - as A1: 6 rows for org A (none from B), with `role`, `role_name` (`Conseillère`…), `last_sign_in_at` (null in fixtures) and `override_count = 2` for D;
  - as C: throws `42501`.
- **`set_user_role`** (as A1):
  - C → `admin_assistant` succeeds; it is audited (`user_roles` update);
  - E (no role) → `counselor` succeeds (insert);
  - itself → `P0001` « Vous ne pouvez pas modifier votre propre compte ici. Passez par « Mon compte ». » (the same message for every RPC acting on oneself);
  - P → `counselor` → `P0001` (provider owned by Professionnels);
  - C → `provider` → `P0001`;
  - unknown role → `22023`;
  - admin B's user → `P0001` « Utilisateur introuvable. »;
  - C → `admin` clears C's overrides.
- **As D** (non-admin with `users.manage`):
  - A2 → `counselor` → `P0001` « Seul un administrateur peut modifier un administrateur. »;
  - C → `admin` → same message;
  - granting C `settings.manage` (which D lacks) → `P0001` « Vous ne pouvez pas accorder une permission que vous n'avez pas. »;
  - granting C `professionals.view` (D has it): needs the professionals module enabled in the fixture.
- **`set_user_status`:**
  - A1 disables C: C's `get_my_access()` now has empty permissions;
  - A1 disables itself → `P0001`;
  - A1 disables A2 succeeds (A1 is still active);
  - **last admin:** as postgres, set A2 disabled, then make A1 → `counselor` directly (`update public.user_roles …`) → `P0001` « La clinique doit garder au moins un administrateur actif. »; deleting A1's `user_roles` row → same; disabling A1's profile → same;
  - re-enable A2 through the RPC succeeds.
- **`set_permission_override` / `clear_permission_override`:**
  - A1 grants C `audit.view` → `private.has_permission('audit.view')` is true as C; clear → false;
  - override on A2 (admin) → `P0001` « Un administrateur a déjà toutes les permissions. »;
  - unknown permission → `22023`;
  - on itself → `P0001`.
- **Audit:** the override changes are audited, with `created_by` set.

**Step 2: Run it and check that it fails.**

**Step 3: Write the migration.**

```sql
-- =============================================================================
-- User administration: list, role, status, permission overrides
-- =============================================================================
-- Design:  docs/plans/2026-10-07-phase-2-core-settings-design.md §3.5 (decision #28)
-- Guards (French P0001 messages):
-- * nobody changes their own role, status or overrides;
-- * the provider role is owned by the Professionnels module;
-- * only an admin changes an admin, or makes someone admin;
-- * a non-admin manager only grants permissions they hold;
-- * no overrides on admins (they already hold every permission);
-- * every org keeps at least one active admin (trigger, any write path).
-- Invitations come after Phase 3 (decision #22).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- At least one active admin per org
-- -----------------------------------------------------------------------------
create function private.ensure_active_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- profiles: only an admin's status change or deletion matters.
  if tg_table_name = 'profiles'
     and not exists (select 1 from public.user_roles r where r.user_id = old.user_id and r.role = 'admin') then
    return null;
  end if;

  if not exists (
    select 1
      from public.user_roles r
      join public.profiles p on p.user_id = r.user_id
     where r.org_id = old.org_id
       and r.role = 'admin'
       and p.status = 'active'
  ) then
    raise exception 'La clinique doit garder au moins un administrateur actif.' using errcode = 'P0001';
  end if;
  return null;
end;
$$;

-- AFTER ROW triggers run at the end of the statement, so they see its final state.
create trigger user_roles_keep_active_admin
  after update of role or delete on public.user_roles
  for each row when (old.role = 'admin')
  execute function private.ensure_active_admin();

create trigger profiles_keep_active_admin
  after update of status or delete on public.profiles
  for each row when (old.status = 'active')
  execute function private.ensure_active_admin();

revoke all on function private.ensure_active_admin() from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Shared checks for the write RPCs
-- -----------------------------------------------------------------------------
-- Raises unless the caller may manage the target; returns the target's current role (may be null).
create function private.assert_can_manage_user(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if not private.has_permission('users.manage') then
    raise exception 'Permission refusée : users.manage' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Vous ne pouvez pas modifier votre propre compte ici. Passez par « Mon compte ».' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.profiles p
     where p.user_id = p_user_id and p.org_id = private.current_user_org_id()
  ) then
    raise exception 'Utilisateur introuvable.' using errcode = 'P0001';
  end if;
  select r.role into v_role from public.user_roles r where r.user_id = p_user_id;
  if v_role = 'admin' and not private.has_role('admin') then
    raise exception 'Seul un administrateur peut modifier un administrateur.' using errcode = 'P0001';
  end if;
  return v_role;
end;
$$;

revoke all on function private.assert_can_manage_user(uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------
create function public.list_org_users()
returns table (
  user_id uuid,
  display_name text,
  email text,
  status text,
  role text,
  role_name text,
  last_sign_in_at timestamptz,
  override_count int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.has_permission('users.view') then
    raise exception 'Permission refusée : users.view' using errcode = '42501';
  end if;
  return query
    select p.user_id, p.display_name, p.email, p.status, r.role, ro.name, u.last_sign_in_at,
           (select count(*)::int from public.user_permission_overrides o where o.user_id = p.user_id)
      from public.profiles p
      left join public.user_roles r on r.user_id = p.user_id
      left join public.roles ro on ro.key = r.role
      left join auth.users u on u.id = p.user_id
     where p.org_id = private.current_user_org_id()
     order by (p.status = 'disabled'), pg_catalog.lower(p.display_name);
end;
$$;

create function public.set_user_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text := private.assert_can_manage_user(p_user_id);
begin
  if p_role is null or not exists (select 1 from public.roles ro where ro.key = p_role) then
    raise exception 'Rôle inconnu : %', p_role using errcode = '22023';
  end if;
  if p_role = 'provider' or v_current = 'provider' then
    raise exception 'Le rôle Professionnel se gère dans le module Professionnels.' using errcode = 'P0001';
  end if;
  if p_role = 'admin' and not private.has_role('admin') then
    raise exception 'Seul un administrateur peut modifier un administrateur.' using errcode = 'P0001';
  end if;

  insert into public.user_roles (user_id, org_id, role)
  values (p_user_id, private.current_user_org_id(), p_role)
  on conflict (user_id) do update set role = excluded.role
   where public.user_roles.role is distinct from excluded.role;

  -- An admin holds every permission: leftover overrides would only confuse.
  if p_role = 'admin' then
    delete from public.user_permission_overrides o where o.user_id = p_user_id;
  end if;
end;
$$;

create function public.set_user_status(p_user_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_can_manage_user(p_user_id);
  if p_status is null or p_status not in ('active', 'disabled') then
    raise exception 'Statut inconnu : %', p_status using errcode = '22023';
  end if;
  update public.profiles p set status = p_status
   where p.user_id = p_user_id and p.status is distinct from p_status;
end;
$$;

create function public.set_permission_override(p_user_id uuid, p_permission_key text, p_granted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := private.assert_can_manage_user(p_user_id);
begin
  if p_granted is null then
    raise exception 'Valeur manquante' using errcode = '22023';
  end if;
  if not exists (select 1 from public.permissions pm where pm.key = p_permission_key) then
    raise exception 'Permission inconnue : %', p_permission_key using errcode = '22023';
  end if;
  if v_role = 'admin' then
    raise exception 'Un administrateur a déjà toutes les permissions.' using errcode = 'P0001';
  end if;
  if p_granted and not private.has_role('admin') and not private.has_permission(p_permission_key) then
    raise exception 'Vous ne pouvez pas accorder une permission que vous n''avez pas.' using errcode = 'P0001';
  end if;

  insert into public.user_permission_overrides (user_id, org_id, permission_key, granted, created_by)
  values (p_user_id, private.current_user_org_id(), p_permission_key, p_granted, auth.uid())
  on conflict (user_id, permission_key) do update
    set granted = excluded.granted, created_by = excluded.created_by
   where public.user_permission_overrides.granted is distinct from excluded.granted;
end;
$$;

create function public.clear_permission_override(p_user_id uuid, p_permission_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_can_manage_user(p_user_id);
  delete from public.user_permission_overrides o
   where o.user_id = p_user_id and o.permission_key = p_permission_key;
end;
$$;

revoke all on function
  public.list_org_users(),
  public.set_user_role(uuid, text),
  public.set_user_status(uuid, text),
  public.set_permission_override(uuid, text, boolean),
  public.clear_permission_override(uuid, text)
from public, anon, authenticated;
grant execute on function
  public.list_org_users(),
  public.set_user_role(uuid, text),
  public.set_user_status(uuid, text),
  public.set_permission_override(uuid, text, boolean),
  public.clear_permission_override(uuid, text)
to authenticated;
```

**Step 4: Run the database checks** (`db:reset`, `db:test`, `db:types`). The new trigger may hit Phase 1 tests that disable or delete their only admin: fix the fixture by adding a second admin, never by dropping the trigger. `scripts/bootstrap-admin.sql` must still work twice in a row against a fresh local database: run it with a test email to check, then reset.

**Step 5: Commit.** `feat(db): user administration RPCs and last-admin guard`.

---

## Task 2.16: Section « Utilisateurs et accès »

**Files:**
- Create: `src/core/users/api.ts` + test, `src/core/users/hooks.ts`
- Create: `src/core/users/permissions.ts` + test (effective-permission helpers)
- Create: `src/core/settings/pages/UsersSettingsPage.tsx` + test, `src/core/users/components/UserSheet.tsx` + test, `src/core/users/components/RoleMatrix.tsx` + test
- Modify: `sections.ts`, `fr-CA.json` (`settings.users.*`)

**API:**
- `fetchOrgUsers()` (`rpc('list_org_users')`);
- `fetchPermissionCatalog()`: `permissions`, `role_permissions`, `roles`, `modules` in parallel; every authenticated user can read them;
- `fetchUserOverrides(userId)`;
- `setUserRole`, `setUserStatus`, `setPermissionOverride`, `clearPermissionOverride`.

`userKeys` (`all`, `list`, `catalog`, `overrides(id)`). Every mutation invalidates `userKeys.all`. If the target is the current user (never, given the guards), it would also invalidate access.

**`permissions.ts`:**
```ts
export type OverrideState = 'role' | 'granted' | 'revoked'
/** What the role gives by default. */
export function roleGrants(role: string, rolePermissions: { role: string; permission_key: string }[]): Set<string>
/** Effective = (role defaults ∪ granted) − revoked. Mirrors private.has_permission (module gate excluded). */
export function effectivePermissions(roleSet: Set<string>, overrides: { permission_key: string; granted: boolean }[]): Set<string>
```
Unit-test both, including a revoke of a role default and a grant outside the role.

**Page:**
- **Tab « Utilisateurs »** (`NavTabs`, not in the tab order): a `Table` with columns Nom, Courriel, Rôle (`roleLabel`), Statut (badge « Actif » / « Désactivé »), Dernière connexion (`formatClinicDateTime`, or « Jamais »).
  - A row is clickable with `users.manage`; with `users.view` only, the table is read-only. Keyboard: the name cell is a `button`.
  - Above the table, a note: « Pour ajouter une personne, contactez l'administrateur technique. Les invitations par courriel arriveront bientôt. » (decision #22).
- **`UserSheet`** (`Sheet`, side right), for the selected user:
  - name and email;
  - **Rôle:** a `Select` with `admin`, `counselor`, `admin_assistant`. For a provider: the role shown read-only, with « Géré dans le module Professionnels ».
  - **Statut:** a `Switch` « Compte actif ». Disabling asks for confirmation (« X ne pourra plus se connecter. »).
  - **Permissions** (hidden for admins, with the note « Un administrateur a toutes les permissions. »):
    - one group per module (core first, then enabled modules by name);
    - each permission's description (from `permissions.description`) with a three-option segmented control: « Selon le rôle (Oui|Non) » / « Accordée » / « Retirée »;
    - each change calls the matching RPC at once, with a toast and the control disabled while pending.
  - **The current user:** controls disabled, with « Modifiez votre compte dans Mon compte. »
- **Tab « Rôles »:** `RoleMatrix`, a read-only table with permissions as rows (grouped by module) and roles as columns, ✓ or —. Note: « Les rôles par défaut sont fixés par la clinique. Pour une exception, modifiez la personne. »

**Tests:**
- list rendering (labels, statuses, « Jamais »);
- read-only without `users.manage`;
- changing the role calls `setUserRole` and toasts;
- disabling asks for confirmation;
- the three-state control calls set/clear correctly;
- a `P0001` message (the last-admin guard) shows in a toast;
- the admin note hides the permissions;
- the matrix marks `settings.view` for admin and admin_assistant only.

**Browser check:** as `admin@mana.test`, give `conseillere@mana.test` an `audit.view` grant. Sign in as the conseillère in a private window: « Paramètres → Journal d'audit » appears. Remove the grant, reload: it is gone.

**Commit:** `feat(settings): Utilisateurs et accès section`.

---

# Batch 2d — Journal d'audit

## Task 2.17: Audit viewer RPCs

**Files:**
- Create: `supabase/migrations/<ts>_core_audit_viewer.sql`
- Create: `supabase/tests/database/010_core_audit_viewer.test.sql`

**Step 1: Write the failing pgTAP test.** Fixtures: org A admin, org A counselor, org B admin; generate audit rows by updating org A's name 3 times, plus one org B change. Assert:
- `list_audit_entries()` as admin A:
  - returns only org A rows, newest first, with `actor_name = 'Admin A'`;
  - `p_table => 'organizations'` filters;
  - `p_before_id => <second id>` pages;
  - `p_limit => 1` returns 1;
  - `p_limit => 1000` is capped at 200 (create 201 rows in a loop, or assert the cap by function body; prefer the loop);
  - `p_from`/`p_to` filter.
- `list_audit_actors()` returns admin A once.
- As the counselor: both throw `42501`.
- Admin B never sees org A rows.
- `function_privs_are`: `authenticated` yes, `anon` no.

**Step 2: Run it and check that it fails.**

**Step 3: Write the migration.**

```sql
-- =============================================================================
-- Audit log viewer RPCs
-- =============================================================================
-- Design:  docs/plans/2026-10-07-phase-2-core-settings-design.md §3.6
-- SECURITY DEFINER so the actor's name can be shown to a viewer without
-- users.view. Scoped to the caller's org; never returns rows without org_id.
-- =============================================================================

create index audit_log_org_id_id_idx on public.audit_log (org_id, id desc);

create function public.list_audit_entries(
  p_table text default null,
  p_actor uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_before_id bigint default null,
  p_limit int default 50
)
returns table (
  id bigint,
  created_at timestamptz,
  table_name text,
  record_id text,
  action text,
  changed_fields jsonb,
  actor_id uuid,
  actor_name text,
  actor_role text,
  source text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.has_permission('audit.view') then
    raise exception 'Permission refusée : audit.view' using errcode = '42501';
  end if;
  return query
    select a.id, a.created_at, a.table_name, a.record_id, a.action, a.changed_fields,
           a.actor_id, p.display_name, a.actor_role, a.source
      from public.audit_log a
      left join public.profiles p on p.user_id = a.actor_id
     where a.org_id = private.current_user_org_id()
       and (p_table is null or a.table_name = p_table)
       and (p_actor is null or a.actor_id = p_actor)
       and (p_from is null or a.created_at >= p_from)
       and (p_to is null or a.created_at < p_to)
       and (p_before_id is null or a.id < p_before_id)
     order by a.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

-- People who appear in the org's log (for the « Personne » filter).
create function public.list_audit_actors()
returns table (actor_id uuid, actor_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.has_permission('audit.view') then
    raise exception 'Permission refusée : audit.view' using errcode = '42501';
  end if;
  return query
    select distinct a.actor_id, p.display_name
      from public.audit_log a
      join public.profiles p on p.user_id = a.actor_id
     where a.org_id = private.current_user_org_id()
     order by p.display_name;
end;
$$;

revoke all on function
  public.list_audit_entries(text, uuid, timestamptz, timestamptz, bigint, int),
  public.list_audit_actors()
from public, anon, authenticated;
grant execute on function
  public.list_audit_entries(text, uuid, timestamptz, timestamptz, bigint, int),
  public.list_audit_actors()
to authenticated;
```

**Step 4: Run the database checks** (`db:reset`, `db:test`, `db:types`), then commit. `feat(db): audit log viewer RPCs`.

---

## Task 2.18: Section « Journal d'audit »

**Files:**
- Create: `src/core/audit/api.ts` + test, `src/core/audit/hooks.ts`
- Create: `src/core/audit/labels.ts` + test (French labels for tables, columns, actions, sources)
- Create: `src/core/settings/pages/AuditLogPage.tsx` + test
- Modify: `sections.ts` (remove `ComingSoonSection` and delete the file), `fr-CA.json` (`audit.*`)

**API and hook:**
- `fetchAuditEntries(filters, beforeId)`;
- `fetchAuditActors()`;
- `useAuditEntries(filters)` with `useInfiniteQuery`, where `getNextPageParam` is the last id when the page is full (50), else `undefined`.

**`labels.ts`:**
- **Tables:**

  | Table | Label |
  |---|---|
  | `organizations` | Clinique |
  | `profiles` | Utilisateurs |
  | `user_roles` | Rôles |
  | `user_permission_overrides` | Exceptions de permissions |
  | `org_modules` | Modules |
  | `org_module_settings` | Paramètres de module |
  | `org_secrets` | Secrets |
  | `tax_rates` | Taux de taxes |
  | `organization_bank_details` | Coordonnées bancaires |

- **Fields:** `audit.fields.<table>.<column>` for every column the UI can change, e.g. `organizations.neq` = « NEQ » and `profiles.status` = « Statut ».
- **Actions:** insert = « Création », update = « Modification », delete = « Suppression », read = « Consultation ».
- **Sources:** `app` = « Application », `seed` = « Données de test », `bootstrap` = « Installation », `rpc:*` = « Application », `auth:*` = « Connexion », `service` / `system` = « Système ».
- **Fallbacks:** `fieldLabel(table, column)` falls back to the column name and `tableLabel` to the table name.
- **Values:** `formatAuditValue(v)` shows `null` as « (vide) », booleans as « Oui » / « Non », `"[redacted]"` as « (masqué) », and objects as compact JSON.

**Page:**
- **Filters:**
  - Section (`Select` from the table labels);
  - Personne (`Select` from `list_audit_actors`);
  - Période: Aujourd'hui / 7 jours / 30 jours / Tout. Compute the bounds in clinic time with the timezone utilities, e.g. `clinicTimeToUTC(getClinicDateString(), '00:00')`.
- **Table columns:**
  - Date (`formatClinicDateTime`);
  - Personne (`actor_name`, or « Système »);
  - Section;
  - Action;
  - Élément (`record_id`, shortened; the full value in a `title`).
- **Expanded row:** for updates, a list « Champ : avant → après »; for inserts and deletes, the fields; for reads, « Consultation du numéro de compte ».
- **Paging:** « Charger plus » while there is a next page; otherwise the end text « Début du journal ».

**Tests:**
- labels and fallbacks;
- the filters pass the right arguments, including period bounds computed for `America/Toronto`;
- « Charger plus » requests `beforeId`;
- the expanded update shows before → after with French labels and « (masqué) »;
- the empty state.

**Commit:** `feat(settings): Journal d'audit section`.

---

# Wrap-up

## Task 2.19: Documentation, full verification, review

**Step 1: Documentation.**
- `docs/modules/core.md`: the new tables, RPCs, permissions, roles and guards.
- `CLAUDE.md`:
  - §4 structure: add `core/account`, `core/users`, `core/audit`, `core/settings/{organization,tax,bank,components}`;
  - §8: settings sections have `id` + `path`; `SettingsCard` / `OrganizationCard` / `FormField`; unsaved-changes guard; never cache revealed sensitive values;
  - §1 « Built so far ».
- `docs/plans/2026-10-07-status.md`: rewrite for Phase 2 (what's done, how to test locally with the four accounts, what deploys on merge).
- `docs/plans/2026-10-06-legacy-feature-inventory.md` §I: tick the items built here and point the others to their new home (design §1 table).
- Remove the remaining `staff` role mentions (found during Task 2.1): `CLAUDE.md` §5 (« staff have it but no section yet »), `docs/modules/core.md` (roles and permission tables), `docs/modules/professionals.md`, `docs/standards/business-context.md` §2 (map conseillères → `counselor`, adjointe → `admin_assistant`), `docs/standards/database-conventions.md` (example SQL).

**Step 2: Full checks.**
```bash
npm run typecheck && npm run lint && npm run lint:supabase && npm run test:run && npm run build
npm run db:reset && npm run db:test
npm run check:functions && npm run lint:functions && npm run test:functions
BASE_REF=origin/main npm run lint:migrations
```
Expected: all green. Also check that `git diff --stat src/core/supabase/database.types.ts` shows nothing uncommitted after `npm run db:types`.

**Step 3: Browser walkthrough** (local, `http://localhost:5173`, the four accounts, desktop and mobile widths). Record the results in the status doc:
- **admin:**
  - every section; save each card;
  - add a future TVQ rate, then delete it;
  - bank: add, reveal, check the audit entry « Consultation »;
  - users: change the conseillère's role, then change it back;
  - disable then re-enable the adjointe;
  - journal filters;
  - Mon compte;
- **adjointe:** Paramètres opens; clinic sections read-only; no Banque, Utilisateurs, Modules or Journal;
- **conseillère:** no Paramètres; `/parametres` shows « Accès refusé »; Mon compte works;
- **professionnel:** Mon compte only;
- **unsaved changes:** edit a card, click another section → the dialog shows; reload with unsaved changes → the browser warns.

**Step 4: Final review.** Dispatch the `superpowers:code-reviewer` agent on the whole branch diff against `origin/main`, with the design and this plan. Fix the findings and have them re-reviewed.

**Step 5: Report to Jonathan.** Report what was built, with screenshots. Then ask, separately:
1. push + PR (CI, Vercel preview);
2. once green and reviewed, merging deploys the six migrations to staging (CD). Jonathan's admin keeps working; staging has no `staff` user.

Note for after the merge: the clinic identity fields are empty on staging. Christine, or Jonathan, fills them in Paramètres.

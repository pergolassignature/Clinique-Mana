# Foundation Rebuild — Phase 0 (Preparation) + Phase 1 (Base) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Set aside the legacy app and stand up the new foundation: tooling + CI, the core database (organisations, profiles, roles & permissions, modules, secrets, audit), authentication (password, magic link, reset), the access layer, the module registry, a minimal app shell and settings shell, with Professionnels registered as an (empty) first module.

**Architecture:** See [design](2026-10-06-foundation-rebuild-design.md) §2, §3, §6 and the parity checklist [inventory](2026-10-06-legacy-feature-inventory.md). Permissions live in the database (`role_permissions` + `user_permission_overrides`) and are read by both RLS (`has_permission()`) and the frontend (`get_my_access()`). Modules are declared by `manifest.ts` files, filtered by `org_modules`, and isolated by ESLint import boundaries.

**Tech Stack:** React 19 · Vite 6 · TypeScript 5.7 strict · React Router 6 · TanStack Query 5 · Tailwind 3 + shadcn/ui · Zod 4 · react-hook-form · Sonner · Vitest + Testing Library · Supabase (Postgres 17, Auth, Vault) · pgTAP · Deno (edge functions) · GitHub Actions.

---

## Ground rules for the executor

- Work in the worktree `/Users/jonathanharvey/Documents/Claude Projects/Clinique-Mana/.claude/worktrees/clinique-mana-architecture-477a6b`.
- **Outward or destructive steps need Jonathan's explicit "yes" in chat, every time:** pushing to GitHub (Task 0.1, 1.20), wiping staging (Task 1.21), deleting remote edge functions/buckets, setting GitHub secrets. Stop and ask; do not batch these approvals.
- **Docker is required** for `supabase start` / `supabase test db` / `supabase db dump`. OrbStack is installed: run `open -a OrbStack` and wait until `docker info` succeeds.
- Inside a module, import your own files with **relative** paths; other modules only via `@/modules/<name>` (enforced by ESLint from Task 1.3).
- Migration filenames: `YYYYMMDDHHMMSS_name.sql` with seconds ≠ `00` (enforced by `lint:migrations`).
- Commit after every task with a Conventional Commit message ending with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

---

## Phase 0 — Preparation

### Task 0.1: Publish the pending commit and tag the legacy app

**Files:** none.

**Step 1: Ask Jonathan** — "OK to push local `main` (commit `7d5d48c`) to origin and create tag `legacy-v1`?" Wait for yes.

**Step 2: Push and tag**

```bash
git push origin main
git tag -a legacy-v1 7d5d48c -m "Legacy app before foundation rebuild"
git push origin legacy-v1
```

Expected: `main -> main` and `[new tag] legacy-v1 -> legacy-v1`.

**Step 3: Create the implementation branch**

```bash
git switch -c feat/foundation-base docs/foundation-rebuild-design
git branch --show-current
```

Expected: `feat/foundation-base`.

### Task 0.2: Back up staging and record its live state

**Files:**
- Create: `docs/audit/2026-10-06-staging-snapshot.md`

**Step 1: Dump staging outside the repo** (needs Docker + the staging DB password from the Supabase dashboard → Settings → Database).

```bash
mkdir -p "/Users/jonathanharvey/Documents/Claude Projects/clinique-mana-backups"
supabase link --project-ref vnmbjbdsjxmpijyjmmkh
B="/Users/jonathanharvey/Documents/Claude Projects/clinique-mana-backups"
supabase db dump --linked -f "$B/2026-10-06-staging-schema.sql"
supabase db dump --linked --data-only -f "$B/2026-10-06-staging-data.sql"
supabase db dump --linked --role-only -f "$B/2026-10-06-staging-roles.sql"
ls -la "$B"
```

Expected: three non-empty `.sql` files.

**Step 2: Record live-only state** (read-only queries via the Supabase MCP `execute_sql` on project `vnmbjbdsjxmpijyjmmkh`):

```sql
select grantee, table_name, string_agg(privilege_type, ',') as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by 1, 2 order by 1, 2;

select jobid, jobname, schedule, command, active from cron.job;

select id, public, file_size_limit, allowed_mime_types from storage.buckets;

select count(*) as auth_users from auth.users;
```

Also list edge functions with MCP `list_edge_functions`.

**Step 3: Write `docs/audit/2026-10-06-staging-snapshot.md`** with: date, the four query results as tables, the edge function list, and the backup file names (not their content). No secrets, no personal data.

**Step 4: Commit**

```bash
git add docs/audit/2026-10-06-staging-snapshot.md
git commit -m "docs(audit): snapshot staging state before foundation reset"
```

### Task 0.3: Move the legacy app into `_legacy/`

**Files:**
- Move: `src/` → `_legacy/src/`, `supabase/migrations/` → `_legacy/supabase/migrations/`, `supabase/functions/` → `_legacy/supabase/functions/`, `supabase/seed.sql` → `_legacy/supabase/seed.sql`, `tests/` → `_legacy/tests/`, `claude.md` → `_legacy/claude.md`, `PROJECT_CONTEXT.md` → `_legacy/PROJECT_CONTEXT.md`
- Create: `_legacy/README.md`

**Step 1: Move**

```bash
mkdir -p _legacy/supabase
git mv src _legacy/src
git mv supabase/migrations _legacy/supabase/migrations
git mv supabase/functions _legacy/supabase/functions
git mv supabase/seed.sql _legacy/supabase/seed.sql
git mv tests _legacy/tests
git mv claude.md _legacy/claude.md
git mv PROJECT_CONTEXT.md _legacy/PROJECT_CONTEXT.md
mkdir -p src supabase/migrations supabase/functions supabase/tests/database
```

**Step 2: Create `_legacy/README.md`**

```markdown
# Legacy Clinique MANA (read-only)

The app as it was before the foundation rebuild (tag `legacy-v1`).

- **Do not edit or import** anything here. It is excluded from TypeScript, ESLint, Vite and CI.
- Use it as a reference when rebuilding a module. The behaviour to preserve is listed in
  `docs/plans/2026-10-06-legacy-feature-inventory.md`.
- A module's legacy folder is deleted once that module is rebuilt and enabled.
```

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: move legacy app to _legacy/ ahead of foundation rebuild"
```

---

## Phase 1 — Base

### Task 1.1: Dependencies and scripts

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

**Step 1: Remove legacy-only packages, add new ones**

```bash
npm uninstall @anthropic-ai/sdk @tanstack/react-router @dnd-kit/core @dnd-kit/utilities hyphen @react-pdf/renderer @googlemaps/js-api-loader @types/google.maps
npm install react-router-dom@^6.30 react-hook-form @hookform/resolvers sonner @sentry/react
npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event happy-dom
```

**Step 2: Replace the `scripts` block in `package.json`**

```json
"scripts": {
  "dev": "vite",
  "build": "npm run typecheck && vite build",
  "preview": "vite preview",
  "typecheck": "tsc -p tsconfig.json --noEmit",
  "lint": "eslint .",
  "lint:supabase": "bash scripts/check-component-supabase.sh",
  "lint:migrations": "node scripts/check-migration-timestamps.mjs",
  "test": "vitest",
  "test:run": "vitest run",
  "test:functions": "deno test --allow-env supabase/functions/_shared",
  "db:start": "supabase start",
  "db:reset": "supabase db reset",
  "db:test": "supabase test db",
  "db:types": "supabase gen types typescript --local --schema public > src/core/supabase/database.types.ts",
  "format": "prettier --write \"src/**/*.{ts,tsx,css,json}\""
}
```

**Step 3: Append to `.env.example`**

```bash
# Optional: Sentry error reporting (leave empty locally)
VITE_SENTRY_DSN=
```

**Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: swap legacy deps for foundation stack (react-router, rhf, sonner, vitest)"
```

### Task 1.2: TypeScript, Vitest and the first test

**Files:**
- Modify: `tsconfig.json`
- Create: `vitest.config.ts`, `src/test/setup.ts`, `src/vite-env.d.ts`
- Create: `src/shared/lib/utils.ts` (copied), `src/shared/lib/utils.test.ts`

**Step 1: In `tsconfig.json`**, delete the `"exclude": [...]` line (tests must typecheck too) and keep `"include": ["src"]`.

**Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    env: {
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
})
```

**Step 3: Create `src/test/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest'
```

**Step 4: Create `src/vite-env.d.ts`**

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_SENTRY_DSN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

**Step 5: Write the failing test** `src/shared/lib/utils.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('merges classes and lets later Tailwind classes win', () => {
    expect(cn('px-2 py-1', false && 'hidden', 'px-4')).toBe('py-1 px-4')
  })
})
```

**Step 6: Run it** — `npx vitest run src/shared/lib/utils.test.ts` → FAIL (cannot resolve `./utils`).

**Step 7: Copy the implementation** — `cp _legacy/src/shared/lib/utils.ts src/shared/lib/utils.ts`

**Step 8: Run it** — `npx vitest run src/shared/lib/utils.test.ts` → PASS.

**Step 9: Commit**

```bash
git add tsconfig.json vitest.config.ts src
git commit -m "test: add vitest setup and first shared util test"
```

### Task 1.3: ESLint module boundaries and the Supabase guard

**Files:**
- Modify: `eslint.config.js`
- Create: `scripts/check-component-supabase.sh`, `scripts/check-migration-timestamps.mjs`

**Step 1: Replace `eslint.config.js`**

```js
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', '_legacy', 'supabase/functions', 'src/core/supabase/database.types.ts'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // Design §6.2 — core/ and shared/ never depend on modules or the app shell.
  {
    files: ['src/core/**/*.{ts,tsx}', 'src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{ group: ['@/modules/*', '@/app/*'], message: 'core/ and shared/ must not import modules or app (design §6.2).' }],
      }],
    },
  },
  // Design §6.2 — modules talk to each other only through their public index.
  {
    files: ['src/modules/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@/modules/*/*'], message: 'Import another module only via @/modules/<name>; use relative paths inside your own module (design §6.2).' },
          { group: ['@/app/*'], message: 'Modules must not import the app shell (design §6.2).' },
        ],
      }],
    },
  },
)
```

**Step 2: Create `scripts/check-component-supabase.sh`** (adapted from PS Hub)

```bash
#!/usr/bin/env bash
# Guardrail (ported from PS Hub): UI files (.tsx) must not use the Supabase client.
# Data access lives in api/*.ts files and is called through hooks.
# Exemption: add "// SUPABASE_ALLOWED: <reason>" (providers only).
set -euo pipefail

violations=""
while IFS= read -r file; do
  if grep -q "SUPABASE_ALLOWED" "$file"; then continue; fi
  violations="${violations}\n  - ${file}"
done < <(grep -rl --include='*.tsx' "@/core/supabase/client" src || true)

if [ -n "$violations" ]; then
  echo -e "ERROR: UI files must not import the Supabase client directly:${violations}"
  echo "Move the query to an api/*.ts file and call it through a hook."
  exit 1
fi
echo "OK: no direct Supabase access in UI files."
```

```bash
chmod +x scripts/check-component-supabase.sh
```

**Step 3: Copy the migration timestamp lint from PS Hub and empty its allowlist**

```bash
cp "/Users/jonathanharvey/Documents/Claude Projects/NEW PS Hub/scripts/check-migration-timestamps.mjs" scripts/
```

Then edit `scripts/check-migration-timestamps.mjs`: replace the whole `legacyRoundTimestampAllowlist = new Set([ ... ])` literal with `new Set([])`, and in the header comment replace the PS Hub incident reference with `See docs/plans/2026-10-06-foundation-rebuild-design.md §6.4.`

**Step 4: Verify the guards**

```bash
npm run lint && npm run lint:supabase
```

Expected: ESLint passes; guard prints `OK: no direct Supabase access in UI files.`

Then prove the boundary works: create `src/core/tmp-violation.ts` containing `import '@/modules/professionnels'`, run `npx eslint src/core/tmp-violation.ts` → expect the "core/ and shared/ must not import modules" error. Delete the file.

**Step 5: Commit**

```bash
git add eslint.config.js scripts
git commit -m "chore(lint): enforce module import boundaries and supabase-in-UI guard"
```

### Task 1.4: Shared library — timezone made configurable

Fixes legacy bug: the clinic timezone setting was saved but never used (inventory §I).

**Files:**
- Create: `src/shared/lib/timezone.ts` (from legacy, modified), `src/shared/lib/timezone.test.ts`

**Step 1: Write the failing test** `src/shared/lib/timezone.test.ts`

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { formatClinicTime, formatDateOnly, getClinicTimezone, setClinicTimezone } from './timezone'

describe('clinic timezone', () => {
  afterEach(() => setClinicTimezone('America/Toronto'))

  it('defaults to America/Toronto', () => {
    expect(getClinicTimezone()).toBe('America/Toronto')
  })

  it('formats timestamps in the configured timezone', () => {
    const utc = '2026-01-15T19:30:00Z'
    expect(formatClinicTime(utc)).toBe('14:30')
    setClinicTimezone('America/Vancouver')
    expect(formatClinicTime(utc)).toBe('11:30')
  })

  it('never shifts date-only values', () => {
    setClinicTimezone('America/Vancouver')
    expect(formatDateOnly('2020-01-01')).toBe('1 janvier 2020')
  })
})
```

**Step 2: Run** — `npx vitest run src/shared/lib/timezone.test.ts` → FAIL (module not found).

**Step 3: Copy and modify**

```bash
cp _legacy/src/shared/lib/timezone.ts src/shared/lib/timezone.ts
```

In `src/shared/lib/timezone.ts` replace line `export const CLINIC_TIMEZONE = 'America/Toronto'` (and the comment line above it saying it "should eventually come from clinic_settings") with:

```ts
// Set at sign-in from organizations.timezone (see core/access/AccessProvider).
let clinicTimezone = 'America/Toronto'

export function setClinicTimezone(timezone: string): void {
  clinicTimezone = timezone
}

export function getClinicTimezone(): string {
  return clinicTimezone
}
```

Then replace every remaining `CLINIC_TIMEZONE` in the file with `clinicTimezone`:

```bash
sed -i '' 's/CLINIC_TIMEZONE/clinicTimezone/g' src/shared/lib/timezone.ts
grep -c "clinicTimezone" src/shared/lib/timezone.ts
```

**Step 4: Run** — `npx vitest run src/shared/lib/timezone.test.ts` → PASS (3 tests).

**Step 5: Commit**

```bash
git add src/shared/lib/timezone.ts src/shared/lib/timezone.test.ts
git commit -m "feat(shared): configurable clinic timezone utilities"
```

### Task 1.5: Shared UI primitives, styles, i18n, toasts, error boundary

**Files:**
- Copy: `_legacy/src/shared/ui/*.tsx` except `toast.tsx`, `toaster.tsx` → `src/shared/ui/`
- Create: `src/shared/ui/index.ts`, `src/shared/ui/sonner.tsx`, `src/shared/components/ErrorBoundary.tsx`, `src/shared/components/FullPageMessage.tsx`
- Copy: `_legacy/src/styles/globals.css` → `src/styles/globals.css`, `_legacy/src/i18n/index.ts` → `src/i18n/index.ts`
- Create: `src/i18n/fr-CA.json`

**Step 1: Copy**

```bash
mkdir -p src/shared/ui src/shared/components src/styles src/i18n
for f in _legacy/src/shared/ui/*.tsx; do
  case "$(basename "$f")" in toast.tsx|toaster.tsx) ;; *) cp "$f" src/shared/ui/ ;; esac
done
cp _legacy/src/styles/globals.css src/styles/globals.css
cp _legacy/src/i18n/index.ts src/i18n/index.ts
```

**Step 2: Create `src/shared/ui/index.ts`**

```ts
export * from './button'
export * from './badge'
export * from './card'
export * from './tooltip'
export * from './avatar'
export * from './input'
export * from './label'
export * from './dropdown-menu'
export * from './dialog'
export * from './sonner'
```

**Step 3: Create `src/shared/ui/sonner.tsx`**

```tsx
import { Toaster as SonnerToaster } from 'sonner'

export { toast } from 'sonner'

export function Toaster() {
  return <SonnerToaster position="top-right" richColors closeButton />
}
```

**Step 4: Create `src/i18n/fr-CA.json`** (every key used in Phase 1; later modules add their own namespace)

```json
{
  "app": { "name": "Clinique MANA" },
  "nav": { "home": "Accueil", "settings": "Paramètres", "logout": "Se déconnecter" },
  "common": {
    "loading": "Chargement…",
    "retry": "Réessayer",
    "notFound": { "title": "Page introuvable", "body": "Cette page n'existe pas ou a été déplacée." },
    "moduleError": { "title": "Cette section a rencontré un problème", "body": "Le reste de l'application fonctionne toujours. Réessayez ou revenez plus tard." }
  },
  "auth": {
    "login": {
      "title": "Connexion",
      "email": "Courriel",
      "password": "Mot de passe",
      "submit": "Se connecter",
      "magicLink": "Recevoir un lien de connexion par courriel",
      "magicLinkSent": "Si un compte existe pour ce courriel, un lien de connexion vient d'être envoyé.",
      "forgot": "Mot de passe oublié ?"
    },
    "forgot": {
      "title": "Réinitialiser le mot de passe",
      "submit": "Envoyer le lien",
      "sent": "Si un compte existe pour ce courriel, un lien de réinitialisation vient d'être envoyé.",
      "back": "Retour à la connexion"
    },
    "reset": {
      "title": "Choisir un nouveau mot de passe",
      "password": "Nouveau mot de passe",
      "confirm": "Confirmer le mot de passe",
      "submit": "Enregistrer",
      "tooShort": "Au moins 10 caractères.",
      "mismatch": "Les mots de passe ne correspondent pas.",
      "invalidLink": "Ce lien est invalide ou expiré. Demandez-en un nouveau.",
      "success": "Mot de passe mis à jour."
    },
    "errors": {
      "invalidEmail": "Courriel invalide.",
      "required": "Champ requis.",
      "invalid_credentials": "Courriel ou mot de passe incorrect.",
      "rate_limited": "Trop de tentatives. Réessayez dans quelques minutes.",
      "unknown": "Une erreur est survenue. Réessayez."
    }
  },
  "access": {
    "error": { "title": "Erreur de connexion", "body": "Impossible de vérifier vos accès. Vérifiez votre connexion internet." },
    "denied": {
      "profile_not_found": "Votre compte n'est pas encore configuré. Contactez la clinique.",
      "profile_disabled": "Votre compte est désactivé. Contactez la clinique.",
      "no_role": "Aucun rôle n'est attribué à votre compte. Contactez la clinique.",
      "signOut": "Se déconnecter"
    },
    "forbidden": { "title": "Accès refusé", "body": "Vous n'avez pas la permission d'ouvrir cette page." }
  },
  "home": { "title": "Bienvenue", "body": "Les modules s'ajoutent ici au fur et à mesure qu'ils sont activés." },
  "settings": {
    "title": "Paramètres",
    "empty": "Aucune section de paramètres n'est disponible pour votre rôle.",
    "groups": { "clinique": "Clinique", "plateforme": "Plateforme", "modules": "Modules", "compte": "Mon compte" },
    "sections": { "modules": "Modules" },
    "modules": {
      "title": "Modules",
      "description": "Activez un module lorsqu'il est prêt. Un module désactivé disparaît du menu et de l'application.",
      "dependsOn": "Requiert :",
      "saved": "Modules mis à jour.",
      "error": "Impossible de modifier ce module."
    }
  },
  "modules": {
    "professionnels": { "name": "Professionnels", "placeholder": "Le module Professionnels est en construction." }
  }
}
```

**Step 5: Create `src/shared/components/FullPageMessage.tsx`**

```tsx
import type { ReactNode } from 'react'

interface FullPageMessageProps {
  title: string
  body?: string
  action?: ReactNode
}

export function FullPageMessage({ title, body, action }: FullPageMessageProps) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        {body && <p className="mt-2 text-sm text-muted-foreground">{body}</p>}
        {action && <div className="mt-6">{action}</div>}
      </div>
    </div>
  )
}
```

**Step 6: Create `src/shared/components/ErrorBoundary.tsx`**

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react'
import * as Sentry from '@sentry/react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { FullPageMessage } from './FullPageMessage'

interface Props {
  children: ReactNode
  /** Tag sent to Sentry, e.g. the module key. */
  scope?: string
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    Sentry.captureException(error, { tags: { scope: this.props.scope ?? 'app' }, extra: { componentStack: info.componentStack } })
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <FullPageMessage
        title={t('common.moduleError.title')}
        body={t('common.moduleError.body')}
        action={<Button onClick={() => this.setState({ hasError: false })}>{t('common.retry')}</Button>}
      />
    )
  }
}
```

**Step 7: Verify** — `npm run typecheck` → passes for `src/` (the app entry doesn't exist yet; that's fine). If a copied primitive imports something missing, fix the import (only `@/shared/lib/utils` and `@/shared/ui/*` are expected).

**Step 8: Commit**

```bash
git add src
git commit -m "feat(shared): port UI primitives, styles and typed i18n; add sonner and error boundary"
```

### Task 1.6: Supabase local config

**Files:**
- Modify: `supabase/config.toml`

**Step 1:** In `supabase/config.toml`:
- Delete everything from the line `# Edge Functions configuration` to the end of the file (the 8 legacy `[functions.*]` blocks).
- In `[auth]`: set `enable_signup = false` (accounts are only created by invitation) and
  `additional_redirect_urls = ["http://127.0.0.1:5173/**", "http://localhost:5173/**"]`.
- In `[auth.email]`: set `enable_signup = false`.
- Replace the header comment `# Module: auth-foundation` with `# Foundation rebuild — see docs/plans/2026-10-06-foundation-rebuild-design.md`.

**Step 2: Verify** — `supabase start` (Docker running). Expected: services start, prints API URL and anon key. Then `supabase stop`.

**Step 3: Commit**

```bash
git add supabase/config.toml
git commit -m "chore(supabase): invitation-only auth config, drop legacy function blocks"
```

### Task 1.7: Core access schema (TDD with pgTAP)

**Files:**
- Create: `supabase/tests/database/001_core_access.test.sql`
- Create: `supabase/migrations/20261006140517_core_access.sql`

**Step 1: Write the failing test** `supabase/tests/database/001_core_access.test.sql`

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- Fixtures -------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'disabled@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',    '', now(), '{}', '{}', now(), now());

insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');

insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',    'admin@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Staff A',    'staff@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A', 'provider@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Disabled A', 'disabled@a.test', 'disabled'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',    'admin@b.test',    'active');

insert into public.user_roles (user_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'staff'),
  ('a0000000-0000-0000-0000-000000000003', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'admin'),
  ('a0000000-0000-0000-0000-000000000005', 'admin');

-- Staff: extra grant users.manage, revoke users.view.
insert into public.user_permission_overrides (user_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000002', 'users.manage', true),
  ('a0000000-0000-0000-0000-000000000002', 'users.view', false);

set local role authenticated;

-- has_permission -------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok(public.has_permission('settings.manage'), 'admin has settings.manage by role default');
select results_eq('select count(*)::int from public.profiles', array[4], 'admin sees the 4 profiles of their own org only');
select results_eq('select count(*)::int from public.organizations', array[1], 'admin sees only their own organization');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select ok(public.has_permission('settings.view'), 'staff has settings.view by role default');
select ok(not public.has_permission('settings.manage'), 'staff lacks settings.manage');
select ok(public.has_permission('users.manage'), 'override grant adds users.manage');
select ok(not public.has_permission('users.view'), 'override revoke removes users.view');
select is(public.current_user_org_id(), 'b0000000-0000-0000-0000-00000000000a'::uuid, 'current_user_org_id returns own org');
select is(public.get_my_access() ->> 'role', 'staff', 'get_my_access returns the role');
select ok((public.get_my_access() -> 'permissions') ? 'users.manage', 'get_my_access includes granted override');
select ok(not ((public.get_my_access() -> 'permissions') ? 'users.view'), 'get_my_access excludes revoked permission');
select is(public.get_my_access() ->> 'org_timezone', 'America/Toronto', 'get_my_access returns the org timezone');
select results_eq('select count(*)::int from public.profiles', array[1], 'staff without users.view sees only own profile');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(not public.has_permission('settings.view'), 'provider has no settings access');
select lives_ok($$ update public.profiles set display_name = 'Dr Provider' where user_id = auth.uid() $$, 'provider can rename themselves');
select throws_ok($$ update public.profiles set status = 'disabled' where user_id = auth.uid() $$, '42501', null, 'provider cannot change own status');
select throws_ok($$ insert into public.user_roles (user_id, role) values ('a0000000-0000-0000-0000-000000000003', 'admin') $$, '42501', null, 'clients cannot write roles');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select ok(not public.has_permission('settings.manage'), 'disabled admin has no permissions');

select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select ok(not public.has_permission('settings.view'), 'no user means no permission');

select * from finish();
rollback;
```

**Step 2: Run** — `supabase start` then `supabase test db` → FAIL (relation `public.organizations` does not exist).

**Step 3: Write `supabase/migrations/20261006140517_core_access.sql`**

```sql
-- Core access foundation (design §2): organizations, profiles, roles, permissions.
-- Follows Supabase's RBAC pattern; the role is read from the table (not the JWT)
-- so deactivation and role changes take effect immediately.

create extension if not exists pgcrypto with schema extensions;

-- Shared trigger: keep updated_at current ---------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Organizations (the clinic). Phase 2 adds identity/tax/privacy columns. ---------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  timezone text not null default 'America/Toronto',
  default_locale text not null default 'fr-CA',
  currency text not null default 'CAD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organizations_set_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

-- Profiles: application identity for every auth user ----------------------------
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id),
  display_name text not null check (length(trim(display_name)) > 0),
  email text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_org_id_idx on public.profiles (org_id);
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Roles -------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'staff', 'provider');

create table public.user_roles (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now()
);

-- Permission catalogue (a table, not an enum: modules add keys in their own migration)
create table public.permissions (
  key text primary key check (key ~ '^[a-z_]+(\.[a-z_]+)+$'),
  module_key text not null,
  description text not null
);

create table public.role_permissions (
  role public.app_role not null,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role, permission_key)
);

create table public.user_permission_overrides (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  granted boolean not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (user_id, permission_key)
);

-- Helpers (SECURITY DEFINER; RLS policies call these, never the tables inline) ---
create or replace function public.current_user_org_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.org_id from public.profiles p
  where p.user_id = auth.uid() and p.status = 'active'
$$;

create or replace function public.current_user_role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select r.role from public.user_roles r
  join public.profiles p on p.user_id = r.user_id
  where r.user_id = auth.uid() and p.status = 'active'
$$;

create or replace function public.has_role(p_role public.app_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_user_role() = p_role, false)
$$;

create or replace function public.has_permission(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  with me as (
    select r.user_id, r.role from public.user_roles r
    join public.profiles p on p.user_id = r.user_id
    where r.user_id = auth.uid() and p.status = 'active'
  )
  select coalesce(
    (select o.granted from public.user_permission_overrides o join me on me.user_id = o.user_id
      where o.permission_key = p_key),
    exists (select 1 from public.role_permissions rp join me on me.role = rp.role
      where rp.permission_key = p_key),
    false
  )
$$;

create or replace function public.user_in_my_org(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = p_user_id and p.org_id = public.current_user_org_id()
  )
$$;

-- One call for the frontend: profile + org + role + effective permissions.
-- Returns null when the caller has no profile. Disabled profiles are returned
-- (status = 'disabled') so the UI can explain why access is refused.
create or replace function public.get_my_access()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', p.user_id,
    'org_id', p.org_id,
    'org_name', o.name,
    'org_timezone', o.timezone,
    'display_name', p.display_name,
    'email', p.email,
    'status', p.status,
    'role', r.role,
    'permissions', coalesce((
      select jsonb_agg(k order by k) from (
        select rp.permission_key as k from public.role_permissions rp
        where rp.role = r.role
          and not exists (
            select 1 from public.user_permission_overrides x
            where x.user_id = p.user_id and x.permission_key = rp.permission_key and not x.granted)
        union
        select x.permission_key from public.user_permission_overrides x
        where x.user_id = p.user_id and x.granted
      ) effective
    ), '[]'::jsonb)
  )
  from public.profiles p
  join public.organizations o on o.id = p.org_id
  left join public.user_roles r on r.user_id = p.user_id
  where p.user_id = auth.uid()
$$;

revoke execute on function public.current_user_org_id(), public.current_user_role(),
  public.has_role(public.app_role), public.has_permission(text), public.user_in_my_org(uuid),
  public.get_my_access() from public, anon;
grant execute on function public.current_user_org_id(), public.current_user_role(),
  public.has_role(public.app_role), public.has_permission(text), public.user_in_my_org(uuid),
  public.get_my_access() to authenticated, service_role;

-- RLS ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_permission_overrides enable row level security;

revoke all on public.organizations, public.profiles, public.user_roles, public.permissions,
  public.role_permissions, public.user_permission_overrides from anon;

create policy organizations_select on public.organizations for select to authenticated
  using (id = (select public.current_user_org_id()));
create policy organizations_update on public.organizations for update to authenticated
  using (id = (select public.current_user_org_id()) and (select public.has_permission('settings.manage')))
  with check (id = (select public.current_user_org_id()));

create policy profiles_select on public.profiles for select to authenticated
  using (
    org_id = (select public.current_user_org_id())
    and (user_id = (select auth.uid()) or (select public.has_permission('users.view')))
  );
-- Self-service: only display_name (column privilege below). Admin changes go through RPCs (Phase 2).
create policy profiles_update_self on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
revoke insert, update, delete on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or ((select public.has_permission('users.view')) and public.user_in_my_org(user_id)));
revoke insert, update, delete on public.user_roles from authenticated;

create policy permissions_select on public.permissions for select to authenticated using (true);
revoke insert, update, delete on public.permissions from authenticated;

create policy role_permissions_select on public.role_permissions for select to authenticated using (true);
revoke insert, update, delete on public.role_permissions from authenticated;

create policy user_permission_overrides_select on public.user_permission_overrides for select to authenticated
  using (user_id = (select auth.uid()) or ((select public.has_permission('users.view')) and public.user_in_my_org(user_id)));
revoke insert, update, delete on public.user_permission_overrides from authenticated;

-- Core permission catalogue + role defaults -------------------------------------
insert into public.permissions (key, module_key, description) values
  ('settings.view',   'core', 'Voir les paramètres'),
  ('settings.manage', 'core', 'Modifier les paramètres de la clinique'),
  ('users.view',      'core', 'Voir les utilisateurs'),
  ('users.manage',    'core', 'Inviter et gérer les utilisateurs'),
  ('modules.manage',  'core', 'Activer ou désactiver des modules'),
  ('audit.view',      'core', 'Consulter le journal d''audit');

insert into public.role_permissions (role, permission_key) values
  ('admin', 'settings.view'), ('admin', 'settings.manage'), ('admin', 'users.view'),
  ('admin', 'users.manage'), ('admin', 'modules.manage'), ('admin', 'audit.view'),
  ('staff', 'settings.view'), ('staff', 'users.view');
```

**Step 4: Run** — `supabase db reset && supabase test db` → PASS (19 tests).

**Step 5: Commit**

```bash
git add supabase/migrations supabase/tests
git commit -m "feat(db): core access schema — orgs, profiles, roles, permissions, helpers"
```

### Task 1.8: Generic audit log (TDD)

**Files:**
- Create: `supabase/tests/database/002_core_audit.test.sql`
- Create: `supabase/migrations/20261006140623_core_audit.sql`

**Step 1: Write the failing test** `supabase/tests/database/002_core_audit.test.sql`

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test');
insert into public.user_roles (user_id, role) values ('a0000000-0000-0000-0000-000000000001', 'admin');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('app.audit_source', 'pgtap', true);

update public.organizations set name = 'Clinique A' where id = 'b0000000-0000-0000-0000-00000000000a';

select results_eq(
  $$ select action, source, actor_role from public.audit_log where table_name = 'organizations' and action = 'update' $$,
  $$ values ('update'::text, 'pgtap'::text, 'admin'::text) $$,
  'update is logged with actor role and source');
select is(
  (select changed_fields -> 'name' ->> 'after' from public.audit_log where table_name = 'organizations' and action = 'update'),
  'Clinique A', 'changed_fields holds before/after');
select ok(
  (select not (changed_fields ? 'updated_at') from public.audit_log where table_name = 'organizations' and action = 'update'),
  'updated_at noise is not logged');
select is(
  (select org_id from public.audit_log where table_name = 'profiles' limit 1),
  'b0000000-0000-0000-0000-00000000000a'::uuid, 'org_id is captured');
select throws_ok($$ delete from public.audit_log $$, '42501', null, 'audit log is append-only for clients');

select * from finish();
rollback;
```

**Step 2: Run** — `supabase test db` → FAIL (relation `public.audit_log` does not exist).

**Step 3: Write `supabase/migrations/20261006140623_core_audit.sql`**

```sql
-- Generic append-only audit log (design §4.4), ported from PS Hub fn_production_audit_trigger.

create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid references public.organizations(id),
  table_name text not null,
  record_id text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  changed_fields jsonb,
  actor_id uuid,
  actor_role text,
  source text not null default 'unknown',
  created_at timestamptz not null default now()
);
create index audit_log_record_idx on public.audit_log (table_name, record_id);
create index audit_log_org_created_idx on public.audit_log (org_id, created_at desc);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon;
revoke insert, update, delete, truncate on public.audit_log from authenticated;
create policy audit_log_select on public.audit_log for select to authenticated
  using (org_id = (select public.current_user_org_id()) and (select public.has_permission('audit.view')));

create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_changed jsonb;
  v_actor uuid := auth.uid();
  v_role text;
  v_org uuid;
begin
  select r.role::text into v_role from public.user_roles r where r.user_id = v_actor;

  v_org := case when tg_table_name = 'organizations' then (v_row ->> 'id')::uuid
                else (v_row ->> 'org_id')::uuid end;
  if v_org is null and v_row ? 'user_id' then
    select p.org_id into v_org from public.profiles p where p.user_id = (v_row ->> 'user_id')::uuid;
  end if;

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(o.key, jsonb_build_object('before', o.value, 'after', n.value))
      into v_changed
      from jsonb_each(to_jsonb(old)) o
      join jsonb_each(to_jsonb(new)) n using (key)
     where o.value is distinct from n.value and o.key <> 'updated_at';
    if v_changed is null then
      return new;
    end if;
  else
    v_changed := v_row;
  end if;

  insert into public.audit_log (org_id, table_name, record_id, action, changed_fields, actor_id, actor_role, source)
  values (
    v_org,
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'user_id', v_row ->> 'key', v_row ->> 'module_key', 'n/a'),
    lower(tg_op),
    v_changed,
    v_actor,
    v_role,
    coalesce(nullif(current_setting('app.audit_source', true), ''), 'unknown')
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger organizations_audit after insert or update or delete on public.organizations
  for each row execute function public.audit_trigger();
create trigger profiles_audit after insert or update or delete on public.profiles
  for each row execute function public.audit_trigger();
create trigger user_roles_audit after insert or update or delete on public.user_roles
  for each row execute function public.audit_trigger();
create trigger user_permission_overrides_audit after insert or update or delete on public.user_permission_overrides
  for each row execute function public.audit_trigger();
```

**Step 4: Run** — `supabase db reset && supabase test db` → PASS (both files).

**Step 5: Commit**

```bash
git add supabase/migrations supabase/tests
git commit -m "feat(db): generic append-only audit log trigger"
```

### Task 1.9: Modules, module settings and secrets (TDD)

**Files:**
- Create: `supabase/tests/database/003_core_modules_secrets.test.sql`
- Create: `supabase/migrations/20261006140741_core_modules_secrets.sql`
- Create: `supabase/migrations/20261006140859_professionnels_module.sql`

**Step 1: Write the failing test** `supabase/tests/database/003_core_modules_secrets.test.sql`

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Staff A', 'staff@a.test');
insert into public.user_roles (user_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'staff');
-- A test module that depends on professionnels.
insert into public.modules (key, name, depends_on) values ('test_child', 'Test enfant', array['professionnels']);

set local role authenticated;

-- Admin ----------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok(not public.module_enabled('professionnels'), 'modules start disabled');
select throws_ok($$ select public.set_module_enabled('test_child', true) $$, 'P0001', null, 'cannot enable a module before its dependency');
select lives_ok($$ select public.set_module_enabled('professionnels', true) $$, 'admin enables professionnels');
select ok(public.module_enabled('professionnels'), 'module_enabled reflects the change');
select lives_ok($$ select public.set_module_enabled('test_child', true) $$, 'dependent module can now be enabled');
select throws_ok($$ select public.set_module_enabled('professionnels', false) $$, 'P0001', null, 'cannot disable a module others depend on');
select lives_ok($$ select public.set_org_secret('documenso_api_key', 'secret-value') $$, 'admin stores a secret');
select results_eq($$ select key from public.list_org_secret_keys() $$, array['documenso_api_key'], 'secret key is listed, value is not');
select results_eq($$ select count(*)::int from public.org_secrets $$, array[0], 'secrets table is invisible to clients');
select throws_ok($$ select public.get_org_secret('b0000000-0000-0000-0000-00000000000a', 'documenso_api_key') $$, '42501', null, 'clients cannot read secret values');

-- Staff ----------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.set_module_enabled('test_child', false) $$, '42501', null, 'staff cannot toggle modules');

-- Service role (edge functions) ----------------------------------------------
reset role;
select is(public.get_org_secret('b0000000-0000-0000-0000-00000000000a', 'documenso_api_key'), 'secret-value', 'server side can read the secret');

select * from finish();
rollback;
```

**Step 2: Run** — `supabase test db` → FAIL (relation `public.modules` does not exist).

**Step 3: Write `supabase/migrations/20261006140741_core_modules_secrets.sql`**

```sql
-- Module registry, per-module settings and Vault-backed secrets (design §3).

create table public.modules (
  key text primary key check (key ~ '^[a-z_]+$'),
  name text not null,
  depends_on text[] not null default '{}'
);

create table public.org_modules (
  org_id uuid not null references public.organizations(id) on delete cascade,
  module_key text not null references public.modules(key),
  enabled boolean not null default false,
  enabled_at timestamptz,
  enabled_by uuid references auth.users(id),
  primary key (org_id, module_key)
);

create table public.org_module_settings (
  org_id uuid not null references public.organizations(id) on delete cascade,
  module_key text not null references public.modules(key),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (org_id, module_key)
);
create trigger org_module_settings_set_updated_at before update on public.org_module_settings
  for each row execute function public.set_updated_at();

create table public.org_secrets (
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  vault_secret_id uuid not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (org_id, key)
);

alter table public.modules enable row level security;
alter table public.org_modules enable row level security;
alter table public.org_module_settings enable row level security;
alter table public.org_secrets enable row level security;

revoke all on public.modules, public.org_modules, public.org_module_settings, public.org_secrets from anon;
revoke insert, update, delete on public.modules, public.org_modules, public.org_module_settings from authenticated;
revoke all on public.org_secrets from authenticated;

create policy modules_select on public.modules for select to authenticated using (true);
create policy org_modules_select on public.org_modules for select to authenticated
  using (org_id = (select public.current_user_org_id()));
create policy org_module_settings_select on public.org_module_settings for select to authenticated
  using (org_id = (select public.current_user_org_id()) and (select public.has_permission('settings.view')));
-- org_secrets: no policies on purpose — only SECURITY DEFINER functions touch it.

create or replace function public.module_enabled(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_modules om
    where om.org_id = public.current_user_org_id() and om.module_key = p_key and om.enabled
  )
$$;

create or replace function public.set_module_enabled(p_key text, p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := public.current_user_org_id();
  v_blockers text[];
begin
  if not public.has_permission('modules.manage') then
    raise exception 'Permission refusée : modules.manage' using errcode = '42501';
  end if;
  if not exists (select 1 from public.modules where key = p_key) then
    raise exception 'Module inconnu : %', p_key using errcode = '22023';
  end if;

  if p_enabled then
    select array_agg(dep) into v_blockers
      from public.modules m, unnest(m.depends_on) dep
     where m.key = p_key
       and not exists (select 1 from public.org_modules om
                        where om.org_id = v_org and om.module_key = dep and om.enabled);
    if v_blockers is not null then
      raise exception 'Activez d''abord : %', array_to_string(v_blockers, ', ') using errcode = 'P0001';
    end if;
  else
    select array_agg(m.key) into v_blockers
      from public.modules m
      join public.org_modules om on om.module_key = m.key and om.org_id = v_org and om.enabled
     where p_key = any (m.depends_on);
    if v_blockers is not null then
      raise exception 'Désactivez d''abord : %', array_to_string(v_blockers, ', ') using errcode = 'P0001';
    end if;
  end if;

  insert into public.org_modules (org_id, module_key, enabled, enabled_at, enabled_by)
  values (v_org, p_key, p_enabled, case when p_enabled then now() end, auth.uid())
  on conflict (org_id, module_key) do update
    set enabled = excluded.enabled, enabled_at = excluded.enabled_at, enabled_by = excluded.enabled_by;
end;
$$;

create or replace function public.set_org_secret(p_key text, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := public.current_user_org_id();
  v_id uuid;
begin
  if not public.has_permission('settings.manage') then
    raise exception 'Permission refusée : settings.manage' using errcode = '42501';
  end if;
  if p_key !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'Clé invalide : %', p_key using errcode = '22023';
  end if;
  if coalesce(length(p_value), 0) = 0 then
    raise exception 'La valeur ne peut pas être vide' using errcode = '22023';
  end if;

  select s.vault_secret_id into v_id from public.org_secrets s where s.org_id = v_org and s.key = p_key;
  if v_id is null then
    v_id := vault.create_secret(p_value, format('org:%s:%s', v_org, p_key));
    insert into public.org_secrets (org_id, key, vault_secret_id, updated_by)
    values (v_org, p_key, v_id, auth.uid());
  else
    perform vault.update_secret(v_id, p_value);
    update public.org_secrets set updated_at = now(), updated_by = auth.uid()
     where org_id = v_org and key = p_key;
  end if;
end;
$$;

create or replace function public.list_org_secret_keys()
returns table (key text, updated_at timestamptz) language sql stable security definer set search_path = '' as $$
  select s.key, s.updated_at from public.org_secrets s
  where s.org_id = public.current_user_org_id() and public.has_permission('settings.view')
  order by s.key
$$;

-- Server-side only (edge functions with the service role).
create or replace function public.get_org_secret(p_org_id uuid, p_key text)
returns text language sql stable security definer set search_path = '' as $$
  select ds.decrypted_secret
  from public.org_secrets s
  join vault.decrypted_secrets ds on ds.id = s.vault_secret_id
  where s.org_id = p_org_id and s.key = p_key
$$;

revoke execute on function public.module_enabled(text), public.set_module_enabled(text, boolean),
  public.set_org_secret(text, text), public.list_org_secret_keys(), public.get_org_secret(uuid, text)
  from public, anon;
grant execute on function public.module_enabled(text), public.set_module_enabled(text, boolean),
  public.set_org_secret(text, text), public.list_org_secret_keys() to authenticated, service_role;
revoke execute on function public.get_org_secret(uuid, text) from authenticated;
grant execute on function public.get_org_secret(uuid, text) to service_role;

create trigger org_modules_audit after insert or update or delete on public.org_modules
  for each row execute function public.audit_trigger();
create trigger org_module_settings_audit after insert or update or delete on public.org_module_settings
  for each row execute function public.audit_trigger();
create trigger org_secrets_audit after insert or update or delete on public.org_secrets
  for each row execute function public.audit_trigger();
```

**Step 4: Write `supabase/migrations/20261006140859_professionnels_module.sql`** (registers module 1; its tables come in Phase 4)

```sql
-- Register the Professionnels module (design §5). Tables arrive in Phase 4.
insert into public.modules (key, name, depends_on) values ('professionnels', 'Professionnels', '{}');

insert into public.permissions (key, module_key, description) values
  ('professionals.view', 'professionnels', 'Voir les professionnels');

insert into public.role_permissions (role, permission_key) values
  ('admin', 'professionals.view'),
  ('staff', 'professionals.view');
```

**Step 5: Run** — `supabase db reset && supabase test db` → PASS (3 files).

**Step 6: Commit**

```bash
git add supabase/migrations supabase/tests
git commit -m "feat(db): module registry, module settings, Vault secrets; register professionnels"
```

### Task 1.10: Local seed and generated types

**Files:**
- Create: `supabase/seed.sql`
- Create: `src/core/supabase/database.types.ts` (generated), `src/core/supabase/client.ts`

**Step 1: Write `supabase/seed.sql`** — local only (it is never applied to staging; Task 1.21 uses `--no-seed`).

```sql
-- LOCAL DEVELOPMENT SEED ONLY. Never run against staging or production.
-- Test logins (password for all three: see the constant below): admin@mana.test, staff@mana.test, provider@mana.test

insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-000000000001', 'Clinique MANA (local)');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
  email_change_token_new, email_change)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u.email,
  extensions.crypt('ManaLocal-2026', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
from (values
  ('11111111-1111-1111-1111-111111111111'::uuid, 'admin@mana.test'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'staff@mana.test'),
  ('33333333-3333-3333-3333-333333333333'::uuid, 'provider@mana.test')
) as u(id, email);

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), now(), now(), now()
from auth.users u where u.email like '%@mana.test';

insert into public.profiles (user_id, org_id, display_name, email) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'Admin Local',    'admin@mana.test'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001', 'Adjointe Locale', 'staff@mana.test'),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000001', 'Pro Local',      'provider@mana.test');

insert into public.user_roles (user_id, role) values
  ('11111111-1111-1111-1111-111111111111', 'admin'),
  ('22222222-2222-2222-2222-222222222222', 'staff'),
  ('33333333-3333-3333-3333-333333333333', 'provider');

insert into public.org_modules (org_id, module_key, enabled, enabled_at) values
  ('00000000-0000-0000-0000-000000000001', 'professionnels', true, now());
```

**Step 2: Apply and generate types**

```bash
supabase db reset
mkdir -p src/core/supabase
npm run db:types
grep -c "get_my_access" src/core/supabase/database.types.ts
```

Expected: reset succeeds; grep count ≥ 1.

**Step 3: Create `src/core/supabase/client.ts`**

```ts
import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env.local')
}

export const supabase = createClient<Database>(url, anonKey)
```

**Step 4: Create `.env.local`** (not committed) with the URL and anon key printed by `supabase status`.

**Step 5: Commit**

```bash
git add supabase/seed.sql src/core/supabase
git commit -m "feat(db): local seed with three test roles; typed supabase client"
```

### Task 1.11: Access model (pure logic, TDD)

**Files:**
- Create: `src/core/access/access.ts`, `src/core/access/access.test.ts`, `src/core/access/api.ts`

**Step 1: Write the failing test** `src/core/access/access.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { can, parseAccess, type Access } from './access'

const base = {
  user_id: '22222222-2222-2222-2222-222222222222',
  org_id: '00000000-0000-0000-0000-000000000001',
  org_name: 'Clinique MANA',
  org_timezone: 'America/Toronto',
  display_name: 'Adjointe',
  email: 'staff@mana.test',
  status: 'active',
  role: 'staff',
  permissions: ['settings.view', 'professionals.view'],
}

describe('parseAccess', () => {
  it('reports a missing profile', () => {
    expect(parseAccess(null)).toEqual({ problem: 'profile_not_found' })
  })

  it('reports a disabled profile', () => {
    expect(parseAccess({ ...base, status: 'disabled' })).toEqual({ problem: 'profile_disabled' })
  })

  it('reports a profile without role', () => {
    expect(parseAccess({ ...base, role: null })).toEqual({ problem: 'no_role' })
  })

  it('returns access for an active profile with a role', () => {
    const result = parseAccess(base)
    expect('access' in result && result.access.role).toBe('staff')
  })

  it('throws on an unexpected payload', () => {
    expect(() => parseAccess({ hello: 'world' })).toThrow()
  })
})

describe('can', () => {
  const access = base as Access

  it('is true for a held permission', () => {
    expect(can(access, 'settings.view')).toBe(true)
  })

  it('is false for a missing permission', () => {
    expect(can(access, 'settings.manage')).toBe(false)
  })

  it('is false without access', () => {
    expect(can(null, 'settings.view')).toBe(false)
  })
})
```

**Step 2: Run** — `npx vitest run src/core/access` → FAIL (module not found).

**Step 3: Write `src/core/access/access.ts`**

```ts
import { z } from 'zod'

export const appRoleSchema = z.enum(['admin', 'staff', 'provider'])
export type AppRole = z.infer<typeof appRoleSchema>

// Ids are plain strings: seeded/test UUIDs are not RFC-versioned.
const accessSchema = z.object({
  user_id: z.string(),
  org_id: z.string(),
  org_name: z.string(),
  org_timezone: z.string(),
  display_name: z.string(),
  email: z.string(),
  status: z.enum(['active', 'disabled']),
  role: appRoleSchema.nullable(),
  permissions: z.array(z.string()),
})

export type Access = z.infer<typeof accessSchema> & { role: AppRole }
export type AccessProblem = 'profile_not_found' | 'profile_disabled' | 'no_role'
export type AccessResult = { access: Access } | { problem: AccessProblem }

/** Interprets the get_my_access() RPC payload. Throws if the shape is unexpected. */
export function parseAccess(raw: unknown): AccessResult {
  if (raw === null || raw === undefined) return { problem: 'profile_not_found' }
  const parsed = accessSchema.parse(raw)
  if (parsed.status === 'disabled') return { problem: 'profile_disabled' }
  if (parsed.role === null) return { problem: 'no_role' }
  return { access: parsed as Access }
}

export function can(access: Access | null, permission: string): boolean {
  return access?.permissions.includes(permission) ?? false
}
```

**Step 4: Write `src/core/access/api.ts`**

```ts
import { supabase } from '@/core/supabase/client'
import { parseAccess, type AccessResult } from './access'

export async function fetchMyAccess(): Promise<AccessResult> {
  const { data, error } = await supabase.rpc('get_my_access')
  if (error) throw error
  return parseAccess(data)
}
```

**Step 5: Run** — `npx vitest run src/core/access` → PASS (8 tests).

**Step 6: Commit**

```bash
git add src/core/access
git commit -m "feat(core): access model parsing and permission checks"
```

### Task 1.12: Auth and access providers

**Files:**
- Create: `src/core/auth/AuthProvider.tsx`, `src/core/auth/redirect.ts`, `src/core/auth/redirect.test.ts`
- Create: `src/core/access/AccessProvider.tsx`

**Step 1: Write the failing test** `src/core/auth/redirect.test.ts` (prevents open redirects after login)

```ts
import { describe, expect, it } from 'vitest'
import { safeRedirect } from './redirect'

describe('safeRedirect', () => {
  it('keeps internal paths', () => {
    expect(safeRedirect('/professionnels?x=1')).toBe('/professionnels?x=1')
  })

  it.each([null, '', 'https://evil.test', '//evil.test', 'javascript:alert(1)'])('falls back to /accueil for %s', (value) => {
    expect(safeRedirect(value)).toBe('/accueil')
  })
})
```

**Step 2: Run** — `npx vitest run src/core/auth` → FAIL.

**Step 3: Write `src/core/auth/redirect.ts`**

```ts
export function safeRedirect(target: string | null): string {
  if (target && target.startsWith('/') && !target.startsWith('//')) return target
  return '/accueil'
}
```

**Step 4: Run** — `npx vitest run src/core/auth` → PASS.

**Step 5: Write `src/core/auth/AuthProvider.tsx`**

```tsx
// SUPABASE_ALLOWED: the auth provider owns the Supabase auth session.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/core/supabase/client'

export type AuthErrorCode = 'invalid_credentials' | 'rate_limited' | 'unknown'

export interface AuthContextValue {
  session: Session | null
  isLoading: boolean
  signInWithPassword: (email: string, password: string) => Promise<AuthErrorCode | null>
  sendMagicLink: (email: string) => Promise<AuthErrorCode | null>
  sendPasswordReset: (email: string) => Promise<AuthErrorCode | null>
  updatePassword: (password: string) => Promise<AuthErrorCode | null>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function toCode(error: { message: string; status?: number } | null): AuthErrorCode | null {
  if (!error) return null
  if (error.status === 429) return 'rate_limited'
  if (/invalid login credentials/i.test(error.message)) return 'invalid_credentials'
  return 'unknown'
}

const absolute = (path: string) => `${window.location.origin}${path}`

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setIsLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isLoading,
      signInWithPassword: async (email, password) =>
        toCode((await supabase.auth.signInWithPassword({ email, password })).error),
      // shouldCreateUser: false — accounts only exist through invitations.
      sendMagicLink: async (email) =>
        toCode((await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: absolute('/accueil') } })).error),
      sendPasswordReset: async (email) =>
        toCode((await supabase.auth.resetPasswordForEmail(email, { redirectTo: absolute('/reinitialiser-mot-de-passe') })).error),
      updatePassword: async (password) => toCode((await supabase.auth.updateUser({ password })).error),
      signOut: async () => {
        await supabase.auth.signOut()
      },
    }),
    [session, isLoading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
```

**Step 6: Write `src/core/access/AccessProvider.tsx`**

```tsx
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/core/auth/AuthProvider'
import { setClinicTimezone } from '@/shared/lib/timezone'
import { can, type Access, type AccessProblem } from './access'
import { fetchMyAccess } from './api'

export type AccessStatus = 'idle' | 'loading' | 'ready' | 'denied' | 'error'

export interface AccessContextValue {
  status: AccessStatus
  access: Access | null
  problem: AccessProblem | null
  can: (permission: string) => boolean
  reload: () => void
}

export const accessKeys = {
  all: ['access'] as const,
  me: (userId: string) => [...accessKeys.all, 'me', userId] as const,
}

export const AccessContext = createContext<AccessContextValue | undefined>(undefined)

export function AccessProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const userId = session?.user.id
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: accessKeys.me(userId ?? 'anonymous'),
    queryFn: fetchMyAccess,
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const access = data && 'access' in data ? data.access : null
  const problem = data && 'problem' in data ? data.problem : null

  useEffect(() => {
    if (access) setClinicTimezone(access.org_timezone)
  }, [access])

  // Never degrade silently: a failed load is an error state with a retry, not "no permissions".
  const status: AccessStatus = !userId ? 'idle' : isError ? 'error' : isPending ? 'loading' : problem ? 'denied' : 'ready'

  const value = useMemo<AccessContextValue>(
    () => ({ status, access, problem, can: (permission) => can(access, permission), reload: () => void refetch() }),
    [status, access, problem, refetch],
  )

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>
}

export function useAccess(): AccessContextValue {
  const context = useContext(AccessContext)
  if (!context) throw new Error('useAccess must be used within AccessProvider')
  return context
}
```

**Step 7: Verify** — `npm run typecheck && npm run lint:supabase` → both pass (AuthProvider is exempted by its comment).

**Step 8: Commit**

```bash
git add src/core/auth src/core/access
git commit -m "feat(core): auth and access providers (fail-closed, timezone from org)"
```

### Task 1.13: Route guards (TDD)

**Files:**
- Create: `src/core/access/guards.tsx`, `src/core/access/guards.test.tsx`, `src/test/contexts.tsx`

**Step 1: Create the test helper `src/test/contexts.tsx`**

```tsx
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { AuthContext, type AuthContextValue } from '@/core/auth/AuthProvider'
import { AccessContext, type AccessContextValue } from '@/core/access/AccessProvider'
import type { Access } from '@/core/access/access'

export const testAccess: Access = {
  user_id: 'u1', org_id: 'o1', org_name: 'Clinique MANA', org_timezone: 'America/Toronto',
  display_name: 'Test', email: 't@mana.test', status: 'active', role: 'staff', permissions: ['settings.view'],
}

export function renderWithContexts(
  ui: ReactNode,
  { auth = {}, access = {}, path = '/' }: { auth?: Partial<AuthContextValue>; access?: Partial<AccessContextValue>; path?: string } = {},
) {
  const authValue: AuthContextValue = {
    session: { user: { id: 'u1' } } as Session,
    isLoading: false,
    signInWithPassword: async () => null,
    sendMagicLink: async () => null,
    sendPasswordReset: async () => null,
    updatePassword: async () => null,
    signOut: async () => {},
    ...auth,
  }
  const accessValue: AccessContextValue = {
    status: 'ready',
    access: testAccess,
    problem: null,
    can: (p) => testAccess.permissions.includes(p),
    reload: () => {},
    ...access,
  }
  return (
    <AuthContext.Provider value={authValue}>
      <AccessContext.Provider value={accessValue}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/connexion" element={<p>LOGIN PAGE</p>} />
            <Route path="*" element={ui} />
          </Routes>
        </MemoryRouter>
      </AccessContext.Provider>
    </AuthContext.Provider>
  )
}
```

**Step 2: Write the failing test** `src/core/access/guards.test.tsx`

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { RequireAccess, RequireAuth } from './guards'

describe('RequireAuth', () => {
  it('redirects to login when signed out', () => {
    render(renderWithContexts(<RequireAuth><p>SECRET</p></RequireAuth>, { auth: { session: null }, path: '/professionnels' }))
    expect(screen.getByText('LOGIN PAGE')).toBeInTheDocument()
  })

  it('shows a retry screen when access fails to load', async () => {
    const reload = vi.fn()
    render(renderWithContexts(<RequireAuth><p>SECRET</p></RequireAuth>, { access: { status: 'error', reload } }))
    await userEvent.click(screen.getByRole('button', { name: t('common.retry') }))
    expect(reload).toHaveBeenCalled()
    expect(screen.queryByText('SECRET')).not.toBeInTheDocument()
  })

  it('explains a disabled account', () => {
    render(renderWithContexts(<RequireAuth><p>SECRET</p></RequireAuth>, { access: { status: 'denied', problem: 'profile_disabled' } }))
    expect(screen.getByText(t('access.denied.profile_disabled'))).toBeInTheDocument()
  })

  it('renders children when ready', () => {
    render(renderWithContexts(<RequireAuth><p>SECRET</p></RequireAuth>))
    expect(screen.getByText('SECRET')).toBeInTheDocument()
  })
})

describe('RequireAccess', () => {
  it('renders children with the permission', () => {
    render(renderWithContexts(<RequireAccess permission="settings.view"><p>SETTINGS</p></RequireAccess>))
    expect(screen.getByText('SETTINGS')).toBeInTheDocument()
  })

  it('shows forbidden without the permission', () => {
    render(renderWithContexts(<RequireAccess permission="settings.manage"><p>SETTINGS</p></RequireAccess>))
    expect(screen.getByText(t('access.forbidden.title'))).toBeInTheDocument()
  })
})
```

**Step 3: Run** — `npx vitest run src/core/access/guards.test.tsx` → FAIL (module not found).

**Step 4: Write `src/core/access/guards.tsx`**

```tsx
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { t } from '@/i18n'
import { useAuth } from '@/core/auth/AuthProvider'
import { FullPageMessage } from '@/shared/components/FullPageMessage'
import { Button } from '@/shared/ui/button'
import { useAccess } from './AccessProvider'

function Loading() {
  return <FullPageMessage title={t('common.loading')} />
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, isLoading, signOut } = useAuth()
  const { status, problem, reload } = useAccess()
  const location = useLocation()

  if (isLoading) return <Loading />
  if (!session) {
    const redirect = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/connexion?redirect=${redirect}`} replace />
  }
  if (status === 'error') {
    return (
      <FullPageMessage
        title={t('access.error.title')}
        body={t('access.error.body')}
        action={<Button onClick={reload}>{t('common.retry')}</Button>}
      />
    )
  }
  if (status === 'denied' && problem) {
    return (
      <FullPageMessage
        title={t(`access.denied.${problem}`)}
        action={<Button variant="outline" onClick={() => void signOut()}>{t('access.denied.signOut')}</Button>}
      />
    )
  }
  if (status !== 'ready') return <Loading />
  return <>{children}</>
}

export function RequireAccess({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useAccess()
  if (!can(permission)) return <FullPageMessage title={t('access.forbidden.title')} body={t('access.forbidden.body')} />
  return <>{children}</>
}
```

**Step 5: Run** — `npx vitest run src/core/access` → PASS (all access tests).

**Step 6: Commit**

```bash
git add src/core/access src/test
git commit -m "feat(core): RequireAuth / RequireAccess route guards"
```

### Task 1.14: Module registry types and resolution (TDD)

**Files:**
- Create: `src/core/modules/types.ts`, `src/core/modules/resolve.ts`, `src/core/modules/resolve.test.ts`, `src/core/modules/api.ts`, `src/core/modules/hooks.ts`

**Step 1: Write `src/core/modules/types.ts`**

```ts
import type { ComponentType, LazyExoticComponent } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { TranslationKey } from '@/i18n'

export interface ModuleRoute {
  /** Path relative to the app root, e.g. 'professionnels' or 'professionnels/:id'. */
  path: string
  component: LazyExoticComponent<ComponentType>
  permission: string
}

export interface ModuleNavItem {
  path: string
  labelKey: TranslationKey
  icon: LucideIcon
  permission: string
  /** Lower comes first in the menu. */
  order: number
}

export type SettingsGroup = 'clinique' | 'plateforme' | 'modules' | 'compte'

export interface SettingsSection {
  id: string
  labelKey: TranslationKey
  icon: LucideIcon
  permission: string
  group: SettingsGroup
  component: LazyExoticComponent<ComponentType>
}

export interface ModuleManifest {
  /** Must match public.modules.key. */
  key: string
  labelKey: TranslationKey
  dependsOn: string[]
  nav?: ModuleNavItem
  routes: ModuleRoute[]
  settingsSections: SettingsSection[]
}
```

**Step 2: Write the failing test** `src/core/modules/resolve.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import type { ModuleManifest } from './types'
import { resolveEnabledModules } from './resolve'

const manifest = (key: string, dependsOn: string[] = []): ModuleManifest => ({
  key, dependsOn, labelKey: 'app.name', routes: [], settingsSections: [],
})

const keys = (modules: ModuleManifest[]) => modules.map((m) => m.key)

describe('resolveEnabledModules', () => {
  const all = [manifest('a'), manifest('b', ['a']), manifest('c', ['b']), manifest('x', ['y']), manifest('y', ['x'])]

  it('keeps enabled modules without dependencies', () => {
    expect(keys(resolveEnabledModules(all, new Set(['a'])))).toEqual(['a'])
  })

  it('drops disabled modules', () => {
    expect(keys(resolveEnabledModules(all, new Set()))).toEqual([])
  })

  it('drops a module whose dependency is disabled', () => {
    expect(keys(resolveEnabledModules(all, new Set(['b'])))).toEqual([])
  })

  it('resolves transitive dependencies', () => {
    expect(keys(resolveEnabledModules(all, new Set(['a', 'b', 'c'])))).toEqual(['a', 'b', 'c'])
    expect(keys(resolveEnabledModules(all, new Set(['a', 'c'])))).toEqual(['a'])
  })

  it('drops dependency cycles', () => {
    expect(keys(resolveEnabledModules(all, new Set(['x', 'y'])))).toEqual([])
  })

  it('ignores enabled keys that have no manifest', () => {
    expect(keys(resolveEnabledModules(all, new Set(['a', 'ghost'])))).toEqual(['a'])
  })
})
```

**Step 3: Run** — `npx vitest run src/core/modules` → FAIL.

**Step 4: Write `src/core/modules/resolve.ts`**

```ts
import type { ModuleManifest } from './types'

/** Returns the manifests that are enabled and whose dependencies are all enabled too. */
export function resolveEnabledModules(manifests: ModuleManifest[], enabledKeys: ReadonlySet<string>): ModuleManifest[] {
  const byKey = new Map(manifests.map((m) => [m.key, m]))
  const memo = new Map<string, boolean>()

  const isActive = (key: string, visiting: Set<string>): boolean => {
    const cached = memo.get(key)
    if (cached !== undefined) return cached
    const manifest = byKey.get(key)
    if (!manifest || !enabledKeys.has(key) || visiting.has(key)) return false
    visiting.add(key)
    const active = manifest.dependsOn.every((dep) => isActive(dep, visiting))
    visiting.delete(key)
    memo.set(key, active)
    return active
  }

  return manifests.filter((m) => isActive(m.key, new Set()))
}
```

**Step 5: Run** — `npx vitest run src/core/modules` → PASS (6 tests).

**Step 6: Write `src/core/modules/api.ts`**

```ts
import { supabase } from '@/core/supabase/client'

export interface ModuleRow {
  key: string
  name: string
  depends_on: string[]
  enabled: boolean
}

export async function fetchEnabledModuleKeys(): Promise<string[]> {
  const { data, error } = await supabase.from('org_modules').select('module_key').eq('enabled', true)
  if (error) throw error
  return data.map((row) => row.module_key)
}

export async function fetchModules(): Promise<ModuleRow[]> {
  const [modules, orgModules] = await Promise.all([
    supabase.from('modules').select('key, name, depends_on').order('name'),
    supabase.from('org_modules').select('module_key, enabled'),
  ])
  if (modules.error) throw modules.error
  if (orgModules.error) throw orgModules.error
  const enabled = new Set(orgModules.data.filter((m) => m.enabled).map((m) => m.module_key))
  return modules.data.map((m) => ({ ...m, enabled: enabled.has(m.key) }))
}

export async function setModuleEnabled(key: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_module_enabled', { p_key: key, p_enabled: enabled })
  if (error) throw error
}
```

**Step 7: Write `src/core/modules/hooks.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchEnabledModuleKeys, fetchModules, setModuleEnabled } from './api'

export const moduleKeys = {
  all: ['modules'] as const,
  enabled: () => [...moduleKeys.all, 'enabled'] as const,
  list: () => [...moduleKeys.all, 'list'] as const,
}

export function useEnabledModuleKeys() {
  return useQuery({ queryKey: moduleKeys.enabled(), queryFn: fetchEnabledModuleKeys })
}

export function useModules() {
  return useQuery({ queryKey: moduleKeys.list(), queryFn: fetchModules })
}

export function useSetModuleEnabled() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) => setModuleEnabled(key, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: moduleKeys.all }),
  })
}
```

**Step 8: Verify** — `npm run typecheck` → passes (types come from `database.types.ts`).

**Step 9: Commit**

```bash
git add src/core/modules
git commit -m "feat(core): module manifest types, dependency resolution and data hooks"
```

### Task 1.15: Settings shell + Modules section (TDD on visibility)

**Files:**
- Create: `src/core/settings/SettingsLayout.tsx`, `src/core/settings/SettingsLayout.test.tsx`, `src/core/settings/sections.ts`, `src/core/settings/pages/ModulesSettingsPage.tsx`

**Step 1: Write the failing test** `src/core/settings/SettingsLayout.test.tsx`

```tsx
import { lazy } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Blocks, Building2 } from 'lucide-react'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import type { SettingsSection } from '@/core/modules/types'
import { SettingsLayout } from './SettingsLayout'

const page = (text: string) => lazy(async () => ({ default: () => <p>{text}</p> }))

const sections: SettingsSection[] = [
  { id: 'modules', labelKey: 'settings.sections.modules', icon: Blocks, permission: 'modules.manage', group: 'plateforme', component: page('MODULES PAGE') },
  { id: 'visible', labelKey: 'settings.title', icon: Building2, permission: 'settings.view', group: 'clinique', component: page('VISIBLE PAGE') },
]

describe('SettingsLayout', () => {
  it('lists only sections the user can access and opens the first one', async () => {
    render(renderWithContexts(<SettingsLayout sections={sections} />, { path: '/parametres' }))
    expect(screen.queryByText(t('settings.sections.modules'))).not.toBeInTheDocument()
    expect(await screen.findByText('VISIBLE PAGE')).toBeInTheDocument()
  })

  it('shows an empty state when no section is accessible', () => {
    render(renderWithContexts(<SettingsLayout sections={sections} />, { path: '/parametres', access: { can: () => false } }))
    expect(screen.getByText(t('settings.empty'))).toBeInTheDocument()
  })
})
```

Note: `renderWithContexts` mounts the UI on `path="*"`, so `SettingsLayout` uses relative nested `<Routes>`; the test path `/parametres` resolves its index route.

**Step 2: Run** — `npx vitest run src/core/settings` → FAIL.

**Step 3: Write `src/core/settings/SettingsLayout.tsx`**

```tsx
import { createElement, Suspense } from 'react'
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/AccessProvider'
import type { SettingsGroup, SettingsSection } from '@/core/modules/types'
import { FullPageMessage } from '@/shared/components/FullPageMessage'
import { cn } from '@/shared/lib/utils'

const GROUP_ORDER: SettingsGroup[] = ['clinique', 'plateforme', 'modules', 'compte']

export function SettingsLayout({ sections }: { sections: SettingsSection[] }) {
  const { can } = useAccess()
  const visible = sections.filter((s) => can(s.permission))
  const first = visible[0]

  if (!first) return <FullPageMessage title={t('settings.title')} body={t('settings.empty')} />

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <nav className="md:w-56 md:shrink-0">
        <h1 className="mb-4 text-xl font-semibold">{t('settings.title')}</h1>
        {GROUP_ORDER.map((group) => {
          const items = visible.filter((s) => s.group === group)
          if (items.length === 0) return null
          return (
            <div key={group} className="mb-4">
              <p className="mb-1 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(`settings.groups.${group}`)}</p>
              {items.map((s) => (
                <NavLink
                  key={s.id}
                  to={s.id}
                  className={({ isActive }) =>
                    cn('flex items-center gap-2 rounded-md px-3 py-2 text-sm', isActive ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted')
                  }
                >
                  <s.icon className="h-4 w-4" />
                  {t(s.labelKey)}
                </NavLink>
              ))}
            </div>
          )
        })}
      </nav>
      <section className="min-w-0 flex-1">
        <Suspense fallback={<p className="text-sm text-muted-foreground">{t('common.loading')}</p>}>
          <Routes>
            <Route index element={<Navigate to={first.id} replace />} />
            {visible.map((s) => (
              <Route key={s.id} path={s.id} element={createElement(s.component)} />
            ))}
            <Route path="*" element={<FullPageMessage title={t('common.notFound.title')} body={t('common.notFound.body')} />} />
          </Routes>
        </Suspense>
      </section>
    </div>
  )
}
```

**Step 4: Run** — `npx vitest run src/core/settings` → PASS (2 tests). If the first test can't find the page because the relative `Navigate` resolves against `*`, change the test path to `/parametres/visible` and keep the visibility assertion — do not weaken the "hidden section" assertion.

**Step 5: Write `src/core/settings/pages/ModulesSettingsPage.tsx`**

```tsx
import { t } from '@/i18n'
import { useModules, useSetModuleEnabled } from '@/core/modules/hooks'
import { Switch } from '@/shared/ui/switch'
import { toast } from '@/shared/ui/sonner'

export function ModulesSettingsPage() {
  const { data: modules, isPending } = useModules()
  const setEnabled = useSetModuleEnabled()

  const handleToggle = (key: string, enabled: boolean) => {
    setEnabled.mutate(
      { key, enabled },
      {
        onSuccess: () => toast.success(t('settings.modules.saved')),
        onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.modules.error')),
      },
    )
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold">{t('settings.modules.title')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('settings.modules.description')}</p>
      {isPending ? (
        <p className="mt-6 text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : (
        <ul className="mt-6 divide-y divide-border rounded-lg border border-border">
          {modules?.map((m) => (
            <li key={m.key} className="flex items-center justify-between gap-4 p-4">
              <div>
                <p className="font-medium">{m.name}</p>
                {m.depends_on.length > 0 && (
                  <p className="text-xs text-muted-foreground">{t('settings.modules.dependsOn')} {m.depends_on.join(', ')}</p>
                )}
              </div>
              <Switch
                checked={m.enabled}
                disabled={setEnabled.isPending}
                onCheckedChange={(checked) => handleToggle(m.key, checked)}
                aria-label={m.name}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

**Step 6: Write `src/core/settings/sections.ts`**

```ts
import { lazy } from 'react'
import { Blocks } from 'lucide-react'
import type { SettingsSection } from '@/core/modules/types'

// Phase 2 adds: identité, fiscalité, signataire, banque, lieux, région, confidentialité,
// utilisateurs, courriels, signature électronique, intégrations, tâches planifiées, audit.
export const coreSettingsSections: SettingsSection[] = [
  {
    id: 'modules',
    labelKey: 'settings.sections.modules',
    icon: Blocks,
    permission: 'modules.manage',
    group: 'plateforme',
    component: lazy(() => import('./pages/ModulesSettingsPage').then((m) => ({ default: m.ModulesSettingsPage }))),
  },
]
```

**Step 7: Verify** — `npm run typecheck && npm run lint && npm run lint:supabase` → pass.

**Step 8: Commit**

```bash
git add src/core/settings
git commit -m "feat(core): settings shell built from sections, modules toggle page"
```

### Task 1.16: Auth pages

**Files:**
- Create: `src/core/auth/pages/AuthCard.tsx`, `LoginPage.tsx`, `ForgotPasswordPage.tsx`, `ResetPasswordPage.tsx`, `src/core/auth/pages/LoginPage.test.tsx`

**Step 1: Write the failing test** `src/core/auth/pages/LoginPage.test.tsx`

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { LoginPage } from './LoginPage'

describe('LoginPage', () => {
  it('signs in with email and password', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue(null)
    render(renderWithContexts(<LoginPage />, { auth: { session: null, signInWithPassword }, path: '/' }))
    await userEvent.type(screen.getByLabelText(t('auth.login.email')), 'admin@mana.test')
    await userEvent.type(screen.getByLabelText(t('auth.login.password')), 'x')
    await userEvent.click(screen.getByRole('button', { name: t('auth.login.submit') }))
    expect(signInWithPassword).toHaveBeenCalledWith('admin@mana.test', 'x')
  })

  it('shows the error for wrong credentials', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue('invalid_credentials')
    render(renderWithContexts(<LoginPage />, { auth: { session: null, signInWithPassword }, path: '/' }))
    await userEvent.type(screen.getByLabelText(t('auth.login.email')), 'admin@mana.test')
    await userEvent.type(screen.getByLabelText(t('auth.login.password')), 'bad')
    await userEvent.click(screen.getByRole('button', { name: t('auth.login.submit') }))
    expect(await screen.findByText(t('auth.errors.invalid_credentials'))).toBeInTheDocument()
  })

  it('sends a magic link without creating accounts', async () => {
    const sendMagicLink = vi.fn().mockResolvedValue(null)
    render(renderWithContexts(<LoginPage />, { auth: { session: null, sendMagicLink }, path: '/' }))
    await userEvent.type(screen.getByLabelText(t('auth.login.email')), 'admin@mana.test')
    await userEvent.click(screen.getByRole('button', { name: t('auth.login.magicLink') }))
    expect(sendMagicLink).toHaveBeenCalledWith('admin@mana.test')
    expect(await screen.findByText(t('auth.login.magicLinkSent'))).toBeInTheDocument()
  })
})
```

**Step 2: Run** — `npx vitest run src/core/auth/pages` → FAIL.

**Step 3: Write `src/core/auth/pages/AuthCard.tsx`**

```tsx
import type { ReactNode } from 'react'
import { t } from '@/i18n'

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-sm">
        <p className="text-sm font-medium text-muted-foreground">{t('app.name')}</p>
        <h1 className="mt-1 text-xl font-semibold">{title}</h1>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  )
}
```

**Step 4: Write `src/core/auth/pages/LoginPage.tsx`**

```tsx
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { t } from '@/i18n'
import { useAuth, type AuthErrorCode } from '@/core/auth/AuthProvider'
import { safeRedirect } from '@/core/auth/redirect'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { AuthCard } from './AuthCard'

const schema = z.object({
  email: z.email({ error: t('auth.errors.invalidEmail') }),
  password: z.string().min(1, { error: t('auth.errors.required') }),
})
type Values = z.infer<typeof schema>

export function LoginPage() {
  const { session, signInWithPassword, sendMagicLink } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState<AuthErrorCode | null>(null)
  const [magicSent, setMagicSent] = useState(false)
  const { register, handleSubmit, getValues, trigger, formState } = useForm<Values>({ resolver: zodResolver(schema) })
  const target = safeRedirect(params.get('redirect'))

  if (session) return <Navigate to={target} replace />

  const onSubmit = async ({ email, password }: Values) => {
    setError(null)
    const code = await signInWithPassword(email, password)
    if (code) setError(code)
    else navigate(target, { replace: true })
  }

  const onMagicLink = async () => {
    if (!(await trigger('email'))) return
    setError(null)
    const code = await sendMagicLink(getValues('email'))
    if (code) setError(code)
    else setMagicSent(true)
  }

  return (
    <AuthCard title={t('auth.login.title')}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="email">{t('auth.login.email')}</Label>
          <Input id="email" type="email" autoComplete="email" {...register('email')} />
          {formState.errors.email && <p className="text-xs text-destructive">{formState.errors.email.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">{t('auth.login.password')}</Label>
          <Input id="password" type="password" autoComplete="current-password" {...register('password')} />
          {formState.errors.password && <p className="text-xs text-destructive">{formState.errors.password.message}</p>}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{t(`auth.errors.${error}`)}</p>}
        {magicSent && <p role="status" className="text-sm text-muted-foreground">{t('auth.login.magicLinkSent')}</p>}
        <Button type="submit" className="w-full" disabled={formState.isSubmitting}>{t('auth.login.submit')}</Button>
        <Button type="button" variant="outline" className="w-full" onClick={onMagicLink}>{t('auth.login.magicLink')}</Button>
        <p className="text-center text-sm">
          <Link to="/mot-de-passe-oublie" className="text-primary hover:underline">{t('auth.login.forgot')}</Link>
        </p>
      </form>
    </AuthCard>
  )
}
```

**Step 5: Write `src/core/auth/pages/ForgotPasswordPage.tsx`**

```tsx
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import { t } from '@/i18n'
import { useAuth } from '@/core/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { AuthCard } from './AuthCard'

const schema = z.object({ email: z.email({ error: t('auth.errors.invalidEmail') }) })
type Values = z.infer<typeof schema>

export function ForgotPasswordPage() {
  const { sendPasswordReset } = useAuth()
  const [sent, setSent] = useState(false)
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema) })

  // Always show the same neutral message: never reveal whether an account exists.
  const onSubmit = async ({ email }: Values) => {
    await sendPasswordReset(email)
    setSent(true)
  }

  return (
    <AuthCard title={t('auth.forgot.title')}>
      {sent ? (
        <p role="status" className="text-sm text-muted-foreground">{t('auth.forgot.sent')}</p>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="email">{t('auth.login.email')}</Label>
            <Input id="email" type="email" autoComplete="email" {...register('email')} />
            {formState.errors.email && <p className="text-xs text-destructive">{formState.errors.email.message}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={formState.isSubmitting}>{t('auth.forgot.submit')}</Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm">
        <Link to="/connexion" className="text-primary hover:underline">{t('auth.forgot.back')}</Link>
      </p>
    </AuthCard>
  )
}
```

**Step 6: Write `src/core/auth/pages/ResetPasswordPage.tsx`**

```tsx
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate } from 'react-router-dom'
import { t } from '@/i18n'
import { useAuth, type AuthErrorCode } from '@/core/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { toast } from '@/shared/ui/sonner'
import { AuthCard } from './AuthCard'

const schema = z
  .object({
    password: z.string().min(10, { error: t('auth.reset.tooShort') }),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], error: t('auth.reset.mismatch') })
type Values = z.infer<typeof schema>

export function ResetPasswordPage() {
  const { session, isLoading, updatePassword } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<AuthErrorCode | null>(null)
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema) })

  // The recovery link signs the user in; without a session the link was invalid or expired.
  if (!isLoading && !session) {
    return (
      <AuthCard title={t('auth.reset.title')}>
        <p className="text-sm text-muted-foreground">{t('auth.reset.invalidLink')}</p>
        <p className="mt-4 text-center text-sm">
          <Link to="/mot-de-passe-oublie" className="text-primary hover:underline">{t('auth.forgot.submit')}</Link>
        </p>
      </AuthCard>
    )
  }

  const onSubmit = async ({ password }: Values) => {
    const code = await updatePassword(password)
    if (code) return setError(code)
    toast.success(t('auth.reset.success'))
    navigate('/accueil', { replace: true })
  }

  return (
    <AuthCard title={t('auth.reset.title')}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="password">{t('auth.reset.password')}</Label>
          <Input id="password" type="password" autoComplete="new-password" {...register('password')} />
          {formState.errors.password && <p className="text-xs text-destructive">{formState.errors.password.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm">{t('auth.reset.confirm')}</Label>
          <Input id="confirm" type="password" autoComplete="new-password" {...register('confirm')} />
          {formState.errors.confirm && <p className="text-xs text-destructive">{formState.errors.confirm.message}</p>}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{t(`auth.errors.${error}`)}</p>}
        <Button type="submit" className="w-full" disabled={formState.isSubmitting}>{t('auth.reset.submit')}</Button>
      </form>
    </AuthCard>
  )
}
```

**Step 7: Run** — `npx vitest run src/core/auth` → PASS. If Zod 4's `{ error: ... }` option is rejected by the installed version, use `{ message: ... }` instead (both are accepted by Zod 4.x).

**Step 8: Commit**

```bash
git add src/core/auth
git commit -m "feat(core): login (password + magic link), forgot and reset password pages"
```

### Task 1.17: Professionnels placeholder module

**Files:**
- Create: `src/modules/professionnels/manifest.ts`, `src/modules/professionnels/index.ts`, `src/modules/professionnels/pages/ProfessionnelsPlaceholderPage.tsx`

**Step 1: Write `src/modules/professionnels/pages/ProfessionnelsPlaceholderPage.tsx`**

```tsx
import { t } from '@/i18n'
import { FullPageMessage } from '@/shared/components/FullPageMessage'

// Replaced in Phase 4 by the real module (design §5).
export default function ProfessionnelsPlaceholderPage() {
  return <FullPageMessage title={t('modules.professionnels.name')} body={t('modules.professionnels.placeholder')} />
}
```

**Step 2: Write `src/modules/professionnels/manifest.ts`**

```ts
import { lazy } from 'react'
import { Users } from 'lucide-react'
import type { ModuleManifest } from '@/core/modules/types'

export const professionnelsManifest: ModuleManifest = {
  key: 'professionnels',
  labelKey: 'modules.professionnels.name',
  dependsOn: [],
  nav: { path: '/professionnels', labelKey: 'modules.professionnels.name', icon: Users, permission: 'professionals.view', order: 10 },
  routes: [
    { path: 'professionnels', permission: 'professionals.view', component: lazy(() => import('./pages/ProfessionnelsPlaceholderPage')) },
  ],
  settingsSections: [],
}
```

**Step 3: Write `src/modules/professionnels/index.ts`** (the module's only public entry)

```ts
export { professionnelsManifest } from './manifest'
```

**Step 4: Verify** — `npm run typecheck && npm run lint` → pass.

**Step 5: Commit**

```bash
git add src/modules
git commit -m "feat(professionnels): register module manifest with placeholder page"
```

### Task 1.18: App composition — shell, routes, entry point

**Files:**
- Create: `src/app/modules.ts`, `src/app/AppShell.tsx`, `src/app/AuthenticatedApp.tsx`, `src/app/App.tsx`, `src/app/HomePage.tsx`, `src/main.tsx`

**Step 1: Write `src/app/modules.ts`**

```ts
import type { ModuleManifest } from '@/core/modules/types'
import { professionnelsManifest } from '@/modules/professionnels'

/** Every module the app knows about. A module only appears when enabled in org_modules. */
export const ALL_MODULES: ModuleManifest[] = [professionnelsManifest]
```

**Step 2: Write `src/app/HomePage.tsx`**

```tsx
import { t } from '@/i18n'
import { useAccess } from '@/core/access/AccessProvider'

export function HomePage() {
  const { access } = useAccess()
  return (
    <div>
      <h1 className="text-2xl font-semibold">{t('home.title')}{access ? `, ${access.display_name}` : ''}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t('home.body')}</p>
    </div>
  )
}
```

**Step 3: Write `src/app/AppShell.tsx`** (deliberately minimal — the visual redesign is its own task)

```tsx
import type { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { LogOut, type LucideIcon } from 'lucide-react'
import { t, type TranslationKey } from '@/i18n'
import { useAuth } from '@/core/auth/AuthProvider'
import { useAccess } from '@/core/access/AccessProvider'
import { cn } from '@/shared/lib/utils'

export interface ShellNavItem {
  path: string
  labelKey: TranslationKey
  icon: LucideIcon
}

export function AppShell({ navItems, children }: { navItems: ShellNavItem[]; children: ReactNode }) {
  const { signOut } = useAuth()
  const { access } = useAccess()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    queryClient.clear()
    navigate('/connexion', { replace: true })
  }

  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-border bg-card md:w-60 md:border-b-0 md:border-r">
        <div className="px-5 py-4 text-lg font-semibold">{access?.org_name ?? t('app.name')}</div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:pb-0">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cn('flex items-center gap-3 whitespace-nowrap rounded-md px-3 py-2 text-sm', isActive ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted')
              }
            >
              <item.icon className="h-4 w-4" />
              {t(item.labelKey)}
            </NavLink>
          ))}
        </nav>
        <div className="hidden border-t border-border p-3 md:block">
          <p className="truncate px-3 text-sm font-medium">{access?.display_name}</p>
          <button type="button" onClick={handleSignOut} className="mt-2 flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted">
            <LogOut className="h-4 w-4" />
            {t('nav.logout')}
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  )
}
```

**Step 4: Write `src/app/AuthenticatedApp.tsx`**

```tsx
import { createElement, Suspense, useMemo } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Home, Settings } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/AccessProvider'
import { RequireAccess } from '@/core/access/guards'
import { useEnabledModuleKeys } from '@/core/modules/hooks'
import { resolveEnabledModules } from '@/core/modules/resolve'
import { SettingsLayout } from '@/core/settings/SettingsLayout'
import { coreSettingsSections } from '@/core/settings/sections'
import { ErrorBoundary } from '@/shared/components/ErrorBoundary'
import { FullPageMessage } from '@/shared/components/FullPageMessage'
import { AppShell, type ShellNavItem } from './AppShell'
import { HomePage } from './HomePage'
import { ALL_MODULES } from './modules'

export function AuthenticatedApp() {
  const { can } = useAccess()
  const enabledKeys = useEnabledModuleKeys()

  const modules = useMemo(() => resolveEnabledModules(ALL_MODULES, new Set(enabledKeys.data ?? [])), [enabledKeys.data])

  const navItems = useMemo<ShellNavItem[]>(() => {
    const moduleItems = modules
      .flatMap((m) => (m.nav && can(m.nav.permission) ? [m.nav] : []))
      .sort((a, b) => a.order - b.order)
    return [
      { path: '/accueil', labelKey: 'nav.home', icon: Home },
      ...moduleItems,
      ...(can('settings.view') ? [{ path: '/parametres', labelKey: 'nav.settings' as const, icon: Settings }] : []),
    ]
  }, [modules, can])

  const settingsSections = useMemo(() => [...coreSettingsSections, ...modules.flatMap((m) => m.settingsSections)], [modules])

  if (enabledKeys.isPending) return <FullPageMessage title={t('common.loading')} />

  return (
    <AppShell navItems={navItems}>
      <Routes>
        <Route index element={<Navigate to="/accueil" replace />} />
        <Route path="accueil" element={<HomePage />} />
        <Route
          path="parametres/*"
          element={
            <RequireAccess permission="settings.view">
              <ErrorBoundary scope="settings">
                <SettingsLayout sections={settingsSections} />
              </ErrorBoundary>
            </RequireAccess>
          }
        />
        {modules.flatMap((m) =>
          m.routes.map((r) => (
            <Route
              key={`${m.key}:${r.path}`}
              path={r.path}
              element={
                <RequireAccess permission={r.permission}>
                  {/* Design §6.2: a crash or failed chunk stays inside its module. */}
                  <ErrorBoundary scope={m.key}>
                    <Suspense fallback={<FullPageMessage title={t('common.loading')} />}>{createElement(r.component)}</Suspense>
                  </ErrorBoundary>
                </RequireAccess>
              }
            />
          )),
        )}
        <Route path="*" element={<FullPageMessage title={t('common.notFound.title')} body={t('common.notFound.body')} />} />
      </Routes>
    </AppShell>
  )
}
```

**Step 5: Write `src/app/App.tsx`**

```tsx
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/core/auth/AuthProvider'
import { AccessProvider } from '@/core/access/AccessProvider'
import { RequireAuth } from '@/core/access/guards'
import { LoginPage } from '@/core/auth/pages/LoginPage'
import { ForgotPasswordPage } from '@/core/auth/pages/ForgotPasswordPage'
import { ResetPasswordPage } from '@/core/auth/pages/ResetPasswordPage'
import { ErrorBoundary } from '@/shared/components/ErrorBoundary'
import { Toaster } from '@/shared/ui/sonner'
import { AuthenticatedApp } from './AuthenticatedApp'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 2 * 60_000, gcTime: 5 * 60_000, retry: 1 } },
})

export function App() {
  return (
    <ErrorBoundary scope="app">
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AccessProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/connexion" element={<LoginPage />} />
                <Route path="/mot-de-passe-oublie" element={<ForgotPasswordPage />} />
                <Route path="/reinitialiser-mot-de-passe" element={<ResetPasswordPage />} />
                <Route path="/*" element={<RequireAuth><AuthenticatedApp /></RequireAuth>} />
              </Routes>
            </BrowserRouter>
            <Toaster />
          </AccessProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
```

**Step 6: Write `src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { App } from '@/app/App'
import '@/styles/globals.css'

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN, environment: import.meta.env.MODE })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

**Step 7: Verify everything**

```bash
npm run typecheck && npm run lint && npm run lint:supabase && npm run test:run && npm run build
```

Expected: all green; `vite build` writes `dist/`.

**Step 8: Manual check** (local Supabase running, `.env.local` set): `npm run dev`, open http://127.0.0.1:5173 and sign in with each seed user (password in `supabase/seed.sql`):

| User | Expected menu | Expected behaviour |
|---|---|---|
| admin@mana.test | Accueil · Professionnels · Paramètres | Paramètres → Modules shows the Professionnels switch. Turning it off removes « Professionnels » from the menu; `/professionnels` shows « Page introuvable ». Turn it back on. |
| staff@mana.test | Accueil · Professionnels · Paramètres | Paramètres shows « Aucune section… » (no `modules.manage`). |
| provider@mana.test | Accueil | `/parametres` shows « Accès refusé ». |

Also: « Mot de passe oublié » → the email arrives in Inbucket (http://127.0.0.1:54324) → the link opens the reset page → new password works.

**Step 9: Commit**

```bash
git add src/app src/main.tsx
git commit -m "feat(app): compose shell, guarded routes and module registry"
```

### Task 1.19: Edge function shared helpers

**Files:**
- Create: `supabase/functions/_shared/auth.ts`, `supabase/functions/_shared/timing-safe-equal.ts`, `supabase/functions/_shared/timing-safe-equal.test.ts`, `supabase/functions/_shared/modules.ts`

**Step 1: Write the failing test** `supabase/functions/_shared/timing-safe-equal.test.ts`

```ts
import { assert, assertFalse } from 'jsr:@std/assert@1'
import { timingSafeEqual } from './timing-safe-equal.ts'

Deno.test('equal strings match', () => assert(timingSafeEqual('secret', 'secret')))
Deno.test('different strings do not match', () => assertFalse(timingSafeEqual('secret', 'secreT')))
Deno.test('different lengths do not match', () => assertFalse(timingSafeEqual('secret', 'secret1')))
```

**Step 2: Run** — `npm run test:functions` → FAIL (module not found).

**Step 3: Copy from PS Hub** — `cp "/Users/jonathanharvey/Documents/Claude Projects/NEW PS Hub/supabase/functions/_shared/timing-safe-equal.ts" supabase/functions/_shared/`

**Step 4: Run** — `npm run test:functions` → PASS (3 tests).

**Step 5: Write `supabase/functions/_shared/auth.ts`** (adapted from PS Hub `_shared/auth.ts`: permission-based instead of super_user, constant-time service-key check)

```ts
/**
 * Shared auth for Edge Functions (adapted from PS Hub `_shared/auth.ts`).
 *
 * Rule: every function deployed with verify_jwt = false MUST either call
 * verifyAuth() / verifyServiceRoleAuth() or verify a webhook signature.
 */
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2'
import { timingSafeEqual } from './timing-safe-equal.ts'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders })
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status)
}

export function handleCors(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response(null, { headers: corsHeaders }) : null
}

export interface AuthResult {
  user: User
  /** RLS-respecting client acting as the caller. */
  client: SupabaseClient
}

/**
 * Verifies the caller's JWT and, optionally, a permission key (has_permission RPC).
 * Returns AuthResult, or a Response to return immediately.
 */
export async function verifyAuth(req: Request, options: { permission?: string } = {}): Promise<AuthResult | Response> {
  if (!req.headers.get('Authorization')) return errorResponse('Missing Authorization header', 401)

  const client = getUserClient(req)
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) return errorResponse('Invalid or expired token', 401)

  if (options.permission) {
    const { data: allowed, error: permissionError } = await client.rpc('has_permission', { p_key: options.permission })
    if (permissionError) return errorResponse('Permission check failed', 500)
    if (allowed !== true) return errorResponse(`Permission required: ${options.permission}`, 403)
  }

  return { user, client }
}

/** For internal-only functions (cron, other functions). Fails closed if the key is unset. */
export function verifyServiceRoleAuth(req: Request): Response | null {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!serviceKey) return errorResponse('Server misconfigured', 500)
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return errorResponse('Missing Authorization header', 401)
  if (!timingSafeEqual(token, serviceKey)) return errorResponse('Service role key required', 401)
  return null
}

/** Bypasses RLS. Only use AFTER verifyAuth / verifyServiceRoleAuth succeeded. */
export function getServiceRoleClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

export function getUserClient(req: Request): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
}
```

**Step 6: Write `supabase/functions/_shared/modules.ts`**

```ts
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { errorResponse } from './auth.ts'

/** Design §3: a disabled module's functions refuse calls. Use the caller's client. */
export async function requireModule(client: SupabaseClient, moduleKey: string): Promise<Response | null> {
  const { data, error } = await client.rpc('module_enabled', { p_key: moduleKey })
  if (error) return errorResponse('Module check failed', 500)
  return data === true ? null : errorResponse(`Module disabled: ${moduleKey}`, 403)
}
```

**Step 7: Verify** — `deno check supabase/functions/_shared/*.ts && npm run test:functions` → pass.

**Step 8: Commit**

```bash
git add supabase/functions/_shared
git commit -m "feat(functions): shared auth, permission and module guards for edge functions"
```

### Task 1.20: Continuous integration

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/migration-lint.yml`

**Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  web:
    name: Typecheck, lint, test, build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run lint:supabase
      - run: npm run test:run
      - run: npm run build
        env:
          VITE_SUPABASE_URL: http://127.0.0.1:54321
          VITE_SUPABASE_ANON_KEY: ci-placeholder

  functions:
    name: Edge function checks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
        with:
          deno-version: v2.x
      - run: deno check supabase/functions/_shared/*.ts
      - run: deno test --allow-env supabase/functions/_shared

  database:
    name: Migrations, RLS tests, types drift
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: 2.98.2
      - run: supabase start -x studio,imgproxy,inbucket,logflare,vector,supavisor,edge-runtime
      - run: supabase test db
      - name: Generated types are up to date
        run: |
          supabase gen types typescript --local --schema public > /tmp/database.types.ts
          diff -u src/core/supabase/database.types.ts /tmp/database.types.ts
```

**Step 2: Copy the migration lint workflow from PS Hub**

```bash
mkdir -p .github/workflows
cp "/Users/jonathanharvey/Documents/Claude Projects/NEW PS Hub/.github/workflows/migration-lint.yml" .github/workflows/
```

**Step 3: Ask Jonathan** — "OK to push branch `feat/foundation-base` and open a draft PR so CI runs?" Wait for yes.

**Step 4: Push and open a draft PR**

```bash
git add .github
git commit -m "ci: typecheck, lint, tests, pgTAP and types-drift checks on every PR"
git push -u origin feat/foundation-base
gh pr create --draft --base main --title "feat: foundation rebuild — phase 0 + 1" --body "$(cat <<'EOF'
## Summary
- Legacy app moved to `_legacy/` (tag `legacy-v1`); behaviour inventory in `docs/plans/2026-10-06-legacy-feature-inventory.md`.
- New core: organisations, profiles, roles & permissions (`has_permission`, `get_my_access`), module registry, Vault secrets, generic audit log — all covered by pgTAP.
- Auth: password, magic link, forgot/reset password; invitation-only (sign-up disabled).
- Frontend: access provider (fail-closed), route guards, module manifests with dependency resolution, settings shell with Modules toggle, Professionnels placeholder.
- CI: typecheck, lint (module boundaries + Supabase-in-UI guard), Vitest, Deno, pgTAP, types drift.

Design: `docs/plans/2026-10-06-foundation-rebuild-design.md`

## Test plan
- [ ] CI green
- [ ] Manual role check (admin / staff / provider) per Task 1.18 Step 8
- [ ] Password reset round-trip via Inbucket

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 5: Watch CI** — `gh pr checks --watch`. Fix anything red before continuing (common: `npm ci` lockfile drift → run `npm install` and commit `package-lock.json`; types drift → `npm run db:types` and commit).

### Task 1.21: Reset staging to the new baseline — **requires explicit go-ahead**

**Files:**
- Create: `scripts/bootstrap-admin.sql`

**Step 1: Ask Jonathan** — "Task 0.2 backups exist in `clinique-mana-backups/`. OK to wipe the staging database `vnmbjbdsjxmpijyjmmkh`, delete its 13 legacy edge functions (list in docs/audit/2026-10-07-staging-snapshot.md) and legacy storage buckets, and apply the new migrations?" Wait for an explicit yes. Do not proceed on anything less.

**Step 2: Reset the database (no seed — test passwords never go to staging)**

```bash
supabase link --project-ref vnmbjbdsjxmpijyjmmkh
supabase db reset --linked --no-seed
supabase migration list --linked
```

Expected: the 4 new migrations are listed as applied both locally and remotely.

**Step 3: Remove legacy edge functions**

```bash
for fn in create-professional docuseal-create-submission docuseal-create-template docuseal-get-submission docuseal-webhook \
  google-calendar-auth-url google-calendar-callback google-calendar-disconnect google-calendar-sync \
  google-places-autocomplete google-places-details sign-contract get-contract; do
  supabase functions delete "$fn" --project-ref vnmbjbdsjxmpijyjmmkh
done
```

Then compare against the list recorded in Task 0.2 and delete anything left over.

**Step 4: Verify the remote state** (Supabase MCP, read-only): `list_tables` (expect only the core tables), `select id from storage.buckets` (empty legacy buckets via the dashboard if any remain), `select count(*) from auth.users` (legacy test users: delete them in Dashboard → Authentication), and `get_advisors` (security) — expect no errors.

**Step 5: Write `scripts/bootstrap-admin.sql`**

```sql
-- Run ONCE in the Supabase SQL editor after inviting the first admin from
-- Dashboard → Authentication → Invite user. Replace the email below.
do $$
declare
  v_email text := 'REPLACE_WITH_ADMIN_EMAIL';
  v_user uuid;
  v_org uuid;
begin
  select id into v_user from auth.users where email = v_email;
  if v_user is null then raise exception 'Invite % first', v_email; end if;

  insert into public.organizations (name) values ('Clinique MANA') returning id into v_org;
  insert into public.profiles (user_id, org_id, display_name, email) values (v_user, v_org, split_part(v_email, '@', 1), v_email);
  insert into public.user_roles (user_id, role) values (v_user, 'admin');
  insert into public.org_modules (org_id, module_key, enabled, enabled_at, enabled_by)
    values (v_org, 'professionnels', true, now(), v_user);
end $$;
```

**Step 6: Hand off to Jonathan** — invite his admin account from the dashboard, then run the script with his email. Also: set **Auth → URL configuration** site URL and redirect URLs to the Vercel staging URL (`/**`), and disable "Allow new users to sign up".

**Step 7: Commit**

```bash
git add scripts/bootstrap-admin.sql
git commit -m "chore(supabase): first-admin bootstrap script for a fresh environment"
```

### Task 1.22: Continuous deployment to staging

Only after Task 1.21 — otherwise the first run would collide with the legacy migration history.

**Files:**
- Create: `.github/workflows/supabase-migrations.yml`, `.github/workflows/apply-edge-functions.yml`

**Step 1: Copy from PS Hub and point to staging**

```bash
P="/Users/jonathanharvey/Documents/Claude Projects/NEW PS Hub/.github/workflows"
sed 's/uvtfuuqttlddyrfnsdqh/vnmbjbdsjxmpijyjmmkh/g; s/supabase-migrations-prod/supabase-migrations-staging/; s/Push migrations to production/Push migrations to staging/' \
  "$P/supabase-migrations.yml" > .github/workflows/supabase-migrations.yml
sed 's/uvtfuuqttlddyrfnsdqh/vnmbjbdsjxmpijyjmmkh/g' "$P/apply-edge-functions.yml" > .github/workflows/apply-edge-functions.yml
grep -n "vnmbjbdsjxmpijyjmmkh" .github/workflows/*.yml
```

Read both files fully and remove any PS Hub-specific step (Slack/alerts, PS Hub function names). Keep: link → `db push --linked --include-all` → drift check; changed-functions detection honouring `verify_jwt` in `config.toml`.

**Step 2: Ask Jonathan** to add repository secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` (GitHub → Settings → Secrets → Actions). Do not handle the values yourself.

**Step 3: Commit and push**

```bash
git add .github/workflows
git commit -m "ci: auto-apply migrations and edge functions to staging on merge"
git push
```

### Task 1.23: Documentation

**Files:**
- Create: `CLAUDE.md`, `docs/adr/README.md`, `docs/adr/0001-foundation-rebuild.md`, `docs/adr/0002-permissions-model.md`, `docs/adr/0003-module-and-settings-registry.md`, `docs/adr/0004-secrets-in-vault.md`, `docs/adr/0005-documenso-replaces-docuseal.md`, `docs/modules/core.md`

**Step 1: Write `CLAUDE.md`** with these sections (keep it factual and short; every name must exist in the code):

1. **Project** — what Clinique MANA is; rebuild in progress, legacy in `_legacy/` (read-only), parity list in `docs/plans/2026-10-06-legacy-feature-inventory.md`.
2. **Environments** — staging `vnmbjbdsjxmpijyjmmkh` (only environment today); local via `supabase start`.
3. **Commands** — `npm run dev | typecheck | lint | lint:supabase | test:run | test:functions | build`, `npm run db:reset | db:test | db:types`.
4. **Structure** — `src/app` (composition root), `src/core/*`, `src/modules/<name>/{manifest.ts,index.ts,api,hooks,components,pages}`, `src/shared/*`, `supabase/{migrations,functions/_shared,tests/database,seed.sql}`.
5. **Module rules** (design §6.2) — public `index.ts` only; relative imports inside a module; core/shared never import modules; own tables + publish views/RPCs for others; additive migrations; each module ships pgTAP + unit + e2e tests; inventory Keep/Change/Drop before building.
6. **Database rules** — RLS on every table; policies use only `current_user_org_id()`, `has_permission()`, `user_in_my_org()` wrapped in `(select …)`; never query `profiles`/`user_roles` inline; every business table has `org_id` and the `audit_trigger`; secrets only via `set_org_secret` / `get_org_secret`; migration names with seconds ≠ 00; regenerate types after every migration.
7. **Edge functions** — `verify_jwt = false` only with `verifyAuth` / `verifyServiceRoleAuth` / signature check; `requireModule()`; never trust client-sent org ids.
8. **Frontend rules** — no Supabase client in `.tsx` (use `api/*.ts` + hooks); React Query key factories `<module>Keys`; all user-facing text through `t()` (fr-CA); toasts via `@/shared/ui/sonner`.
9. **Timezone** — copy the legacy CLAUDE.md "Timezone Handling" section verbatim (rules, utilities, date-only fields), adding: the timezone is set from `organizations.timezone` at sign-in via `setClinicTimezone()`.
10. **Form accessibility & tab order** — copy the legacy CLAUDE.md section verbatim.
11. **Deploy** — merge to `main` = migrations + edge functions applied to staging by Actions; never `apply_migration` via MCP; never mutate staging without Jonathan's explicit go-ahead.

**Step 2: Write the ADRs** — `docs/adr/README.md` defines the template (Status · Context · Decision · Consequences · Alternatives). Each ADR is 15–30 lines, citing the design section:
- 0001 — rebuild in place, legacy kept in `_legacy/`, staging wiped (design §1, D1).
- 0002 — DB-held RBAC with overrides; role read from table not JWT; permission catalogue table (design §2).
- 0003 — module manifests + `org_modules` + settings registry + import boundaries (design §3, §6.2).
- 0004 — Vault secrets write-only from UI; encrypted `*_private` tables (design §3).
- 0005 — Documenso self-hosted for the clinic replaces DocuSeal (design D4, §4.3).

**Step 3: Write `docs/modules/core.md`** — tables owned by core (organizations, profiles, user_roles, permissions, role_permissions, user_permission_overrides, audit_log, modules, org_modules, org_module_settings, org_secrets), public RPCs (`get_my_access`, `has_permission`, `module_enabled`, `set_module_enabled`, `set_org_secret`, `list_org_secret_keys`; server-only `get_org_secret`), and permission keys.

**Step 4: Commit and push**

```bash
git add CLAUDE.md docs/adr docs/modules/core.md
git commit -m "docs: CLAUDE.md for the rebuild, ADRs 0001-0005, core module doc"
git push
```

### Task 1.24: Final verification

**Step 1: Fresh local run**

```bash
supabase db reset && supabase test db
npm run typecheck && npm run lint && npm run lint:supabase && npm run test:run && npm run test:functions && npm run build
```

Expected: everything passes. Paste the summary lines (test counts) into the PR description under "Test plan".

**Step 2:** Repeat the manual role check from Task 1.18 Step 8.

**Step 3:** `gh pr checks` → all green. Mark the PR ready for review only when Jonathan asks; merging is his call (merge = staging deploy).

---

## Out of scope for this plan (next plans)

- **Phase 2 — Core Settings:** organisation identity/tax/privacy columns + pages, users & invitations (staff), audit viewer, scheduled tasks viewer, email settings shell.
- **Phase 3 — Shared services:** Resend email + templates + log + webhook, secure links, Documenso signing, storage helpers.
- **Phase 4 — Professionnels:** starts with the module design doc marking inventory §A items Keep / Change / Drop.
- Visual redesign of the shell (mobile nav, branding) — a dedicated design task.
- **Before the 2nd module:** replace the text-pattern module boundary with a path-resolving rule (`eslint-plugin-boundaries` or `import-x/no-restricted-paths`): only `index.ts` entry points, only modules listed in `dependsOn`, cover dynamic `import()`, restrict `src/app` to module entries (Batch A quality review).
- Use `mergeConfig(viteConfig, …)` in `vitest.config.ts` once `vite.config.ts` gains plugins/defines; add happy-dom polyfills (ResizeObserver, pointer capture) when Radix dialogs get tests.

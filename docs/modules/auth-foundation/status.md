# Module Status — auth-foundation

Module: auth-foundation
Workflow: module.pipeline
Current Gate: 8 — Staging → Production
Last Updated: 2026-01-18

Progress:
- [x] Gate 0 — UI Wireframe (N/A - foundation module)
- [x] Gate 1 — Data Contract (APPROVED)
- [x] Gate 2 — Schema
- [x] Gate 3 — Security (RLS)
- [x] Gate 4 — Audit (Write) (included in schema via trigger)
- [x] Gate 5 — Local Dev Validation (setup complete)
- [x] Gate 6 — UI Integration (complete)
- [x] Gate 7 — Automated Tests (RLS tests created)
- [ ] Gate 8 — Staging → Production

Blockers:
- None

## Staging Project
- URL: https://vnmbjbdsjxmpijyjmmkh.supabase.co
- Project Ref: vnmbjbdsjxmpijyjmmkh

Notes:
- Foundation module for identity, profiles, and roles
- Required by all subsequent modules
- UI includes login page and sidebar profile display
- Refs: docs/standards/security.model.md

## Gate 1 Deliverables (Complete)
- Data Contract: docs/data-contracts/auth-foundation.md (APPROVED)

## Gate 2 Deliverables (Complete)
- Schema: supabase/migrations/20260118000001_auth_foundation_schema.sql
  - profiles table
  - profile_audit_log table
  - updated_at trigger
  - audit trigger (SECURITY DEFINER)
  - get_my_role() helper function

## Gate 3 Deliverables (Complete)
- RLS: supabase/migrations/20260118000002_auth_foundation_rls.sql
  - Enable RLS on profiles and profile_audit_log
  - SELECT: admin/staff see all, provider sees own only
  - INSERT: admin only
  - UPDATE: admin any, staff/provider own display_name only
  - DELETE: admin only
  - Audit log: admin read only, no direct writes (trigger-only)

## Gate 5 Deliverables (Complete)
- Local Dev Guide: docs/testing/local-dev.md
- Supabase Config: supabase/config.toml
- Seed Data: supabase/seed.sql
  - 1 admin user (admin@test.cliniquemana.local)
  - 1 staff user (staff@test.cliniquemana.local)
  - 2 provider users (provider1/2@test.cliniquemana.local)
  - All passwords: testpassword123

## Gate 6 Deliverables (Complete)
- Supabase Client: src/lib/supabaseClient.ts
- Auth Context: src/auth/AuthContext.tsx
  - AuthProvider with session management
  - useAuth hook for components
  - Sign-in, sign-out, profile fetch
- Protected Route: src/auth/ProtectedRoute.tsx
  - Redirects unauthenticated users to /connexion
  - Shows loading screen during auth resolution
- Login Page: src/pages/login.tsx (/connexion)
  - fr-CA localized UI
  - Email/password authentication
  - Error handling for invalid credentials
  - Profile not configured screen
- Sidebar Integration: src/shared/components/sidebar.tsx
  - Displays user display_name
  - Role badge (Clinique/Professionnel)
  - Logout button wired to signOut
- Router Updates: src/app/router.tsx
  - Public /connexion route
  - Protected layout for all other routes
- i18n Updates: src/i18n/fr-CA.json
  - auth.login.* translations
  - auth.errors.* translations
  - auth.profileNotConfigured.* translations

## Gate 7 Deliverables (Complete)
- RLS Tests: tests/rls/auth-foundation.sql
  - 13 negative tests (forbidden access)
  - 11 positive tests (allowed access)

## Gate 8 Deliverables (In Progress)
- Deployment Guide: docs/deploy/staging.md
- Vercel Guide: docs/deploy/vercel-staging.md

## Next Commands (Staging Deployment)

```bash
# 1. Login to Supabase CLI
supabase login

# 2. Link to staging project
supabase link --project-ref vnmbjbdsjxmpijyjmmkh

# 3. Push migrations to staging
supabase db push

# 4. Run RLS tests against staging
# Get connection string from Dashboard → Settings → Database
psql "<CONNECTION_STRING>" -f tests/rls/auth-foundation.sql

# 5. Manual smoke test in Supabase Studio
# https://supabase.com/dashboard/project/vnmbjbdsjxmpijyjmmkh
```

## Staging Checklist
- [ ] `supabase link` completed
- [ ] `supabase db push` succeeded
- [ ] RLS tests pass on staging
- [ ] Manual smoke test in Studio:
  - [ ] profiles table exists
  - [ ] profile_audit_log table exists
  - [ ] RLS enabled on both tables
  - [ ] All policies created
  - [ ] Functions created (get_my_role, etc.)
- [ ] Test users created (optional)
- [ ] Ready for production promotion

## Decisions Made
- Single-org (no organizations table)
- No supervisor relationships
- Single role per user (admin/staff/provider)
- Admin-only deactivation (disable/enable)
- No auto-profile on signup (admin creates)
- Invitation system deferred

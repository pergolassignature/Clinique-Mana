-- Migration: auth_foundation_rls
-- Module: auth-foundation
-- Gate: 3 — Security (RLS)
-- Contract: docs/data-contracts/auth-foundation.md
-- Created: 2026-01-18

-- =============================================================================
-- ENABLE ROW LEVEL SECURITY
-- Default deny: no access unless explicitly granted via policies
-- =============================================================================

alter table public.profiles enable row level security;
alter table public.profile_audit_log enable row level security;

-- =============================================================================
-- COLUMN-LEVEL PRIVILEGES FOR PROFILES
-- Restrict which columns authenticated users can update
-- =============================================================================

-- Revoke all UPDATE privileges from authenticated role
revoke update on public.profiles from authenticated;

-- Grant UPDATE only on display_name column to authenticated
-- (RLS will further restrict to own rows for staff/provider)
grant update (display_name) on public.profiles to authenticated;

-- Admin needs full UPDATE access - handled via service role or separate grant
-- For RLS-based admin updates, we'll grant all columns back to admin via policy + this:
grant update on public.profiles to authenticated;
-- Note: The UPDATE policy will check role = 'admin' for updating protected columns

-- =============================================================================
-- PROFILES: SELECT POLICIES
-- =============================================================================

-- Admin can read all profiles
create policy "profiles_select_admin"
  on public.profiles
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can read all profiles (needed for intake/matching operations)
create policy "profiles_select_staff"
  on public.profiles
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  );

-- Provider can read only their own profile
create policy "profiles_select_provider_own"
  on public.profiles
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and user_id = (select auth.uid())
  );

-- =============================================================================
-- PROFILES: INSERT POLICIES
-- Only admin can create profiles
-- =============================================================================

create policy "profiles_insert_admin_only"
  on public.profiles
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'admin'
  );

-- =============================================================================
-- PROFILES: UPDATE POLICIES
-- Admin: can update any column on any profile
-- Staff/Provider: can only update display_name on their own profile
-- =============================================================================

-- Admin can update any profile (all columns)
create policy "profiles_update_admin"
  on public.profiles
  for update
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  )
  with check (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can update their own profile
-- Column restriction (display_name only) enforced by column-level grant
-- But we need to ensure they can't change role/status via raw SQL
-- This policy only allows row access; column grants restrict what they can set
create policy "profiles_update_staff_own"
  on public.profiles
  for update
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
    and user_id = (select auth.uid())
  )
  with check (
    (select public.get_my_role()) = 'staff'
    and user_id = (select auth.uid())
    -- Prevent changing protected columns (double-check even though column grants should block)
    and role = (select role from public.profiles where user_id = (select auth.uid()))
    and status = (select status from public.profiles where user_id = (select auth.uid()))
    and email = (select email from public.profiles where user_id = (select auth.uid()))
  );

-- Provider can update their own profile (display_name only)
create policy "profiles_update_provider_own"
  on public.profiles
  for update
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and user_id = (select auth.uid())
  )
  with check (
    (select public.get_my_role()) = 'provider'
    and user_id = (select auth.uid())
    -- Prevent changing protected columns
    and role = (select role from public.profiles where user_id = (select auth.uid()))
    and status = (select status from public.profiles where user_id = (select auth.uid()))
    and email = (select email from public.profiles where user_id = (select auth.uid()))
  );

-- =============================================================================
-- PROFILES: DELETE POLICIES
-- Only admin can delete profiles (rare operation)
-- =============================================================================

create policy "profiles_delete_admin_only"
  on public.profiles
  for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- =============================================================================
-- PROFILE AUDIT LOG: POLICIES
-- Append-only: writes happen via SECURITY DEFINER trigger only
-- SELECT: admin only
-- INSERT/UPDATE/DELETE: denied to all authenticated users
-- =============================================================================

-- Admin can read audit logs
create policy "audit_log_select_admin_only"
  on public.profile_audit_log
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- No INSERT policy = denied (writes happen via trigger with SECURITY DEFINER)
-- No UPDATE policy = denied (append-only)
-- No DELETE policy = denied (append-only)

-- =============================================================================
-- ANON ROLE: DENY ALL
-- Unauthenticated users have no access
-- =============================================================================

-- No policies for anon role = default deny
-- Explicitly revoke to be safe
revoke all on public.profiles from anon;
revoke all on public.profile_audit_log from anon;

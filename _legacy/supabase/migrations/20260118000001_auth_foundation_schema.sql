-- Migration: auth_foundation_schema
-- Module: auth-foundation
-- Gate: 2 — Schema
-- Contract: docs/data-contracts/auth-foundation.md
-- Created: 2026-01-18

-- =============================================================================
-- PROFILES TABLE
-- Application-layer identity linked to Supabase auth.users
-- =============================================================================

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'staff', 'provider')),
  display_name text not null,
  email text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for common query patterns
create index profiles_user_id_idx on public.profiles(user_id);
create index profiles_role_idx on public.profiles(role);
create index profiles_status_idx on public.profiles(status);

-- Comment for documentation
comment on table public.profiles is 'Application-layer user profiles linked to auth.users';
comment on column public.profiles.user_id is 'FK to auth.users(id), one profile per auth user';
comment on column public.profiles.role is 'Single role: admin, staff, or provider';
comment on column public.profiles.status is 'Account status: active or disabled';

-- =============================================================================
-- PROFILE AUDIT LOG TABLE
-- Immutable log of identity and role changes
-- =============================================================================

create table public.profile_audit_log (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

-- Index for querying audit history by profile
create index profile_audit_log_profile_id_idx on public.profile_audit_log(profile_id);
create index profile_audit_log_created_at_idx on public.profile_audit_log(created_at);

-- Comment for documentation
comment on table public.profile_audit_log is 'Append-only audit log for profile changes';
comment on column public.profile_audit_log.actor_id is 'Who made the change (NULL for system/triggers)';
comment on column public.profile_audit_log.action is 'Action type: created, role_changed, status_changed, updated, deleted';

-- =============================================================================
-- UPDATED_AT TRIGGER
-- Automatically maintain updated_at on profiles
-- =============================================================================

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- =============================================================================
-- AUDIT TRIGGER FUNCTION
-- Automatically log changes to profiles
-- Uses SECURITY DEFINER to bypass RLS for audit writes
-- =============================================================================

create or replace function public.audit_profile_changes()
returns trigger
security definer
set search_path = public
as $$
declare
  v_action text;
  v_old_value jsonb;
  v_new_value jsonb;
  v_actor_id uuid;
begin
  -- Determine actor (current user's profile id, if exists)
  select id into v_actor_id
  from public.profiles
  where user_id = auth.uid();

  if tg_op = 'INSERT' then
    v_action := 'created';
    v_old_value := null;
    v_new_value := jsonb_build_object(
      'role', new.role,
      'display_name', new.display_name,
      'email', new.email,
      'status', new.status
    );

    insert into public.profile_audit_log (profile_id, actor_id, action, old_value, new_value)
    values (new.id, v_actor_id, v_action, v_old_value, v_new_value);

    return new;

  elsif tg_op = 'UPDATE' then
    -- Determine what changed and log accordingly
    if old.role is distinct from new.role then
      insert into public.profile_audit_log (profile_id, actor_id, action, old_value, new_value)
      values (
        new.id,
        v_actor_id,
        'role_changed',
        jsonb_build_object('role', old.role),
        jsonb_build_object('role', new.role)
      );
    end if;

    if old.status is distinct from new.status then
      insert into public.profile_audit_log (profile_id, actor_id, action, old_value, new_value)
      values (
        new.id,
        v_actor_id,
        'status_changed',
        jsonb_build_object('status', old.status),
        jsonb_build_object('status', new.status)
      );
    end if;

    if old.display_name is distinct from new.display_name then
      insert into public.profile_audit_log (profile_id, actor_id, action, old_value, new_value)
      values (
        new.id,
        v_actor_id,
        'updated',
        jsonb_build_object('display_name', old.display_name),
        jsonb_build_object('display_name', new.display_name)
      );
    end if;

    if old.email is distinct from new.email then
      insert into public.profile_audit_log (profile_id, actor_id, action, old_value, new_value)
      values (
        new.id,
        v_actor_id,
        'updated',
        jsonb_build_object('email', old.email),
        jsonb_build_object('email', new.email)
      );
    end if;

    return new;

  elsif tg_op = 'DELETE' then
    v_action := 'deleted';
    v_old_value := jsonb_build_object(
      'role', old.role,
      'display_name', old.display_name,
      'email', old.email,
      'status', old.status
    );
    v_new_value := null;

    insert into public.profile_audit_log (profile_id, actor_id, action, old_value, new_value)
    values (old.id, v_actor_id, v_action, v_old_value, v_new_value);

    return old;
  end if;

  return null;
end;
$$ language plpgsql;

create trigger profiles_audit_trigger
  after insert or update or delete on public.profiles
  for each row
  execute function public.audit_profile_changes();

-- =============================================================================
-- HELPER FUNCTION: Get current user's role
-- Used by RLS policies for efficient role checks
-- =============================================================================

create or replace function public.get_my_role()
returns text
stable
security definer
set search_path = public
as $$
  select role from public.profiles where user_id = auth.uid();
$$ language sql;

comment on function public.get_my_role() is 'Returns the role of the current authenticated user';

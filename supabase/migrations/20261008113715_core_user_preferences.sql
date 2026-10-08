-- =============================================================================
-- Per-user preferences (remembered list filters)
-- =============================================================================
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md Task 4a.10 (remembered filters, P4-39)
-- PS Hub:  user_search_preferences + usePersistedSearch (read-only reference)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * One row per (user, key); `value` is a JSON object (the list's filters without the page, for
--   `professionals.list_filters`). Restored when the same person signs in on any computer;
--   never mirrored in localStorage (decision #10, shared reception computers).
-- * Core, not a module table: any active member may keep preferences, whatever their role, so
--   there is no permission term (no module gate to apply). Access is « own rows, while active »:
--   `user_id = auth.uid()` and the caller's org (private.current_user_org_id() is null for a
--   disabled profile).
-- * Deviation from PS Hub (direct upsert / delete on the table under RLS): clients never get
--   INSERT or DELETE (conventions §3, 000_invariants), so clients only SELECT (RLS) and write
--   through two definer RPCs, set_user_preference (upsert) and delete_user_preference. The RPCs
--   take the user and org from the session, never from the caller.
-- * org_id with a composite FK to profiles (conventions §4), on delete cascade: rows go with
--   the profile (retention), and cannot drift to another org.
-- * Limits: key `^[a-z0-9_.:-]{1,100}$`, value an object of at most 16 KB (as text), at most 50
--   keys per user (a user-writable table must stay bounded). The checks are named
--   (user_preferences_key_format / _value_object / _value_size) and raise 23514; the key cap
--   raises 22023. set_user_preference locks the caller's profile row so the cap holds under
--   concurrent saves.
-- * Not audited: UI state, written on every (debounced) filter change, and the search text may
--   hold a client's name; auditing would copy it into the append-only audit_log forever. Listed
--   with the reason in 000_invariants' exception list.
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:core_user_preferences', true);

-- -----------------------------------------------------------------------------
-- Table
-- -----------------------------------------------------------------------------
create table public.user_preferences (
  user_id uuid not null,
  org_id uuid not null,
  key text not null,
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, key),
  foreign key (user_id, org_id) references public.profiles(user_id, org_id) on delete cascade,
  constraint user_preferences_key_format check (key ~ '^[a-z0-9_.:-]{1,100}$'),
  constraint user_preferences_value_object check (pg_catalog.jsonb_typeof(value) = 'object'),
  constraint user_preferences_value_size check (pg_catalog.octet_length(value::text) <= 16384)
);
-- The primary key (user_id, key) leads with user_id: it serves the FK and the policy.

create trigger user_preferences_set_updated_at
  before update on public.user_preferences
  for each row execute function private.set_updated_at();

alter table public.user_preferences enable row level security;
revoke all on public.user_preferences from anon, authenticated;
grant select on public.user_preferences to authenticated;

create policy user_preferences_select on public.user_preferences
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and org_id = (select private.current_user_org_id())
  );

-- -----------------------------------------------------------------------------
-- RPCs (act for auth.uid(); service_role is revoked)
-- -----------------------------------------------------------------------------
-- Saves (inserts or replaces) one preference of the caller. 42501 when the caller has no active
-- profile; 22023 for a null key or value, or a 51st key; 23514 from the table checks.
create function public.set_user_preference(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
begin
  -- Locks the caller's own profile row (conventions §6) so concurrent saves see each other's
  -- keys before the cap check.
  select p.org_id into v_org
    from public.profiles p
   where p.user_id = v_uid and p.status = 'active'
     for no key update;
  if v_org is null then
    raise exception 'Permission refusée' using errcode = '42501';
  end if;
  if p_key is null or p_value is null then
    raise exception 'Clé et valeur requises' using errcode = '22023';
  end if;

  if not exists (select 1 from public.user_preferences up where up.user_id = v_uid and up.key = p_key)
     and (select pg_catalog.count(*) from public.user_preferences up where up.user_id = v_uid) >= 50 then
    raise exception 'Au plus 50 préférences par utilisateur' using errcode = '22023';
  end if;

  insert into public.user_preferences (user_id, org_id, key, value)
  values (v_uid, v_org, p_key, p_value)
  on conflict (user_id, key) do update set value = excluded.value;
end;
$$;

-- Deletes one preference of the caller (no-op when absent). 42501 when the caller has no active
-- profile.
create function public.delete_user_preference(p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.current_user_org_id() is null then
    raise exception 'Permission refusée' using errcode = '42501';
  end if;
  delete from public.user_preferences up
   where up.user_id = auth.uid() and up.key = p_key;
end;
$$;

revoke all on function
  public.set_user_preference(text, jsonb),
  public.delete_user_preference(text)
from public, anon, authenticated, service_role;
grant execute on function
  public.set_user_preference(text, jsonb),
  public.delete_user_preference(text)
to authenticated;

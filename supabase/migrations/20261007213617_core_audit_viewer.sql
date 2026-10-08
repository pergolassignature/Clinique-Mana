-- =============================================================================
-- Audit log viewer RPCs
-- =============================================================================
-- Design:  docs/plans/2026-10-07-phase-2-core-settings-design.md §3.6
-- SECURITY DEFINER so the actor's name can be shown to a viewer without
-- users.view. Scoped to the caller's org; never returns rows without org_id.
-- Actor names come only from profiles of the same org (a name is never shown
-- across orgs). Returns every action, including 'read' (audited reveals).
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
-- Optional filters (« p_x is null or … »): a generic cached plan would ignore them.
set plan_cache_mode = force_custom_plan
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('audit.view') then
    raise exception 'Permission refusée : audit.view' using errcode = '42501';
  end if;
  if v_org is null then
    return;
  end if;
  return query
    select a.id, a.created_at, a.table_name, a.record_id, a.action, a.changed_fields,
           a.actor_id, p.display_name, a.actor_role, a.source
      from public.audit_log a
      left join public.profiles p on p.user_id = a.actor_id and p.org_id = a.org_id
     where a.org_id = v_org
       and (p_table is null or a.table_name = p_table)
       and (p_actor is null or a.actor_id = p_actor)
       and (p_from is null or a.created_at >= p_from)
       and (p_to is null or a.created_at < p_to)
       and (p_before_id is null or a.id < p_before_id)
     order by a.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

-- People of the org who appear in its log (for the « Personne » filter).
-- Profiles first: one index probe per member (audit_log_actor_created_idx)
-- instead of a scan of the whole org log.
create function public.list_audit_actors()
returns table (actor_id uuid, actor_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('audit.view') then
    raise exception 'Permission refusée : audit.view' using errcode = '42501';
  end if;
  if v_org is null then
    return;
  end if;
  return query
    select p.user_id, p.display_name
      from public.profiles p
     where p.org_id = v_org
       and exists (select 1 from public.audit_log a where a.actor_id = p.user_id and a.org_id = p.org_id)
     order by p.display_name, p.user_id;
end;
$$;

revoke all on function
  public.list_audit_entries(text, uuid, timestamptz, timestamptz, bigint, int),
  public.list_audit_actors()
from public, anon, authenticated, service_role;
grant execute on function
  public.list_audit_entries(text, uuid, timestamptz, timestamptz, bigint, int),
  public.list_audit_actors()
to authenticated;
-- service_role is revoked above (Supabase's default privileges grant it EXECUTE):
-- these are scoped to the calling user's org (auth.uid()).

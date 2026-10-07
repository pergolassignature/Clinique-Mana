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
      left join public.profiles p on p.user_id = a.actor_id and p.org_id = a.org_id
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
      join public.profiles p on p.user_id = a.actor_id and p.org_id = a.org_id
     where a.org_id = private.current_user_org_id()
     order by p.display_name;
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

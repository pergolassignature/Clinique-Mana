-- =============================================================================
-- Core: read the imports switch (Paramètres → Modules, « Importation GOrendezvous »)
-- =============================================================================
-- Asked:   coordinator, 2026-10-14 (closing the imports needed SQL; an admin card instead).
-- Read by: `ImportsSwitchCard` (src/core/settings/components), through `fetchImportsStatus`.
--
-- * `public.get_imports_status()` (`modules.manage`, as `set_imports_open`, checked first):
--   whether the imports are open, when they were last closed, and the last change of the switch
--   (when and by whom) from the audit log (`organizations` updates whose changed fields hold
--   `imports_open`). Nothing else of the audit row leaves the function.
-- =============================================================================

create function public.get_imports_status()
returns table (
  imports_open boolean,
  imports_closed_at timestamptz,
  changed_at timestamptz,
  changed_by_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('modules.manage') then
    raise exception 'Permission refusée : modules.manage' using errcode = '42501';
  end if;
  return query
    select o.imports_open, o.imports_closed_at, a.created_at, p.display_name
      from public.organizations o
      left join lateral (
        select l.created_at, l.actor_id
          from public.audit_log l
         where l.table_name = 'organizations'
           and l.record_id = o.id::text
           and l.action = 'update'
           and l.changed_fields ? 'imports_open'
         order by l.created_at desc, l.id desc
         limit 1
      ) a on true
      left join public.profiles p on p.user_id = a.actor_id
     where o.id = v_org;
end;
$$;
revoke all on function public.get_imports_status() from public, anon, authenticated, service_role;
grant execute on function public.get_imports_status() to authenticated;

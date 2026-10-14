-- =============================================================================
-- Core: the clinic's switch for the one-time imports (security review, 2026-10-14)
-- =============================================================================
-- Asked:   coordinator, 2026-10-14 (pre-cutover security review: the import RPCs stayed callable
--          forever by ordinary permissions; also flagged by the billing review).
-- Read by: every `import_*` RPC (Clients, Facturation, Rendez-vous, Demandes, Professionnels),
--          through `private.imports_assert_open()`, in *_clients_imports_security_fixes.sql.
--
-- * `organizations.imports_open` (true by default: nothing changes until the admin closes it)
--   and `imports_closed_at` (when it was last closed). No column grant: only the RPC writes it,
--   audited by `organizations_audit` (who and when).
-- * `public.set_imports_open(p_open)` (`modules.manage`, as « Modules »: an on/off switch of
--   what the clinic accepts): the admin closes the imports after the cutover (runbook
--   « After »), and may open them again for a late run.
-- * `private.imports_assert_open()`: the caller's clinic, closed → P0001 « Les imports sont
--   fermés pour cette clinique. » (definer: `import_professional` is an invoker function).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:core_imports_switch', true);

-- A constant default: no table rewrite, a short lock.
alter table public.organizations
  add column imports_open boolean not null default true,
  add column imports_closed_at timestamptz;

-- -----------------------------------------------------------------------------
-- The guard every import RPC calls (after its own permission checks)
-- -----------------------------------------------------------------------------
create function private.imports_assert_open()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce((select o.imports_open from public.organizations o where o.id = private.current_user_org_id()), false) then
    raise exception 'Les imports sont fermés pour cette clinique.' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function private.imports_assert_open() from public, anon, authenticated, service_role;
grant execute on function private.imports_assert_open() to authenticated;

-- -----------------------------------------------------------------------------
-- The switch (modules.manage)
-- -----------------------------------------------------------------------------
-- Returns {imports_open, imports_closed_at}.
create function public.set_imports_open(p_open boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_row record;
begin
  if not private.has_permission('modules.manage') then
    raise exception 'Permission refusée : modules.manage' using errcode = '42501';
  end if;
  if p_open is null or v_org is null then
    raise exception 'Invalid arguments' using errcode = '22023';
  end if;
  update public.organizations o
     set imports_open = p_open,
         imports_closed_at = case when p_open then o.imports_closed_at else pg_catalog.now() end
   where o.id = v_org
  returning o.imports_open, o.imports_closed_at into v_row;
  return pg_catalog.jsonb_build_object('imports_open', v_row.imports_open, 'imports_closed_at', v_row.imports_closed_at);
end;
$$;
revoke all on function public.set_imports_open(boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_imports_open(boolean) to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);

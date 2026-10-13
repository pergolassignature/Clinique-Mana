-- =============================================================================
-- Clients: the consents' names, published for the modules that show a consent's state
-- =============================================================================
-- Asked:   Rendez-vous' consent prompt (AP-32, *_appointments_parity.sql): the booking and the
--          appointment say which consent is missing, by its name, to staff and professionals who do
--          not read Clients' tables (CLAUDE.md §5: never another module's raw tables).
-- Rules:   docs/standards/database-conventions.md; docs/modules/clients.md « What the module publishes ».
--
-- * private.clients_consent_names(org): (key, name_fr, name_en) of the clinic's consents. Granted to no
--   role; called from the other modules' definer RPCs after their own permission check.
-- * Additive: one new private function.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:clients_consent_names', true);

create function private.clients_consent_names(p_org uuid)
returns table (key text, name_fr text, name_en text)
language sql
stable
set search_path = ''
as $$
  select t.key, t.name_fr, t.name_en from public.client_consent_types t where t.org_id = p_org
$$;
revoke all on function private.clients_consent_names(uuid) from public, anon, authenticated, service_role;

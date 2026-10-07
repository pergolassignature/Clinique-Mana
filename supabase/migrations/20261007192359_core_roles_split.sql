-- =============================================================================
-- Roles: « Conseillère » and « Adjointe administrative » replace `staff`
-- =============================================================================
-- Design:  docs/plans/2026-10-07-phase-2-core-settings-design.md §2 (decision #23)
-- Also adds core permission settings.bank_manage (admin), used by core_bank_details.
-- Role defaults for professionals.view live here because the role is new; the
-- permission itself belongs to the professionals module.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:core_roles_split', true);

insert into public.roles (key, name, is_system) values
  ('counselor',       'Conseillère',             true),
  ('admin_assistant', 'Adjointe administrative', true)
on conflict do nothing;

insert into public.permissions (key, module_key, description) values
  ('settings.bank_manage', 'core', 'Voir et modifier les coordonnées bancaires de la clinique')
on conflict do nothing;

insert into public.role_permissions (role, permission_key) values
  ('admin',           'settings.bank_manage'),
  ('counselor',       'professionals.view'),
  ('admin_assistant', 'professionals.view'),
  ('admin_assistant', 'settings.view')
on conflict do nothing;

-- Any remaining staff account becomes an adjointe (none on staging when written).
update public.user_roles set role = 'admin_assistant' where role = 'staff';

delete from public.role_permissions where role = 'staff';
delete from public.roles where key = 'staff';

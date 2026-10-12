-- Communications, the module's registry (migration *_communications_module.sql): the module row,
-- its first permissions and their role defaults, propagated to every clinic; disabled by default.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');

select results_eq($$ select name from public.modules where key = 'communications' $$, $$ values ('Communications') $$, 'module registered');
select is_empty($$ select 1 from public.module_dependencies where module_key = 'communications' $$, 'no dependency (core only)');
select results_eq($$
  select p.key, p.module_key from public.permissions p where p.key in ('communications.inbox', 'communications.mailboxes_manage') order by 1
$$, $$ values ('communications.inbox', 'communications'), ('communications.mailboxes_manage', 'communications') $$, 'the two CM1 permissions');
select results_eq($$
  select r.role, r.permission_key from public.role_permissions r
   where r.permission_key in ('communications.inbox', 'communications.mailboxes_manage') order by 1, 2
$$, $$ values ('admin', 'communications.inbox'), ('admin', 'communications.mailboxes_manage') $$,
  'template defaults: the admin only (a default of a disabled module would block the role RPCs, see the migration)');
select results_eq($$
  select r.role, r.permission_key from public.org_role_permissions r
   where r.org_id = 'b0000000-0000-0000-0000-00000000000a' and r.permission_key in ('communications.inbox', 'communications.mailboxes_manage') order by 1, 2
$$, $$ values ('admin', 'communications.inbox'), ('admin', 'communications.mailboxes_manage') $$,
  'a new clinic gets the defaults');
-- No org_modules row until an admin switches it (module_enabled reads the row's absence as off).
select is((select coalesce(bool_or(enabled), false) from public.org_modules
            where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'communications'),
  false, 'disabled in a new clinic');

select * from finish();
rollback;

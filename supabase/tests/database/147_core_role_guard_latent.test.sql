-- Core, giving a role whatever the modules' state (migration *_core_role_guard_latent, CC-15):
-- privileges; the latent permissions (every module counted, overrides applied); the adjointe gives
-- « Conseillère » while Communications is off; a role with a permission she does not hold by any
-- means is still refused (on or off); her own refusal (an override) still refuses; the copy of a
-- role; the invitations' keys; switching the module on gives the giver the same permissions as the
-- person given the role; Communications' defaults back for Conseillère and Adjointe.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select function_privs_are('private', 'permission_keys_latent_for', array['uuid'], 'authenticated', array[]::text[], 'permission_keys_latent_for: no role');
select results_eq($$ select role, permission_key from public.role_permissions
                     where permission_key in ('communications.inbox', 'communications.sms') order by 2, 1 $$,
  $$ values ('admin'::text, 'communications.inbox'::text), ('admin_assistant', 'communications.inbox'), ('counselor', 'communications.inbox'),
            ('admin', 'communications.sms'), ('admin_assistant', 'communications.sms'), ('counselor', 'communications.sms') $$,
  'Communications'' plan defaults: admin, Conseillère, Adjointe');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@rg.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adj@rg.test',   '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'new@rg.test',   '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@rg.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'adj@rg.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Nouvelle A', 'new@rg.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant');
-- The adjointe manages the users and the roles; every module but Communications is on.
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'users.manage', true),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'users.view', true),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'roles.manage', true);
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true
  from (values ('professionals'), ('services'), ('clients'), ('demandes'), ('appointments'), ('billing'), ('reports')) as y(m);

-- The latent permissions count the module that is off; the effective ones do not.
select ok('communications.inbox' = any (private.permission_keys_latent_for('a0000000-0000-0000-0000-000000000002'))
          and not 'communications.inbox' = any (private.permission_keys_for('a0000000-0000-0000-0000-000000000002')),
  'the adjointe holds communications.inbox by her role (latent), not in effect (module off)');
select ok('communications.inbox' = any ((private.staff_inviter('a0000000-0000-0000-0000-000000000002')).keys),
  'the invitations'' hold rule reads the latent keys');

-- An admin makes a role carrying a permission the adjointe holds by no means.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.k', public.create_role('Gestion des boîtes'), true);
select public.set_role_permission(current_setting('test.k'), 'communications.mailboxes_manage', true);

-- The adjointe, Communications off.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.set_user_role('a0000000-0000-0000-0000-000000000003', 'counselor') $$,
  'the adjointe gives « Conseillère » while Communications is off');
select throws_ok(format($$ select public.set_user_role('a0000000-0000-0000-0000-000000000003', %L) $$, current_setting('test.k')),
  'P0001', 'Vous ne pouvez pas attribuer un rôle qui donne des permissions que vous n''avez pas.',
  'a role with a permission she holds by no means: refused, module off');
select lives_ok($$ select public.create_role('Conseillère bis', 'counselor') $$, 'she copies « Conseillère »');
select throws_ok(format($$ select public.create_role('Copie', %L) $$, current_setting('test.k')),
  'P0001', 'Vous ne pouvez pas copier un rôle qui donne des permissions que vous n''avez pas.', '… not the role she cannot give');
reset role;

-- Switched on: the person given the role holds nothing the giver does not.
insert into public.org_modules (org_id, module_key, enabled) values ('b0000000-0000-0000-0000-00000000000a', 'communications', true);
select is_empty($$ select k from pg_catalog.unnest(private.permission_keys_for('a0000000-0000-0000-0000-000000000003')) k
                    except select k from pg_catalog.unnest(private.permission_keys_for('a0000000-0000-0000-0000-000000000002')) k $$,
  'module on: the conseillère holds nothing the adjointe does not');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(format($$ select public.set_user_role('a0000000-0000-0000-0000-000000000003', %L) $$, current_setting('test.k')),
  'P0001', 'Vous ne pouvez pas attribuer un rôle qui donne des permissions que vous n''avez pas.', '… and the other role still refused, module on');
reset role;

-- Her own refusal (an override) still refuses, module off.
delete from public.org_modules where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'communications';
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'communications.inbox', false);
update public.user_roles set role = 'admin_assistant' where user_id = 'a0000000-0000-0000-0000-000000000003';
select ok(not 'communications.inbox' = any (private.permission_keys_latent_for('a0000000-0000-0000-0000-000000000002')),
  'an override refusing it: not held, even latent');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.set_user_role('a0000000-0000-0000-0000-000000000003', 'counselor') $$,
  'P0001', 'Vous ne pouvez pas attribuer un rôle qui donne des permissions que vous n''avez pas.', '… so « Conseillère » is refused');
reset role;
-- An inactive user holds nothing.
update public.profiles set status = 'disabled' where user_id = 'a0000000-0000-0000-0000-000000000002';
select is(private.permission_keys_latent_for('a0000000-0000-0000-0000-000000000002'), '{}'::text[], 'a disabled account holds nothing');

select * from finish();
rollback;

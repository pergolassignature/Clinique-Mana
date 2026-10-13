-- Demandes: the « Provenance » corrected (migration *_demandes_source_edit.sql, D-26): the channel
-- and the declared source, by demandes.manage, of the clinic's own list; the booking page's
-- capture untouched; audited before and after.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'set_demande_source'
     and (not p.prosecdef or not has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
$$, 'set_demande_source: SECURITY DEFINER, authenticated, not anon');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@ds.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 3) n;
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u1@ds.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'u2@ds.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'u3@ds.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled)
select o.id, m.key, true
  from (values ('b0000000-0000-0000-0000-00000000000a'::uuid), ('b0000000-0000-0000-0000-00000000000b'::uuid)) o(id)
 cross join (values ('professionals'), ('clients'), ('demandes')) m(key);
insert into public.referral_sources (id, org_id, key, name) values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'instagram_test', 'Instagram'),
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'ami_test', 'Un ami'),
  ('e0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'ailleurs_test', 'Ailleurs');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.d', public.create_demande(jsonb_build_object(
  'contact_name', 'Bruno Page', 'contact_phone_e164', '+15145550122', 'channel', 'phone',
  'referral_source_id', 'e0000000-0000-0000-0000-000000000001', 'source_campaign', 'automne'))::text, true);

select lives_ok(format($$ select public.set_demande_source(%L, 'email', 'e0000000-0000-0000-0000-000000000002') $$, current_setting('test.d')),
  'the counselor corrects the channel and the declared source');
reset role;
select results_eq($$ select channel, referral_source_id::text, source_campaign from public.demandes where id = current_setting('test.d')::uuid $$,
  $$ values ('email', 'e0000000-0000-0000-0000-000000000002', 'automne') $$, 'both changed; the campaign captured stays as it was');
select results_eq($$
  select changed_fields -> 'channel' ->> 'before', changed_fields -> 'channel' ->> 'after',
         changed_fields -> 'referral_source_id' ->> 'after', source
    from public.audit_log
   where table_name = 'demandes' and record_id = current_setting('test.d') and action = 'update'
   order by id desc limit 1 $$,
  $$ values ('phone', 'email', 'e0000000-0000-0000-0000-000000000002', 'rpc:set_demande_source') $$,
  'audited: before and after, by the RPC');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(format($$ select public.set_demande_source(%L, 'email', null) $$, current_setting('test.d')), '« Non précisé »');
reset role;
select is((select referral_source_id from public.demandes where id = current_setting('test.d')::uuid), null, '… the declared source removed');
select is((select count(*)::int from public.audit_log where table_name = 'demandes' and record_id = current_setting('test.d') and action = 'update'), 2,
  'one audit row per change');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(format($$ select public.set_demande_source(%L, 'email', null) $$, current_setting('test.d')), 'the same values again: nothing to save');
select throws_ok(format($$ select public.set_demande_source(%L, 'pigeon', null) $$, current_setting('test.d')),
  'P0001', 'Choisissez un canal de la liste.', 'a channel off the list is refused');
select throws_ok(format($$ select public.set_demande_source(%L, 'email', 'e0000000-0000-0000-0000-000000000009') $$, current_setting('test.d')),
  'P0001', 'Choisissez une provenance de la liste de la clinique.', 'another clinic''s source is refused');

-- Permissions, clinics.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(format($$ select public.set_demande_source(%L, 'phone', null) $$, current_setting('test.d')),
  '42501', null, 'a professional changes nothing');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(format($$ select public.set_demande_source(%L, 'phone', null) $$, current_setting('test.d')),
  'P0001', 'Cette demande n''existe pas.', 'another clinic''s admin finds nothing');

select * from finish();
rollback;

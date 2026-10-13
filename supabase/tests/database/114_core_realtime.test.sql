-- Core realtime (migration *_core_realtime.sql): one private broadcast channel per clinic and
-- module, joined only by members holding a permission of the module; triggers send ids only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@rt.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 4) n;
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u1@rt.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'u2@rt.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Inactive A', 'u3@rt.test', 'disabled'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'u4@rt.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled)
select o.id, m.key, true
  from (values ('b0000000-0000-0000-0000-00000000000a'::uuid), ('b0000000-0000-0000-0000-00000000000b'::uuid)) o(id)
 cross join (values ('professionals'), ('clients'), ('demandes')) m(key);
select set_config('test.topic_a', 'org:b0000000-0000-0000-0000-00000000000a:demandes', true);

-- The policy and the helpers.
select ok(exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
                   and policyname = 'org_module_broadcast_receive' and cmd = 'SELECT' and 'authenticated' = any (roles)),
  'realtime.messages: a select policy for authenticated');
select is_empty($$ select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
                   and cmd in ('INSERT', 'ALL') and qual like '%realtime_topic_allowed%' $$,
  'no one sends from the browser (no insert policy of ours)');
select ok((select p.prosecdef from pg_proc p where p.oid = 'private.realtime_topic_allowed(text)'::regprocedure),
  'realtime_topic_allowed is SECURITY DEFINER (the policy calls it)');
select ok(not has_function_privilege('anon', 'private.realtime_topic_allowed(text)', 'execute')
          and not has_function_privilege('authenticated', 'private.broadcast_record_change()', 'execute'),
  'anon cannot ask; nobody calls the trigger function');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok(private.realtime_topic_allowed(current_setting('test.topic_a')), 'the counselor joins her clinic''s Demandes channel');
select ok(not private.realtime_topic_allowed('org:b0000000-0000-0000-0000-00000000000b:demandes'), 'not another clinic''s');
select ok(not private.realtime_topic_allowed('org:b0000000-0000-0000-0000-00000000000a:billing'), 'not a module she holds nothing of');
select ok(not private.realtime_topic_allowed('org:b0000000-0000-0000-0000-00000000000a:demandes:extra')
          and not private.realtime_topic_allowed('anything') and not private.realtime_topic_allowed(null), 'a malformed topic is refused');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select ok(private.realtime_topic_allowed(current_setting('test.topic_a')), 'the professional (demandes.self) joins it too: ids only travel');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(not private.realtime_topic_allowed(current_setting('test.topic_a')), 'a disabled member does not');
reset role;
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'demandes';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok(not private.realtime_topic_allowed(current_setting('test.topic_a')), 'a disabled module''s channel is closed');
reset role;
update public.org_modules set enabled = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'demandes';

-- A change announces ids only (when the realtime service made today's partition: CI may not yet).
select set_config('test.partition', (exists (
  select 1 from pg_inherits i join pg_class c on c.oid = i.inhrelid
   where i.inhparent = 'realtime.messages'::regclass
     and c.relname = 'messages_' || to_char(now() at time zone 'utc', 'YYYY_MM_DD')))::text, true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.d', public.create_demande('{"contact_name": "Temps Réel", "contact_phone_e164": "+15145550111"}')::text, true);
select public.add_demande_task(current_setting('test.d')::uuid, 'callback', now() + interval '1 day', null);
reset role;
select case when current_setting('test.partition')::boolean then
  results_eq($$ select (select array_agg(k order by k) from jsonb_object_keys(m.payload) k), m.payload->>'record_id', m.payload->>'op', m.private
                  from realtime.messages m
                 where m.topic = current_setting('test.topic_a') and m.payload->>'table' = 'demandes'
                 order by m.inserted_at limit 1 $$,
             $$ values (array['id', 'module', 'op', 'record_id', 'table'], current_setting('test.d'), 'insert', true) $$,
             'the new request is announced: module, table, record id and op, privately; no field of the row')
  else skip('no realtime.messages partition for today', 1) end;
select case when current_setting('test.partition')::boolean then
  ok(not exists (select 1 from realtime.messages m where m.topic = current_setting('test.topic_a')
                  and (m.payload::text like '%Temps%' or m.payload::text like '%5550111%')),
     'neither the name nor the phone travels')
  else skip('no realtime.messages partition for today', 1) end;
select case when current_setting('test.partition')::boolean then
  ok(exists (select 1 from realtime.messages m where m.topic = current_setting('test.topic_a')
              and m.payload->>'record_id' = current_setting('test.d') and m.payload->>'table' = 'demandes'
              and m.payload->>'op' = 'insert'
            group by m.payload->>'record_id' having count(*) >= 2),
     'a task of the request announces the request (the screens re-read one record)')
  else skip('no realtime.messages partition for today', 1) end;

select * from finish();
rollback;

-- Communications CM4, « Rédiger avec l'IA » (migration *_communications_ai_draft): permissions and
-- their defaults; privileges; the settings (off and with the defaults until set, refused without a
-- key, the checks in French), RLS; the composer's status; the service context (the actor's right,
-- the file's person, the sender, the clinic); the calls recorded without text, the month's spending
-- and the cap.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

select results_eq($$ select role, permission_key from public.role_permissions
                     where permission_key in ('communications.ai_draft', 'communications.ai_manage') order by 2, 1 $$,
  $$ values ('admin'::text, 'communications.ai_draft'::text), ('admin_assistant', 'communications.ai_draft'), ('counselor', 'communications.ai_draft'),
            ('admin', 'communications.ai_manage') $$,
  'drafting for Conseillère, Adjointe and admin; the settings for the admin');
select function_privs_are('public', f, a, 'authenticated', array['EXECUTE'], f || ': authenticated')
  from (values ('get_ai_settings', array[]::text[]), ('get_ai_draft_status', array[]::text[]),
               ('set_ai_settings', array['boolean', 'text', 'integer', 'numeric', 'numeric'])) as x(f, a);
select function_privs_are('public', f, a, 'authenticated', array[]::text[], f || ': service role only')
  from (values ('ai_draft_context_for_service', array['uuid', 'uuid', 'uuid', 'uuid']),
               ('record_ai_request_for_service', array['uuid', 'uuid', 'text', 'text', 'text', 'text', 'integer', 'integer', 'numeric'])) as x(f, a);
select table_privs_are('public', 'ai_requests', 'authenticated', array['SELECT'], 'ai_requests: select only');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@ai.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cons@ai.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pro@ai.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Clinique A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@ai.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'cons@ai.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'pro@ai.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('communications'), ('professionals'), ('clients')) as y(m);
insert into public.clients (id, org_id, first_name, last_name, email) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Camille', 'Fictive', 'camille@ai.test');

-- The admin: off, the defaults; switching on needs the key.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select (s ->> 'enabled')::boolean, s ->> 'model', (s ->> 'monthly_cap_cents')::int, (s ->> 'key_configured')::boolean
                       from (select public.get_ai_settings() s) x $$,
  $$ values (false, 'gpt-5.4'::text, 5000, false) $$, 'off until set: gpt-5.4, 50 $ a month, no key');
select throws_ok($$ select public.set_ai_settings(true, 'gpt-5.4', 5000, 125, 1000) $$,
  'P0001', 'Entrez d''abord la clé OpenAI de la clinique.', 'switched on without the key: refused');
select throws_ok($$ select public.set_ai_settings(false, 'GPT 5 !', 5000, 125, 1000) $$,
  'P0001', 'Le modèle s''écrit comme OpenAI le nomme (par exemple gpt-5.4).', 'a model name OpenAI would not know: refused');
select throws_ok($$ select public.set_ai_settings(false, 'gpt-5.4', -1, 125, 1000) $$,
  'P0001', 'Le plafond mensuel est entre 0 $ et 10 000 $.', 'a negative cap: refused');
select public.set_org_secret('openai_api_key', 'sk-test-local');
select lives_ok($$ select public.set_ai_settings(true, 'gpt-5.4', 2000, 125, 1000) $$, 'with the key: switched on, a 20 $ cap');

-- The conseillère: the composer's status, no settings.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(public.get_ai_draft_status(), '{"available": true, "cap_reached": false}'::jsonb, 'the composer shows « Rédiger avec l''IA »');
select throws_ok($$ select public.get_ai_settings() $$, '42501', null, 'the conseillère does not see the settings');
select is_empty($$ select 1 from public.ai_settings $$, '… nor the row (RLS)');
-- The professional drafts nothing.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.get_ai_draft_status() $$, '42501', null, 'the professional: refused');
reset role;

-- The service context: the right, the person of the file, the names to hide.
select results_eq($$ select c -> 'person' ->> 'first_name', c -> 'person' ->> 'last_name', c ->> 'sender_name', c ->> 'clinic_name', (c ->> 'enabled')::boolean
                       from (select public.ai_draft_context_for_service('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002',
                                                                         'd0000000-0000-0000-0000-000000000001', null) c) x $$,
  $$ values ('Camille'::text, 'Fictive'::text, 'Conseillère A'::text, 'Clinique A'::text, true) $$, 'the context names the person, the sender and the clinic');
select throws_ok($$ select public.ai_draft_context_for_service('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', null, null) $$,
  '42501', null, 'the context: the professional refused');

-- Calls recorded, never the text; the month's spending and the cap.
select public.record_ai_request_for_service('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'gpt-5.4', 'write', 'ok', null, 800, 300, 1500);
select public.record_ai_request_for_service('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'gpt-5.4', 'refine', 'ok', null, 900, 250, 600);
select is((public.ai_draft_context_for_service('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', null, null) ->> 'month_spent_cents')::numeric,
  2100::numeric, 'the month''s spending');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(public.get_ai_draft_status() ->> 'cap_reached', 'true', 'over the 20 $ cap: the composer says so');
reset role;
select is_empty($$ select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_requests'
                    and column_name ~ '(text|prompt|body|content|instruction)$' $$, 'ai_requests holds no text column');

select * from finish();
rollback;

-- « Réécrire une sélection » (migration *_communications_ai_rewrite.sql, decision CM-29). Covers: the
-- usage log takes a selection rewrite as its own kind, `rewrite`, beside write, reply and refine;
-- any other kind is still refused; the month's spending counts a rewrite like any other call.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

-- =============================================================================
-- Fixtures (as postgres): org A and its conseillère.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'u1@rw.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Clinique A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u1@rw.test', 'active');

select lives_ok($$ select public.record_ai_request_for_service('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001', 'gpt-5.4', 'rewrite', 'ok', null, 400, 120, 250) $$,
  'a selection rewrite is recorded as its own kind');
select is((select kind from public.ai_requests where org_id = 'b0000000-0000-0000-0000-00000000000a'), 'rewrite',
  'the log says « rewrite », not another kind');
select throws_ok($$ select public.record_ai_request_for_service('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001', 'gpt-5.4', 'translate', 'ok', null, 1, 1, 1) $$,
  '23514', null, 'any other kind is still refused');
select is(private.ai_month_spent_cents('b0000000-0000-0000-0000-00000000000a'), 250::numeric,
  'a rewrite counts in the month''s spending like any other call');

select * from finish();
rollback;

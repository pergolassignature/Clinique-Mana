-- The clinic rewords the questionnaire's steps itself (migration
-- *_professionals_questionnaire_texts.sql, decision P4-562, answering Jonathan's question of
-- 22 October 2026). Covers: a step's title and description are stored per clinic, trimmed, with
-- who reworded them; blanking one gives the app's own text back and blanking both deletes the
-- row; « Révision » is a step like the others and an unknown one is refused in French; writing
-- needs `professionals.settings`, while everyone who reads the module's lists reads them — the
-- professional filling her questionnaire included, since she holds nothing else.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

create function private.test_error_hint(p_sql text) returns text
language plpgsql set search_path = '' as $$
declare
  v_hint text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return nullif(v_hint, '');
end;
$$;
create function private.test_error_message(p_sql text) returns text
language plpgsql set search_path = '' as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;
grant execute on function private.test_error_hint(text), private.test_error_message(text) to authenticated;

-- =============================================================================
-- Fixtures: clinic A with an admin, a conseillère (no professionals.settings) and a provider
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@qt.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 3) n;
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@qt.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u2@qt.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'u3@qt.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Ana', 'Un', 'u3@qt.test', 'active');

-- =============================================================================
-- The admin rewords a step
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is((public.set_questionnaire_section_text('languages', null, '  Les langues que vous parlez avec vos clients.  ')) ->> 'description',
  'Les langues que vous parlez avec vos clients.', 'a description is stored, trimmed');
select is((select x.title from public.questionnaire_section_texts x
            where x.org_id = 'b0000000-0000-0000-0000-00000000000a' and x.section = 'languages'),
  null, '… and the title is left to the app''s own text');
select is((public.set_questionnaire_section_text('languages', 'Vos langues', 'Les langues que vous parlez avec vos clients.')) ->> 'title',
  'Vos langues', 'a title is added to the same step');
select is((select count(*)::int from public.questionnaire_section_texts x
            where x.org_id = 'b0000000-0000-0000-0000-00000000000a'), 1, '… still one row for that step');
select ok((select x.updated_by = 'a0000000-0000-0000-0000-000000000001' from public.questionnaire_section_texts x
            where x.org_id = 'b0000000-0000-0000-0000-00000000000a' and x.section = 'languages'),
  '… and the row records who reworded it');
select is((public.set_questionnaire_section_text('review', 'Dernier coup d''œil', null)) ->> 'title',
  'Dernier coup d''œil', '« Révision et envoi » is a step like the others');

-- Blanking one field gives the app's text back; blanking both removes the row.
select is((public.set_questionnaire_section_text('languages', 'Vos langues', '   ')) ->> 'description',
  null, 'a blank description gives the app''s own text back');
select is(public.set_questionnaire_section_text('languages', '', '   '), null::jsonb,
  'blanking both answers nothing');
select is((select count(*)::int from public.questionnaire_section_texts x
            where x.org_id = 'b0000000-0000-0000-0000-00000000000a' and x.section = 'languages'), 0,
  '… and the row is gone, so the step reads as the app wrote it');

-- A step that does not exist.
select is(private.test_error_hint($$ select public.set_questionnaire_section_text('approches', null, 'Texte') $$),
  'section', 'a step that is not in the questionnaire is refused');
select is(private.test_error_message($$ select public.set_questionnaire_section_text('approches', null, 'Texte') $$),
  'Cette étape du questionnaire n''existe pas.', '… in French');

-- =============================================================================
-- Who may write, and who may read
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.set_questionnaire_section_text('motifs', null, 'Texte') $$, '42501', null,
  'a conseillère without professionals.settings cannot reword a step');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.questionnaire_section_texts), 1,
  'the professional filling her questionnaire reads them (« Révision » is still reworded)');
select is((public.get_questionnaire_section_texts()) #>> '{review,title}', 'Dernier coup d''œil',
  '… and reads them through the RPC the questionnaire calls');
reset role;

select * from finish();
rollback;

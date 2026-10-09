-- Professionnels: the last P0001 messages written in English are French (migration
-- *_professionals_french_messages.sql, the 4b review's « trois messages SQL internes en anglais »).
-- link_professional_account raises them inside its own block and answers link_invalid, so the
-- behaviour (051_professionals_onboarding) is unchanged; only the text is.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select ok(
  (select p.prosrc !~ '(Inviter without|Invitation sent to another address|Inactive file)'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'link_professional_account'),
  'link_professional_account: no English message left');
select ok(
  (select p.prosrc ~ 'ne peut plus inviter de professionnels'
      and p.prosrc ~ 'envoyée à une autre adresse que celle du dossier'
      and p.prosrc ~ 'Ce dossier est inactif'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'link_professional_account'),
  'link_professional_account: the three messages in French');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosrc ~ '(Inviter without professionals|Invitation sent to another address|''Inactive file'')'),
  0,
  'no function of the catalog keeps the English texts');

-- The definition is unchanged otherwise: still security definer, search_path '', service role only.
select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'link_professional_account'),
  'link_professional_account: security definer with an empty search_path');
select ok(
  not has_function_privilege('authenticated', 'public.link_professional_account(bytea, uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.link_professional_account(bytea, uuid, jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.link_professional_account(bytea, uuid, jsonb)', 'execute'),
  'link_professional_account: the service role only, as before');

select * from finish();
rollback;

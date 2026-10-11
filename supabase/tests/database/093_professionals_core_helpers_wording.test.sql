-- Professionnels: core tables through core helpers, plain words in the refusals (migration
-- *_professionals_core_helpers_wording.sql, gap audit T1, T8, C4, C5). Covers: the two
-- redefined helpers no longer touch stored_files / email_log and keep their privileges (their
-- behaviour: 052, 072 and 086); no function's refusal says « compte au plus », « soumission »,
-- « échue » or an ISO date (each reworded refusal is asserted where its RPC is tested: 007, 043,
-- 050, 051, 058, 065); the email defaults and the permission's description lose « dossier » /
-- « échue » / « soumissions ».
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

-- =============================================================================
-- T1: through core's helpers
-- =============================================================================
select ok((select p.prosrc !~ 'public\.stored_files' and p.prosrc ~ 'private\.set_stored_files_owner'
             from pg_proc p where p.oid = 'private.own_professional_document_files(uuid)'::regprocedure),
  'own_professional_document_files re-owns files through set_stored_files_owner, not stored_files');
select ok((select p.prosrc !~ 'public\.email_log' and p.prosrc ~ 'private\.latest_subject_email'
             from pg_proc p where p.oid = 'private.professional_invitations_due_for_reminder(uuid, uuid, int)'::regprocedure),
  'the invitation reminder reads the sent reminder through latest_subject_email, not email_log');
select function_privs_are('private', f.name, f.args, r.role, array[]::text[], f.name || ': still no EXECUTE for ' || r.role)
  from (values
    ('own_professional_document_files', array['uuid']),
    ('professional_invitations_due_for_reminder', array['uuid', 'uuid', 'integer'])
  ) as f(name, args)
  cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role);

-- =============================================================================
-- T8, C4, C5: no refusal says it that way any more (every function of public and private)
-- =============================================================================
select is_empty($$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname in ('public', 'private') and p.prosrc ~ 'compte au plus' $$,
  'T8: no « … compte au plus N caractères »');
select is_empty($$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname in ('public', 'private') and p.prosrc ~* 'raise exception ''[^'']*soumission' $$,
  'C4: no refusal says « soumission »');
select is_empty($$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname in ('public', 'private') and p.prosrc ~* 'raise exception ''[^'']*[ée]chue' $$,
  'C4: no refusal says an insurance is « échue »');
select is_empty($$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname in ('public', 'private')
                      and (p.prosrc ~ 'raise exception[^;]*YYYY-MM-DD' or p.prosrc ~ 'raise exception ''[^'']*\d{4}-\d{2}-\d{2}') $$,
  'C5: no refusal names an ISO date');

-- =============================================================================
-- C4: the defaults and the permission
-- =============================================================================
select is((select d.button_label from public.email_template_defaults d where d.key = 'professionals.submission_received'),
  'Réviser le profil', 'the reviewers'' email button: « Réviser le profil »');
select results_eq($$ select d.key, d.label from public.email_template_defaults d
                      where d.key like 'professionals.document_expir%' order by d.key $$,
  $$ values ('professionals.document_expired'::text, 'Assurance expirée'::text),
            ('professionals.document_expired_reminder', 'Rappel : assurance expirée'),
            ('professionals.document_expiring', 'Assurance expire bientôt') $$,
  'the insurance email labels say « expire »');
select is((select d.subject from public.email_template_defaults d where d.key = 'professionals.document_expired'),
  'Votre assurance est expirée', '… and the expired one''s subject');
select is_empty($$ select 1 from public.email_template_defaults d
                    where d.key like 'professionals.%' and (d.label || d.description || d.subject || d.body) ~* '[ée]chue' $$,
  'no « échue » left in the module''s email defaults');
select is((select p.description from public.permissions p where p.key = 'professionals.review'),
  'Réviser et appliquer les profils envoyés', 'the review permission says « profils envoyés »');

select * from finish();
rollback;

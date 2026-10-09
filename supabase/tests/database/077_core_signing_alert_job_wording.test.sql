-- Core: the unsaved-signed-documents alert's description in plain French (migration
-- *_core_signing_alert_job_wording.sql): no « VM », the new last sentence, the rest unchanged.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

select ok((select description not like '%VM%' from public.scheduled_jobs where key = 'core.signing_unsaved_alert'),
  'no « VM » in the description');
select ok((select description like '%. Le serveur de signature n''est pas sauvegardé : les PDF signés sont copiés ici dès qu''ils existent.'
             from public.scheduled_jobs where key = 'core.signing_unsaved_alert'),
  'it ends with the plain sentence');
select ok((select description like 'Avertit dans « À surveiller » les personnes qui gèrent la signature électronique%'
             from public.scheduled_jobs where key = 'core.signing_unsaved_alert'),
  'the rest of the description is unchanged');

select * from finish();
rollback;

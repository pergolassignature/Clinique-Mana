-- Core: « Tâches planifiées » describes the unsaved-signed-documents alert in plain French.
--
-- The job's description (*_core_signing_capture.sql) ended with « La VM Documenso n'est pas
-- sauvegardée. », jargon for the clinic's owner. It now ends with « Le serveur de signature n'est pas
-- sauvegardé : les PDF signés sont copiés ici dès qu'ils existent. » Applied only while the
-- catalogue row still has the migration's text (catalogue rows: git is their history).

update public.scheduled_jobs
   set description = pg_catalog.replace(description, 'La VM Documenso n''est pas sauvegardée.',
                       'Le serveur de signature n''est pas sauvegardé : les PDF signés sont copiés ici dès qu''ils existent.')
 where key = 'core.signing_unsaved_alert'
   and description like '%La VM Documenso n''est pas sauvegardée.';

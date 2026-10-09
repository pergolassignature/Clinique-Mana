-- Professionnels: the fiche email reads « Fiche d'Aurélie Essai », not « Fiche de Aurélie Essai ».
--
-- The default template of `professionals.fiche` (*_professionals_fiche_email.sql) put « de » before
-- the name. `professionals-fiche` now also sends `professional.of_name`, « de » + the name elided
-- before a vowel or a y (never a h): « d'Aurélie Essai », « de Marie Tremblay » (`ofName`). The
-- default's subject and its body's sentence use it, and the variable is declared (the renderer
-- refuses an undeclared one). Only the default changes: a clinic's own template (« Courriels »)
-- keeps its text and may use the new variable. Applied only while the default still has the
-- migration's text.

update public.email_template_defaults
   set subject = 'Fiche {{professional.of_name}}',
       body = pg_catalog.replace(body, 'Voici la fiche de {{professional.name}}', 'Voici la fiche {{professional.of_name}}'),
       variables = (
         select pg_catalog.jsonb_agg(v order by o)
           from (
             select v, o from pg_catalog.jsonb_array_elements(variables) with ordinality as e(v, o)
             union all
             select '{"path": "professional.of_name", "label": "« de » et le nom du professionnel", "sample": "de Geneviève Tremblay", "required": true, "kind": "text"}'::jsonb, 1.5
           ) x)
 where key = 'professionals.fiche'
   and subject = 'Fiche de {{professional.name}}'
   and not variables @> '[{"path": "professional.of_name"}]';

-- Professionnels: the fiche email's default reads « Fiche {{professional.of_name}} » (migration
-- *_professionals_fiche_email_elision.sql): the subject, the body's sentence, the declared variable
-- after professional.name, the rest of the template unchanged.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select is((select subject from public.email_template_defaults where key = 'professionals.fiche'),
  'Fiche {{professional.of_name}}', 'the subject elides through professional.of_name');
select ok((select body like '%Voici la fiche {{professional.of_name}}, en pièce jointe.%' from public.email_template_defaults where key = 'professionals.fiche'),
  'the body''s sentence too');
select ok((select body not like '%fiche de {{professional.name}}%' from public.email_template_defaults where key = 'professionals.fiche'),
  'no « de {{professional.name}} » is left');
select is((select pg_catalog.array_agg(v ->> 'path' order by o)
             from public.email_template_defaults d, pg_catalog.jsonb_array_elements(d.variables) with ordinality as e(v, o)
            where d.key = 'professionals.fiche'),
  array['professional.name', 'professional.of_name', 'message'], 'professional.of_name is declared after professional.name');
select is((select v from public.email_template_defaults d, pg_catalog.jsonb_array_elements(d.variables) v
            where d.key = 'professionals.fiche' and v ->> 'path' = 'professional.of_name'),
  '{"path": "professional.of_name", "label": "« de » et le nom du professionnel", "sample": "de Geneviève Tremblay", "required": true, "kind": "text"}'::jsonb,
  'its label, sample and kind');

select * from finish();
rollback;

-- Professionnels: one rule for an insurance's dates (migration *_professionals_insurance_dates_wording.sql,
-- gap audit V12, P4-511). Covers: the three insurance email defaults name the last valid day as
-- « valide jusqu'au » (never « prend fin le » / « a pris fin le »), their placeholders unchanged;
-- the notices are covered by 062.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select is((select d.subject from public.email_template_defaults d where d.key = 'professionals.document_expiring'),
  'Votre assurance est valide jusqu''au {{document.expires_on}}', '« bientôt échue »: the subject names the last valid day');
select ok((select d.body ~ 'a à votre dossier est valide jusqu''au \{\{document\.expires_on\}\}\.'
             from public.email_template_defaults d where d.key = 'professionals.document_expiring'),
  '… and so does its body');
select is((select count(*)::int from public.email_template_defaults d
            where d.key in ('professionals.document_expired', 'professionals.document_expired_reminder')
              and d.body ~ 'était valide jusqu''au \{\{document\.expires_on\}\}'), 2,
  '« échue » and its weekly reminder: « était valide jusqu''au »');
select is_empty($$ select 1 from public.email_template_defaults d
                    where d.key like 'professionals.document_expir%' and (d.subject || d.body) ~ 'prend fin le|pris fin le' $$,
  'no « prend fin le » / « a pris fin le » left');

select * from finish();
rollback;

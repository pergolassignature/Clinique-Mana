-- « Spécimen de chèque » as a document type (migration *_professionals_cheque_specimen.sql,
-- decision P4-563, Jonathan's « Suivi » of 22 October 2026). Covers: every clinic has the type and
-- a clinic created later gets it too; it is optional and never expires, so a professional who
-- types her three numbers is still done; it accepts a PDF or a photo, under the same cap as the
-- insurance; and the professional may upload one herself, since the typed numbers stay.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');

select is((select count(*)::int from public.document_types
            where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'cheque_specimen'),
  1, 'a clinic created now has « Spécimen de chèque »');
select is((select name from public.document_types
            where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'cheque_specimen'),
  'Spécimen de chèque', '… under the name the clinic reads');
select ok((select not required from public.document_types
            where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'cheque_specimen'),
  '… optional: typing the three numbers is still enough');
select is((select expiry_rule from public.document_types
            where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'cheque_specimen'),
  'none', '… and it never expires');
select ok((select not is_system from public.document_types
            where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'cheque_specimen'),
  '… and the clinic may rename or archive it');
select results_eq($$ select unnest(accepted_mime) from public.document_types
                      where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'cheque_specimen' order by 1 $$,
  $$ values ('application/pdf'), ('image/jpeg'), ('image/png') $$,
  'a PDF or a photo of the cheque, nothing else');
select is((select max_bytes from public.document_types
            where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'cheque_specimen'),
  10485760, '… under the same cap as the insurance');
-- It sits with the other proofs rather than at the end of the list.
select ok((select s.sort_order between
             (select x.sort_order from public.document_types x where x.org_id = s.org_id and x.key = 'image_consent')
             and (select x.sort_order from public.document_types x where x.org_id = s.org_id and x.key = 'cv')
           from public.document_types s
           where s.org_id = 'b0000000-0000-0000-0000-00000000000a' and s.key = 'cheque_specimen'),
  '… and it is listed with the clinic''s other proofs');

select * from finish();
rollback;

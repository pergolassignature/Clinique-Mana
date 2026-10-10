-- Professionnels: the list's photos (gap audit). professionals_list gains photo_file_id, last: the
-- list signs the visible rows' photos in one storage-sign call (batch mode) and shows initials
-- otherwise. `create or replace` of the latest definition (*_professionals_documents.sql), same
-- columns, joins and filter; list_professionals returns the view's rows, so it carries the column
-- too. Additive.

create or replace view public.professionals_list with (security_invoker = true) as
select p.id, p.org_id, p.first_name, p.last_name, p.email, p.status, p.status_changed_at, p.deactivation_reason_id,
       p.profile_id is not null              as has_account,
       pp.profession_title_id                as primary_title_id,
       pp.licence_number                     as primary_licence_number,
       p.gender,
       coalesce(l.ids, '{}')                 as language_ids,
       coalesce(c.ids, '{}')                 as clientele_ids,
       coalesce(m.ids, '{}')                 as motif_ids,
       mp.accepting_new_clients,
       r.matching_complete,
       r.ready,
       r.email_matches_login,
       p.created_at, p.updated_at,
       r.documents_done,
       r.documents_required,
       r.insurance_status,
       r.insurance_expires_on,
       -- Appended (a view's columns cannot be reordered): the stored file of the photo on the
       -- public profile, as get_professional_record's photo_file_id (the newest verified photo;
       -- the status test is a safeguard). Under the caller's RLS: null when she cannot read it.
       (select d.stored_file_id
          from public.professional_public_profiles x
          join public.professional_documents d on d.professional_id = x.professional_id and d.id = x.photo_document_id
         where x.professional_id = p.id and d.status = 'verified') as photo_file_id
  from public.professionals p
  left join public.professional_professions pp on pp.professional_id = p.id and pp.is_primary
  left join public.professional_matching_profiles mp on mp.professional_id = p.id
  left join public.professionals_readiness r on r.professional_id = p.id
  left join (select x.professional_id, array_agg(x.language_id order by x.language_id) as ids
               from public.professional_languages x group by x.professional_id) l on l.professional_id = p.id
  left join (select x.professional_id, array_agg(x.clientele_id order by x.clientele_id) as ids
               from public.professional_clienteles x group by x.professional_id) c on c.professional_id = p.id
  left join (select x.professional_id, array_agg(x.motif_id order by x.motif_id) as ids
               from public.professional_motifs x group by x.professional_id) m on m.professional_id = p.id
 where (select private.has_permission('professionals.view'));

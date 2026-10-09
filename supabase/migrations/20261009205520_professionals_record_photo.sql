-- =============================================================================
-- Professionnels: the photo in the record bundle (the record header's avatar, follow-up A2.1)
-- =============================================================================
-- Needs:   *_professionals_places_and_note.sql (the latest get_professional_record),
--          *_professionals_documents.sql (professional_public_profiles.photo_document_id)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * get_professional_record gains `photo_file_id`: the stored file of the public profile's photo
--   (photo_document_id, kept on the newest verified photo by the document RPCs), null without
--   one. The record page reads it in the bundle it already loads (P4-312: no extra read model),
--   and get_my_professional_record (« Mon profil »), which returns this function's bundle, carries
--   it too.
-- * Same reader as the rest of the bundle: the function stays security invoker, so the
--   professional_documents RLS decides (professionals.view for staff, the provider for her own
--   record). The id is not the file: the browser gets it only through storage-sign (P3-33), which
--   applies the file's own view permission (professionals.view, the owner branch for the provider).
-- * Defensive: only a verified document's file (photo_document_id is only ever set to one).
-- =============================================================================

-- Same signature, grants and keys as *_professionals_places_and_note.sql, plus photo_file_id.
create or replace function public.get_professional_record(p_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'professional', pg_catalog.to_jsonb(p) - 'org_id',
           'public_profile', (select pg_catalog.to_jsonb(x) - 'org_id' - 'professional_id'
                                from public.professional_public_profiles x where x.professional_id = p.id),
           'matching_profile', (select pg_catalog.to_jsonb(x) - 'org_id' - 'professional_id'
                                  from public.professional_matching_profiles x where x.professional_id = p.id),
           'matching_note', (select pg_catalog.jsonb_build_object('note', x.note, 'updated_at', x.updated_at)
                               from public.professional_matching_notes x where x.professional_id = p.id),
           'professions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                             'id', x.id, 'profession_title_id', x.profession_title_id,
                                             'licence_number', x.licence_number, 'is_primary', x.is_primary)
                                           order by x.is_primary desc, x.created_at, x.id)
                                      from public.professional_professions x where x.professional_id = p.id), '[]'),
           'clienteles', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', x.clientele_id, 'specialized', x.is_specialized)
                                          order by x.clientele_id)
                                     from public.professional_clienteles x where x.professional_id = p.id), '[]'),
           'motif_ids', coalesce((select pg_catalog.jsonb_agg(x.motif_id order by x.motif_id)
                                    from public.professional_motifs x where x.professional_id = p.id), '[]'),
           'language_ids', coalesce((select pg_catalog.jsonb_agg(x.language_id order by x.language_id)
                                       from public.professional_languages x where x.professional_id = p.id), '[]'),
           'payer_numbers', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('payer_type', x.payer_type, 'number', x.number)
                                             order by x.payer_type)
                                        from public.professional_payer_numbers x where x.professional_id = p.id), '[]'),
           'photo_file_id', (select d.stored_file_id
                               from public.professional_public_profiles x
                               join public.professional_documents d
                                 on d.professional_id = x.professional_id and d.id = x.photo_document_id
                              where x.professional_id = p.id and d.status = 'verified'),
           'readiness', public.get_professional_readiness(p.id))
    from public.professionals p
   where p.id = p_id
$$;

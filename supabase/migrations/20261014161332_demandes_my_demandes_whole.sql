-- =============================================================================
-- Demandes: the matched professional sees the whole request (decision R-80)
-- =============================================================================
-- Decision: R-80 (decisions log, « Christine's answers, second series », answer 11: « Le
--           professionnel doit avoir accès à l'ensemble des informations »).
-- Before:   20261012223803_demandes_module.sql (`private.my_demandes_rows`, `public.my_demandes`);
--           the follow-ups came with 20261013210953_demandes_parity.sql (B-2, D-40).
--
-- `my_demandes` (the professional's read, `demandes.self`, her requests while `matched`) left out
-- what the parity batch added to the intake. It now also carries, after its former columns:
--   is_urgent, motif_other (« Autre motif »), availability_other (« Autres disponibilités »),
--   has_issues, issues, issues_comment (« Enjeux », « Précisions sur les enjeux »),
--   previous_professionals, previous_comment (« Professionnels consultés », « Précisions sur les
--   consultations »; `previous_therapy` was already there), has_legal_context, legal_context,
--   legal_detail (« Contexte légal », « Précisions sur le contexte légal »).
-- Unchanged: the same checks (demandes.self first, the caller's clinic, state `matched`, her own
-- professional file), still never the contact (Clients' `my_clients` gives it), the source, the
-- counselor, the history, the tasks or the internal note. The free texts are the person's words
-- about the request (no diagnosis, D8), as `concerns` already was.
-- A function's result type cannot change in place: the view and its function are dropped and
-- created again (nothing else depends on them), with the same grants.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:demandes_my_demandes_whole', true);

drop view public.my_demandes;
drop function private.my_demandes_rows();

create function private.my_demandes_rows()
returns table (id uuid, org_id uuid, reference text, received_at timestamptz, matched_at timestamptz, client_id uuid,
               beneficiary text, previous_therapy boolean, language text, modality text, availability_periods text[],
               availability_days smallint[], preferred_pro_gender text, profession_title_id uuid, clientele_id uuid,
               concerns text, payer_kind text, insurer text, motif_ids uuid[], participants jsonb,
               is_urgent boolean, motif_other text, availability_other text, has_issues boolean, issues text[],
               issues_comment text, previous_professionals text[], previous_comment text, has_legal_context boolean,
               legal_context text[], legal_detail text)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.org_id, d.reference, d.received_at, d.matched_at, d.client_id,
         d.beneficiary, d.previous_therapy, d.language, d.modality, d.availability_periods,
         d.availability_days, d.preferred_pro_gender, d.profession_title_id, d.clientele_id,
         d.concerns, d.payer_kind, d.insurer,
         coalesce((select array_agg(m.motif_id order by m.motif_id) from public.demande_motifs m where m.demande_id = d.id), '{}'),
         coalesce((select jsonb_agg(jsonb_build_object('client_id', p.client_id, 'display_name', p.display_name,
                                                        'relationship', p.relationship, 'is_primary', p.is_primary)
                                    order by p.is_primary desc, p.created_at)
                     from public.demande_participants p where p.demande_id = d.id), '[]'),
         d.is_urgent, d.motif_other, d.availability_other, d.has_issues, d.issues,
         d.issues_comment, d.previous_professionals, d.previous_comment, d.has_legal_context,
         d.legal_context, d.legal_detail
    from public.demandes d
   where private.has_permission('demandes.self')
     and d.org_id = private.current_user_org_id()
     and d.state = 'matched'
     and d.matched_professional_id = private.current_professional_id()
$$;
revoke all on function private.my_demandes_rows() from public, anon;
grant execute on function private.my_demandes_rows() to authenticated;

create view public.my_demandes with (security_invoker = true) as
select r.id, r.org_id, r.reference, r.received_at, r.matched_at, r.client_id, r.beneficiary, r.previous_therapy,
       r.language, r.modality, r.availability_periods, r.availability_days, r.preferred_pro_gender,
       r.profession_title_id, r.clientele_id, r.concerns, r.payer_kind, r.insurer, r.motif_ids, r.participants,
       r.is_urgent, r.motif_other, r.availability_other, r.has_issues, r.issues, r.issues_comment,
       r.previous_professionals, r.previous_comment, r.has_legal_context, r.legal_context, r.legal_detail
  from private.my_demandes_rows() r;
revoke all on public.my_demandes from anon, authenticated;
grant select on public.my_demandes to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);

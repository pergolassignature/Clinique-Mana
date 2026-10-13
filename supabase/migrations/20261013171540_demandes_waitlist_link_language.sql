-- =============================================================================
-- Demandes: the waiting list's « still waiting? » link says the person's language (EN-1)
-- =============================================================================
-- `/liste-attente/reponse` speaks French or English like the other public pages (the consent,
-- the proposal, the discovery call): `resolve_waitlist_followup_link` adds the demande's
-- `language` to what it shows. Same signature, same rules; nothing else changes.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:demandes_waitlist_link_language', true);

create or replace function public.resolve_waitlist_followup_link(p_link_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('clinic_name', o.name, 'list_name', coalesce(p.display_name, t.name),
                                       'language', coalesce(d.language, 'fr'))
    from public.secure_links l
    join public.waitlist_entries e on e.id = l.subject_id and e.org_id = l.org_id
    join public.organizations o on o.id = l.org_id
    left join public.demandes d on d.id = e.demande_id and d.org_id = e.org_id
    left join public.professionals_directory p on p.id = e.target_professional_id and p.org_id = e.org_id
    left join public.profession_titles_catalog t on t.id = e.target_profession_title_id and t.org_id = e.org_id
   where l.id = p_link_id and l.purpose = 'waitlist_followup' and l.subject_type = 'waitlist_entry'
     and l.revoked_at is null and l.expires_at > pg_catalog.now() and l.use_count < l.max_uses
     and e.state <> 'closed'
$$;

select pg_catalog.set_config('app.audit_source', '', true);

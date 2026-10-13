-- =============================================================================
-- Clients: the consents' facts for Rapports (batch C5b, part 2: C5b.3)
-- =============================================================================
-- Plan:    docs/plans/2026-10-11-modules-coding-plan.md §6 « C5 » (C5b.3); decision CC-19.
-- Needs:   *_clients_consents.sql (the tables and the status view), *_clients_consents_withdrawal_copy.sql
--          (the view's columns), *_clients_consent_names.sql.
-- Rules:   docs/standards/database-conventions.md; CLAUDE.md §5 (Rapports reads only what is published).
--
-- * private.client_consent_state_facts(org): one row per active file (not archived, anonymised or
--   merged) and active consent, with the file's primary professional and the consent's state as
--   the record's « Consentements » tab shows it (`client_consents_status`): signed, resign,
--   pending, overdue, withdrawn, or `none` (never asked). So the report's counts are the tabs' (C5b
--   acceptance).
-- * private.client_consent_event_facts(org, from, to): the signatures (app or import) and the
--   withdrawals of [from, to), with the file's primary professional and, for a signature in the
--   app, when its request was first sent (the « envoi → signature » delay).
-- * Granted to no role: Rapports' definer RPC calls them after its permission check.
-- * Additive: two new private functions.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:clients_consent_report_facts', true);

create function private.client_consent_state_facts(p_org uuid)
returns table (client_id uuid, primary_professional_id uuid, consent_key text, state text)
language sql
stable
set search_path = ''
as $$
  select c.id, c.primary_professional_id, t.key, coalesce(s.state, 'none')
    from public.clients c
    join public.client_consent_types t on t.org_id = c.org_id and t.is_active
    left join public.client_consents_status s on s.org_id = c.org_id and s.client_id = c.id and s.consent_key = t.key
   where c.org_id = p_org and c.archived_at is null and c.anonymized_at is null and c.merged_into_id is null
$$;

create function private.client_consent_event_facts(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table (kind text, consent_key text, at timestamptz, source text, primary_professional_id uuid, requested_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select 'signed', c.consent_key, c.signed_at, c.source, k.primary_professional_id, r.created_at
    from public.client_consents c
    join public.clients k on k.org_id = c.org_id and k.id = c.client_id
    left join public.client_consent_requests r on r.org_id = c.org_id and r.id = c.request_id
   where c.org_id = p_org and c.signed_at >= p_from and c.signed_at < p_to
  union all
  select 'withdrawn', c.consent_key, c.withdrawn_at, c.source, k.primary_professional_id, null::timestamptz
    from public.client_consents c
    join public.clients k on k.org_id = c.org_id and k.id = c.client_id
   where c.org_id = p_org and c.withdrawn_at >= p_from and c.withdrawn_at < p_to
$$;

revoke all on function private.client_consent_state_facts(uuid), private.client_consent_event_facts(uuid, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

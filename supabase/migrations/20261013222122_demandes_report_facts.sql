-- =============================================================================
-- Demandes, batch D6: the facts its indicators are built from (published for Rapports)
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §10 (D6), §12 (RP2)
-- Data:      docs/research/2026-10-08-intake-workbook.md §8.3 (the workbook's KPIs, defined once)
-- Decisions: D-42 … D-45 (decisions log)
--
-- Demandes publishes, for definer code that checked its own permission (Rapports'
-- `report_demandes`), with the org it verified, granted to no role. Ids, never names of the
-- catalogues (the caller asks their owner, inactive rows included):
--   * `private.demandes_report_requests(org, from, to)`: one row per request received in
--     [from, to): channel, who took it, the source (« Comment avez-vous entendu parler de MANA ? »,
--     campaign, utm_source / utm_medium, the referrer's host: D3c's capture, `demandes_sources`),
--     the state and closing reason, the clientèle, the first contact attempt (any channel) and its
--     business hours, the promise's state (`contact_status`: on_time / late once contacted;
--     pending / overdue while open and never contacted, as the inbox counts now; no_attempt when
--     matched or closed without one), the first proposal, the first match, ever on the waiting
--     list. Never a person's name, a contact, the concerns or the note.
--   * `private.demandes_report_matches(org, from, to)`: each match in [from, to) (the « Jumelée »
--     events: by hand or an accepted proposal), with the request's file, the professional, the
--     request's clientèle. A request matched again counts again (the workbook's confirmations).
--   * `private.demandes_report_waitlist(org, from, to)`: the entries open now, registered in the
--     period or exited in it: target (profession or professional), priority, state, registered /
--     exited at, exit reason.
--   * `private.demandes_report_capacity(org, from, to)`: D5's nightly photos between two clinic
--     dates: per day and professional, places declared, left, new clients accepted.
-- Additive: four functions.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:demandes_report_facts', true);

create function private.demandes_report_requests(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table (
  demande_id uuid, received_at timestamptz, channel text, received_by uuid, received_by_name text,
  referral_source_id uuid, referral_source_name text, source_campaign text, utm_source text, utm_medium text,
  referrer_host text, state text, closed_reason text, clientele_id uuid, client_id uuid,
  first_contact_at timestamptz, first_contact_hours numeric, contact_status text,
  first_proposed_at timestamptz, first_matched_at timestamptz, matched_professional_id uuid, ever_waitlisted boolean
)
language sql
stable
set search_path = ''
as $$
  with tz as (select coalesce((select o.timezone from public.organizations o where o.id = p_org), 'America/Toronto') as tz)
  select d.id, d.received_at, d.channel, d.received_by, pr.display_name,
         d.referral_source_id, rs.name, d.source_campaign,
         nullif(d.source_utm ->> 'utm_source', ''), nullif(d.source_utm ->> 'utm_medium', ''),
         nullif(pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.substring(d.source_referrer, '^[a-zA-Z]+://([^/?#:]+)')), '^www\.', ''), ''),
         d.state, d.closed_reason, d.clientele_id, d.client_id,
         fc.at, h.hours,
         case when fc.at is not null then case when h.hours < 48 then 'on_time' else 'late' end
              when d.state in ('matched', 'closed') then 'no_attempt'
              when private.demandes_business_hours(d.received_at, pg_catalog.now(), (select tz.tz from tz)) >= 48 then 'overdue'
              else 'pending' end,
         (select pg_catalog.min(x.proposed_at) from public.demande_propositions x where x.org_id = d.org_id and x.demande_id = d.id),
         (select pg_catalog.min(e.at) from public.demande_events e
           where e.org_id = d.org_id and e.demande_id = d.id and e.kind = 'state_changed' and e.to_state = 'matched'),
         d.matched_professional_id,
         exists (select 1 from public.waitlist_entries w where w.org_id = d.org_id and w.demande_id = d.id)
    from public.demandes d
    left join public.profiles pr on pr.user_id = d.received_by
    left join public.referral_sources rs on rs.org_id = d.org_id and rs.id = d.referral_source_id
    left join lateral (select pg_catalog.min(e.at) as at from public.demande_events e
                        where e.org_id = d.org_id and e.demande_id = d.id and e.contact_channel is not null) fc on true
    cross join lateral (select case when fc.at is not null
                                    then private.demandes_business_hours(d.received_at, fc.at, (select tz.tz from tz)) end as hours) h
   where d.org_id = p_org and d.received_at >= p_from and d.received_at < p_to
$$;

create function private.demandes_report_matches(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table (event_id uuid, demande_id uuid, matched_at timestamptz, professional_id uuid, client_id uuid, clientele_id uuid)
language sql
stable
set search_path = ''
as $$
  select e.id, e.demande_id, e.at, e.professional_id, d.client_id, d.clientele_id
    from public.demande_events e
    join public.demandes d on d.org_id = e.org_id and d.id = e.demande_id
   where e.org_id = p_org and e.kind = 'state_changed' and e.to_state = 'matched'
     and e.at >= p_from and e.at < p_to
$$;

create function private.demandes_report_waitlist(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table (entry_id uuid, demande_id uuid, target_kind text, target_id uuid, priority text,
               state text, registered_at timestamptz, exited_at timestamptz, exit_reason text)
language sql
stable
set search_path = ''
as $$
  select w.id, w.demande_id,
         case when w.target_professional_id is not null then 'professional' else 'title' end,
         coalesce(w.target_professional_id, w.target_profession_title_id),
         w.priority, w.state, w.registered_at, w.exited_at, w.exit_reason
    from public.waitlist_entries w
   where w.org_id = p_org
     and (w.state <> 'closed'
          or (w.registered_at >= p_from and w.registered_at < p_to)
          or (w.exited_at >= p_from and w.exited_at < p_to))
$$;

create function private.demandes_report_capacity(p_org uuid, p_from date, p_to date)
returns table (snapshot_on date, professional_id uuid, places_declared smallint, places_left int, accepting_new_clients boolean)
language sql
stable
set search_path = ''
as $$
  select c.snapshot_on, c.professional_id, c.places_declared, c.places_left, c.accepting_new_clients
    from public.capacity_snapshots c
   where c.org_id = p_org and c.snapshot_on between p_from and p_to
$$;

revoke all on function private.demandes_report_requests(uuid, timestamptz, timestamptz),
  private.demandes_report_matches(uuid, timestamptz, timestamptz),
  private.demandes_report_waitlist(uuid, timestamptz, timestamptz),
  private.demandes_report_capacity(uuid, date, date)
  from public, anon, authenticated, service_role;

select pg_catalog.set_config('app.audit_source', '', true);

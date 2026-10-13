-- =============================================================================
-- Rapports: « Consentements » (Clients batch C5b, part 2: C5b.3)
-- =============================================================================
-- Plan:    docs/plans/2026-10-11-modules-coding-plan.md §6 « C5 » (C5b.3); decision CC-19.
-- Needs:   *_reports_module.sql (the helpers), *_clients_consent_report_facts.sql,
--          *_clients_consent_names.sql, Professionnels' private.professional_display_names.
-- Rules:   docs/standards/database-conventions.md; Rapports has no table (RP-1).
--
-- report_consents(from, to, professional) (`reports.view`):
--   * `gaps`: per active consent, how many active files are in each state today (signed,
--     resign, pending, overdue, withdrawn, none), as the record tabs say; the professional filter
--     reads the file's primary professional.
--   * `by_professional`: per primary professional (or none) and consent, the signed and the « à
--     obtenir » (pending, overdue, resign, withdrawn; « jamais demandé » left out: most consents
--     apply to some situations only).
--   * `months`: per month of the period, the signatures in the app, the signatures imported from
--     GOrendezvous and the withdrawals.
--   * `delays`: per consent, the signatures in the app of the period with their request: how many,
--     the average and the median days from the first send to the signature.
-- A period as every report (RP-5); the clients are counted, never named (no row per person).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:reports_consents', true);

create function public.report_consents(p_from date, p_to date, p_professional_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.reports_require('reports.view');
  v_bounds record;
  v_tz text;
  v_result jsonb;
begin
  perform private.reports_check_period(p_from, p_to);
  select * into v_bounds from private.reports_period_bounds(v_org, p_from, p_to);
  v_tz := coalesce((select o.timezone from public.organizations o where o.id = v_org), 'America/Toronto');

  with s_all as (
    select * from private.client_consent_state_facts(v_org)
  ), s as (
    select * from s_all where p_professional_id is null or s_all.primary_professional_id = p_professional_id
  ), e as (
    select * from private.client_consent_event_facts(v_org, v_bounds.starts_at, v_bounds.ends_at) x
     where p_professional_id is null or x.primary_professional_id = p_professional_id
  ), names as (
    select n.key, n.name_fr from private.clients_consent_names(v_org) n
  ), types as (
    select distinct s_all.consent_key from s_all
  ), pros as (
    select n.professional_id, n.display_name
      from private.professional_display_names(v_org, array(select distinct s_all.primary_professional_id from s_all
                                                             where s_all.primary_professional_id is not null)) n
  ), months as (
    select pg_catalog.to_char(m, 'YYYY-MM') as month
      from pg_catalog.generate_series(pg_catalog.date_trunc('month', p_from::timestamp), p_to::timestamp, interval '1 month') m
  ), delays as (
    select e.consent_key, extract(epoch from (e.at - e.requested_at)) / 86400.0 as days
      from e where e.kind = 'signed' and e.source = 'app' and e.requested_at is not null
  )
  select pg_catalog.jsonb_build_object(
           'gaps', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'consent_key', t.consent_key, 'consent_name', coalesce(n.name_fr, t.consent_key),
                      'signed', g.signed, 'resign', g.resign, 'pending', g.pending, 'overdue', g.overdue,
                      'withdrawn', g.withdrawn, 'none', g.never_asked) order by coalesce(n.name_fr, t.consent_key))
               from types t
               left join names n on n.key = t.consent_key
               cross join lateral (
                 select pg_catalog.count(*) filter (where s.state = 'signed') as signed,
                        pg_catalog.count(*) filter (where s.state = 'resign') as resign,
                        pg_catalog.count(*) filter (where s.state = 'pending') as pending,
                        pg_catalog.count(*) filter (where s.state = 'overdue') as overdue,
                        pg_catalog.count(*) filter (where s.state = 'withdrawn') as withdrawn,
                        pg_catalog.count(*) filter (where s.state = 'none') as never_asked
                   from s where s.consent_key = t.consent_key) g), '[]'),
           'by_professional', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'professional_id', b.primary_professional_id, 'professional_name', p.display_name,
                      'consent_key', b.consent_key, 'consent_name', coalesce(n.name_fr, b.consent_key),
                      'signed', b.signed, 'to_obtain', b.to_obtain)
                      order by p.display_name nulls last, coalesce(n.name_fr, b.consent_key))
               from (select s.primary_professional_id, s.consent_key,
                            pg_catalog.count(*) filter (where s.state = 'signed') as signed,
                            pg_catalog.count(*) filter (where s.state in ('pending', 'overdue', 'resign', 'withdrawn')) as to_obtain
                       from s group by s.primary_professional_id, s.consent_key) b
               left join pros p on p.professional_id = b.primary_professional_id
               left join names n on n.key = b.consent_key
              where b.signed > 0 or b.to_obtain > 0), '[]'),
           'months', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'month', m.month,
                      'signed', (select pg_catalog.count(*) from e where e.kind = 'signed' and e.source = 'app'
                                   and pg_catalog.to_char(e.at at time zone v_tz, 'YYYY-MM') = m.month),
                      'imported', (select pg_catalog.count(*) from e where e.kind = 'signed' and e.source = 'import'
                                     and pg_catalog.to_char(e.at at time zone v_tz, 'YYYY-MM') = m.month),
                      'withdrawn', (select pg_catalog.count(*) from e where e.kind = 'withdrawn'
                                      and pg_catalog.to_char(e.at at time zone v_tz, 'YYYY-MM') = m.month))
                      order by m.month)
               from months m), '[]'),
           'delays', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'consent_key', d.consent_key, 'consent_name', coalesce(n.name_fr, d.consent_key), 'count', d.n,
                      'average_days', pg_catalog.round(d.average::numeric, 1), 'median_days', pg_catalog.round(d.median::numeric, 1))
                      order by coalesce(n.name_fr, d.consent_key))
               from (select x.consent_key, pg_catalog.count(*) as n, pg_catalog.avg(x.days) as average,
                            pg_catalog.percentile_cont(0.5) within group (order by x.days) as median
                       from delays x group by x.consent_key) d
               left join names n on n.key = d.consent_key), '[]'),
           'totals', pg_catalog.jsonb_build_object(
             'clients', (select pg_catalog.count(distinct s.client_id) from s),
             'signed', (select pg_catalog.count(*) from e where e.kind = 'signed'),
             'withdrawn', (select pg_catalog.count(*) from e where e.kind = 'withdrawn')),
           'options', pg_catalog.jsonb_build_object(
             'professionals', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', p.professional_id, 'name', p.display_name)
                                                      order by p.display_name) from pros p), '[]')))
    into v_result;
  return v_result;
end;
$$;
revoke all on function public.report_consents(date, date, uuid) from public, anon, authenticated, service_role;
grant execute on function public.report_consents(date, date, uuid) to authenticated;

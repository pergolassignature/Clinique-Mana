-- =============================================================================
-- Facturation: a payer organisation's upload portal (R-84) and a PAE's tiers in the split (R-85)
-- =============================================================================
-- Answers:   docs/research/2026-10-14-christine-answers-suite.md (19, 20, 21)
-- Decisions: R-84, R-85 (decisions log, « Christine's answers, second series »); FP-2, FP-4, FP-11
-- Needs:     20261014155721_clients_payer_event_tiers.sql (Clients' event date and tiers)
--
--   * `payer_organisations.portal_url` (R-84): IVAC's invoices are uploaded on the CNESST's portal
--     (« envoi de fichier »), not emailed. An organisation may hold the portal's address (https
--     only, one address without spaces) instead of a billing email: then its drafts are not held
--     « Payeur sans adresse courriel » (`billing_hold_now`), the invoice is finalised without
--     sending and its PDF uploaded there (the screen links to the portal). `list_payer_organisations`
--     gives it; `save_payer_organisation` takes it (dropped and made again: one parameter more).
--   * `billing_invoice_payer` gives an IVAC invoice the client's event date (R-84, Clients'
--     `client_payer_details_of`), printed in the invoice's header, and an organisation's portal.
--   * `billing_apply_payer_shares` (R-85): a PAE's share of a session comes from the tier holding
--     it, by the count of sessions already covered in the agreement's year (the issued shares, the
--     use before the app and this invoice's earlier sessions: what already counted for the maximum
--     of sessions), through Clients' `client_payer_session_coverage`; an agreement without tiers is
--     unchanged, and the maximum of sessions or dollars still caps every tier.
-- Additive: a column, `create or replace` of the latest bodies (same signatures) and one function
-- made again with a parameter more.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:billing_payer_portal_tiers', true);

alter table public.payer_organisations
  add column portal_url text,
  add constraint payer_organisations_portal_check check (
    portal_url is null or (pg_catalog.char_length(portal_url) <= 500 and portal_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]]*)?$'));

-- -----------------------------------------------------------------------------
-- The organisations: the portal (latest bodies: 20261013184139_billing_third_party_payers.sql)
-- -----------------------------------------------------------------------------
create or replace function public.list_payer_organisations()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.view');
begin
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', o.id, 'kind', o.kind, 'name', o.name, 'billing_email', o.billing_email, 'contact_name', o.contact_name,
             'language', o.language, 'provider_number', o.provider_number, 'cadence', o.cadence, 'due_days', o.due_days,
             'reminders_enabled', o.reminders_enabled, 'is_active', o.is_active, 'note', o.note, 'portal_url', o.portal_url)
             order by (o.kind = 'ivac') desc, o.is_active desc, pg_catalog.lower(o.name))
      from public.payer_organisations o where o.org_id = v_org), '[]'::jsonb);
end;
$$;

drop function public.save_payer_organisation(uuid, text, text, text, text, text, text, text, int, boolean, boolean, text);

create function public.save_payer_organisation(
  p_id uuid, p_kind text, p_name text, p_billing_email text, p_contact_name text, p_language text, p_provider_number text,
  p_cadence text, p_due_days int, p_reminders_enabled boolean, p_is_active boolean, p_note text, p_portal_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  v_name text := nullif(pg_catalog.btrim(coalesce(p_name, '')), '');
  v_email text := nullif(pg_catalog.btrim(coalesce(p_billing_email, '')), '');
  v_contact text := nullif(pg_catalog.btrim(coalesce(p_contact_name, '')), '');
  v_provider text := nullif(pg_catalog.btrim(coalesce(p_provider_number, '')), '');
  v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  v_portal text := nullif(pg_catalog.btrim(coalesce(p_portal_url, '')), '');
  o public.payer_organisations;
  v_id uuid;
begin
  if p_id is not null then
    select x.* into o from public.payer_organisations x where x.org_id = v_org and x.id = p_id for update;
    if o.id is null then
      raise exception 'Organisme payeur introuvable.' using errcode = 'P0001', hint = 'id';
    end if;
  elsif p_kind is distinct from 'pae' then
    raise exception 'Un organisme ajouté est un fournisseur de PAE (l''IVAC de la clinique existe déjà).' using errcode = 'P0001', hint = 'kind';
  end if;
  if v_name is null or pg_catalog.char_length(v_name) > 120 or not private.is_tidy_text(v_name) then
    raise exception 'Le nom de l''organisme compte de 1 à 120 caractères.' using errcode = 'P0001', hint = 'name';
  end if;
  if exists (select 1 from public.payer_organisations x
              where x.org_id = v_org and pg_catalog.lower(x.name) = pg_catalog.lower(v_name) and x.id is distinct from p_id) then
    raise exception 'Un organisme payeur porte déjà ce nom.' using errcode = 'P0001', hint = 'name';
  end if;
  if v_email is not null and (pg_catalog.char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Indiquez une adresse courriel valide pour la facturation.' using errcode = 'P0001', hint = 'billing_email';
  end if;
  -- R-84: where the invoices are uploaded (IVAC: the CNESST's portal), https only.
  if v_portal is not null and (pg_catalog.char_length(v_portal) > 500
                               or v_portal !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]]*)?$') then
    raise exception 'L''adresse du portail de dépôt commence par https:// (une seule adresse, sans espace).' using errcode = 'P0001', hint = 'portal_url';
  end if;
  if v_contact is not null and (pg_catalog.char_length(v_contact) > 120 or not private.is_tidy_text(v_contact)) then
    raise exception 'Le nom du contact compte 120 caractères au plus.' using errcode = 'P0001', hint = 'contact_name';
  end if;
  if coalesce(p_language, 'fr') not in ('fr', 'en') then
    raise exception 'La langue est le français ou l''anglais.' using errcode = 'P0001', hint = 'language';
  end if;
  if v_provider is not null and (pg_catalog.char_length(v_provider) > 60 or not private.is_tidy_text(v_provider)) then
    raise exception 'Le numéro de fournisseur compte 60 caractères au plus.' using errcode = 'P0001', hint = 'provider_number';
  end if;
  if p_cadence is null or p_cadence not in ('monthly', 'threshold', 'closing') then
    raise exception 'Choisissez quand facturer : chaque mois, par tranches ou à la fin de l''année de l''entente.' using errcode = 'P0001', hint = 'cadence';
  end if;
  if p_due_days is null or p_due_days not between 0 and 120 then
    raise exception 'Le délai de paiement va de 0 à 120 jours.' using errcode = 'P0001', hint = 'due_days';
  end if;
  if v_note is not null and pg_catalog.char_length(v_note) > 1000 then
    raise exception 'La note compte 1 000 caractères au plus.' using errcode = 'P0001', hint = 'note';
  end if;
  if o.id is null then
    insert into public.payer_organisations (org_id, kind, name, billing_email, contact_name, language, provider_number, cadence,
                                            due_days, reminders_enabled, is_active, note, portal_url, created_by)
    values (v_org, 'pae', v_name, v_email, v_contact, coalesce(p_language, 'fr'), v_provider, p_cadence, p_due_days,
            coalesce(p_reminders_enabled, false), coalesce(p_is_active, true), v_note, v_portal, auth.uid())
    returning id into v_id;
    return v_id;
  end if;
  if o.kind = 'ivac' and not coalesce(p_is_active, true) then
    raise exception 'L''IVAC de la clinique reste active.' using errcode = 'P0001', hint = 'is_active';
  end if;
  update public.payer_organisations x
     set name = v_name, billing_email = v_email, contact_name = v_contact, language = coalesce(p_language, 'fr'),
         provider_number = v_provider, cadence = p_cadence, due_days = p_due_days,
         reminders_enabled = coalesce(p_reminders_enabled, false), is_active = coalesce(p_is_active, true), note = v_note,
         portal_url = v_portal
   where x.id = o.id;
  return o.id;
end;
$$;

revoke all on function public.save_payer_organisation(uuid, text, text, text, text, text, text, text, int, boolean, boolean, text, text)
  from public, anon;
grant execute on function public.save_payer_organisation(uuid, text, text, text, text, text, text, text, int, boolean, boolean, text, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- A draft's live holds: an organisation with a portal is not « sans adresse courriel » (R-84)
-- -----------------------------------------------------------------------------
-- Latest body: 20261013184139_billing_third_party_payers.sql.
create or replace function private.billing_hold_now(p_invoice public.invoices)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(p_invoice.hold_reason,
    case when exists (select 1 from public.invoice_lines l where l.invoice_id = p_invoice.id and l.unit_price_cents is null)
           then 'price_missing' end,
    case when private.billing_invoice_payer_email(p_invoice) is null
              and not (p_invoice.payer_kind = 'organisation' and exists (
                select 1 from public.payer_organisations o where o.id = p_invoice.payer_organisation_id and o.portal_url is not null))
           then 'payer_missing' end,
    case when private.billing_payer_incomplete(p_invoice) then 'payer_incomplete' end)
$$;

-- -----------------------------------------------------------------------------
-- An organisation as a document's payer: IVAC's event date and the portal (R-84)
-- -----------------------------------------------------------------------------
-- Latest body: 20261013194601_billing_payer_documents.sql. The client's payer of a payer invoice
-- is its source (`source_type = 'payer'`), else the one its claims name.
create or replace function private.billing_invoice_payer(p_invoice public.invoices)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when p_invoice.payer_kind = 'organisation' then (
           select pg_catalog.jsonb_build_object('id', o.id, 'name', o.name, 'first_name', coalesce(o.contact_name, o.name),
                                                'client_number', null, 'language', o.language, 'kind', 'organisation',
                                                'organisation_kind', o.kind, 'provider_number', o.provider_number,
                                                'portal_url', o.portal_url,
                                                'event_on', case when o.kind = 'ivac' then (
                                                  select d.event_on from private.client_payer_details_of(p_invoice.org_id, array[coalesce(
                                                    case when p_invoice.source_type = 'payer' then p_invoice.source_id end,
                                                    (select l.client_payer_id from public.invoice_lines l
                                                      where l.invoice_id = p_invoice.id and l.client_payer_id is not null
                                                      order by l.position limit 1))]) d) end)
             from public.payer_organisations o where o.id = p_invoice.payer_organisation_id)
         else private.billing_person(p_invoice.org_id, p_invoice.payer_client_id) end
$$;

-- -----------------------------------------------------------------------------
-- The split (FP-2) with a PAE's tiers (R-85)
-- -----------------------------------------------------------------------------
-- Latest body: 20261014042048_billing_security_fixes.sql. The year's consumption is read before the
-- amount (it was after): the tier holding a session depends on the sessions already covered.
create or replace function private.billing_apply_payer_shares(p_org uuid, p_invoice_id uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v public.invoices;
  l record;
  t record;
  c record;
  v_organisation uuid;
  v_name text;
  v_amount int;
  v_from date;
  v_to date;
  v_used int;
  v_count int;
  v_n int := 0;
begin
  select i.* into v from public.invoices i where i.org_id = p_org and i.id = p_invoice_id;
  if v.id is null or v.status <> 'draft' or v.payer_kind = 'organisation' then
    return 0;
  end if;
  delete from public.invoice_lines x where x.invoice_id = v.id and x.line_type = 'payer_share';
  perform private.billing_recompute(v.id, private.billing_today(p_org));
  for l in select x.id, x.position, x.appointment_id, x.professional_id, x.subtotal_cents, f.local_date
             from public.invoice_lines x
             join private.appointment_billing_facts(p_org, array[x.appointment_id]) f on true
            where x.invoice_id = v.id and x.line_type = 'service' and x.appointment_id is not null and x.subtotal_cents > 0
            order by f.local_date, x.position loop
    select p.* into t from private.client_payer_terms(p_org, v.client_id, l.local_date) p limit 1;
    continue when t.client_payer_id is null or t.is_stub;
    v_organisation := private.billing_payer_organisation(p_org, t.client_payer_id, t.kind, t.organisation_name);
    continue when v_organisation is null;
    continue when t.kind = 'pae' and t.coverage_percent is null and t.session_amount_cents is null;
    select x.period_from, x.period_to into v_from, v_to
      from private.billing_payer_period(l.local_date, t.renewal_month, t.renewal_day, t.starts_on, t.expires_on) x;
    -- Security review 2026-10-14: one invoice at a time per payer, so that two finalisations
    -- never both read the same consumption and pass the maximum together (held to commit).
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('billing.payer:' || t.client_payer_id::text, 0));
    select u.amount_cents, u.sessions into v_used, v_count
      from private.billing_payer_consumed(p_org, t.client_payer_id, v_from, v_to, v.id) u;
    -- What the agreement used before the app, in that year.
    if t.prior_used_on between v_from and v_to then
      v_used := v_used + coalesce(t.prior_used_cents, 0);
      v_count := v_count + coalesce(t.prior_used_sessions, 0);
    end if;
    -- This invoice's own shares already placed in the same year.
    select v_used + coalesce(-pg_catalog.sum(y.total_cents), 0)::int, v_count + pg_catalog.count(*)::int into v_used, v_count
      from public.invoice_lines y
     where y.invoice_id = v.id and y.line_type = 'payer_share' and y.client_payer_id = t.client_payer_id
       and y.service_on between v_from and v_to;
    continue when t.max_sessions is not null and v_count >= t.max_sessions;
    if t.kind = 'ivac' then
      v_amount := least(coalesce(private.billing_ivac_rate(p_org, l.local_date), 0), l.subtotal_cents);
    else
      -- R-85: the tier holding this session, by the sessions already covered this year.
      select s.session_amount_cents, s.coverage_percent into c
        from private.client_payer_session_coverage(
               (select d.coverage_tiers from private.client_payer_details_of(p_org, array[t.client_payer_id]) d),
               t.session_amount_cents, t.coverage_percent, v_count) s;
      if c.coverage_percent is not null then
        v_amount := pg_catalog.round(l.subtotal_cents * c.coverage_percent / 100.0)::int;
      elsif c.session_amount_cents is not null then
        v_amount := least(c.session_amount_cents, l.subtotal_cents);
      else
        continue;
      end if;
    end if;
    if t.max_amount_cents is not null then
      v_amount := least(v_amount, greatest(t.max_amount_cents - v_used, 0));
    end if;
    continue when v_amount <= 0;
    select o.name into v_name from public.payer_organisations o where o.id = v_organisation;
    insert into public.invoice_lines (org_id, invoice_id, position, line_type, appointment_id, professional_id, description,
                                      quantity, unit_price_cents, price_source, tax_rule, client_payer_id, payer_organisation_id,
                                      service_on, subtotal_cents, total_cents)
    values (p_org, v.id, coalesce((select max(z.position) + 1 from public.invoice_lines z where z.invoice_id = v.id), 1), 'payer_share',
            l.appointment_id, l.professional_id,
            pg_catalog.left('Part payée par ' || v_name || coalesce(' — dossier ' || t.file_number, '')
                            || ' (séance du ' || private.format_date_fr(l.local_date) || ')', 300),
            1, -v_amount, 'payer', 'exempt', t.client_payer_id, v_organisation, l.local_date, -v_amount, -v_amount);
    v_n := v_n + 1;
  end loop;
  perform private.billing_recompute(v.id, private.billing_today(p_org));
  return v_n;
end;
$$;

select pg_catalog.set_config('app.audit_source', '', true);

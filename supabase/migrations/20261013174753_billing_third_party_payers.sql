-- =============================================================================
-- Facturation: third-party payers, IVAC and PAE (batch FP, part 1: the model, the split, the
-- payer invoices)
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §8 (FP); roadmap §2.6, §2.6 bis
-- Answers:   docs/research/2026-10-12-christine-answers.md (12, 13); R-62
-- Legacy:    docs/plans/2026-10-06-legacy-feature-inventory.md §G (rules as a reference)
-- Decisions: FP-1 … FP-10 (decisions log)
--
--   * `payer_organisations`: who pays besides the client: the clinic's IVAC (one, made here) and
--     the PAE providers the adjointe adds; each with its billing address (email), language, the
--     clinic's provider number with it, its invoicing cadence (`monthly`, `threshold`: about a
--     third of the agreement's maximum at a time, `closing`: once the agreement's year ends), its
--     delay to pay and whether it gets reminders (off by default, FP-6).
--   * `billing_payer_rates`: what IVAC pays per session, dated (94,50 $, Christine 12).
--   * `client_payer_organisations`: the organisation a client's payer (Clients' `client_payers`)
--     is billed to, when it is not the obvious one (IVAC: the clinic's; a PAE: the organisation
--     of the same name).
--   * The split (FP-2): a client's invoice gets, under each session a payer covers that day, a
--     negative line `payer_share` (« Part payée par l'IVAC — dossier n° … »): IVAC its rate (at
--     most the session), a PAE its amount or percentage, never past the agreement's maximum (of
--     sessions or of dollars) in the agreement's year (renewed each year on its date, most often
--     March 31). The client is billed the gap. Computed on the draft and again when it is
--     finalised (the year's consumption: the shares of the issued invoices).
--   * The payer invoices (FP-3): an ordinary invoice (`payer_kind = 'organisation'`, the dossier
--     as `client_id`, `payer_client_id = client_id`, `payer_reference` the file number, `source_type
--     = 'payer'`), one per organisation and client's payer, a line `payer_claim` per session's
--     share (once: a share is claimed by one live line); IVAC monthly (the past months' sessions),
--     a PAE by its cadence, and every share at once with « Facturer les PAE » (the April closing,
--     FP-5). Report writing billed to IVAC: a payer invoice made by hand.
--   * What changes elsewhere (FP-6, FP-7): an organisation's invoice goes to its billing address
--     (P3-40 as any other), never charged on the client's card nor offered « Payer en ligne », never
--     blocks the client's bookings, gets reminders only when its organisation does, is never in the
--     client's statement or balance; a receipt for its payment is not emailed. A client's invoice
--     whose share is already claimed is not credited before the payer's.
--   * The job `billing.payer_closing` (daily): after a PAE agreement's renewal date, tells
--     `billing.manage` once to invoice what is left of the year (« Facturer les PAE »).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:billing_third_party_payers', true);

-- -----------------------------------------------------------------------------
-- payer_organisations
-- -----------------------------------------------------------------------------
create table public.payer_organisations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  name text not null,
  billing_email text,
  contact_name text,
  language text not null default 'fr',
  provider_number text,
  cadence text not null,
  due_days smallint not null default 30,
  reminders_enabled boolean not null default false,
  is_active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint payer_organisations_org_id_id_key unique (org_id, id),
  constraint payer_organisations_kind_check check (kind in ('ivac', 'pae')),
  constraint payer_organisations_name_check check (char_length(name) between 1 and 120 and private.is_tidy_text(name)),
  constraint payer_organisations_email_check check (billing_email is null or (char_length(billing_email) <= 254 and billing_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  constraint payer_organisations_contact_check check (contact_name is null or (char_length(contact_name) between 1 and 120 and private.is_tidy_text(contact_name))),
  constraint payer_organisations_language_check check (language in ('fr', 'en')),
  constraint payer_organisations_provider_check check (provider_number is null or (char_length(provider_number) between 1 and 60 and private.is_tidy_text(provider_number))),
  constraint payer_organisations_cadence_check check (cadence in ('monthly', 'threshold', 'closing')),
  constraint payer_organisations_due_days_check check (due_days between 0 and 120),
  constraint payer_organisations_note_check check (note is null or char_length(note) between 1 and 1000)
);
create unique index payer_organisations_name_key on public.payer_organisations (org_id, pg_catalog.lower(name));
create unique index payer_organisations_one_ivac_key on public.payer_organisations (org_id) where kind = 'ivac';
create index payer_organisations_created_by_idx on public.payer_organisations (created_by);
create trigger payer_organisations_set_updated_at before update on public.payer_organisations
  for each row execute function private.set_updated_at();

-- What IVAC pays per session, dated.
create table public.billing_payer_rates (
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  effective_from date not null,
  session_cents int not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  constraint billing_payer_rates_pkey primary key (org_id, kind, effective_from),
  constraint billing_payer_rates_kind_check check (kind = 'ivac'),
  constraint billing_payer_rates_cents_check check (session_cents between 1 and 1000000)
);
create index billing_payer_rates_created_by_idx on public.billing_payer_rates (created_by);

-- The organisation a client's payer is billed to, when chosen.
create table public.client_payer_organisations (
  client_payer_id uuid primary key references public.client_payers(id) on delete cascade,
  org_id uuid not null,
  organisation_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  constraint client_payer_organisations_organisation_fkey foreign key (org_id, organisation_id)
    references public.payer_organisations (org_id, id)
);
create index client_payer_organisations_org_idx on public.client_payer_organisations (org_id, organisation_id);
create index client_payer_organisations_created_by_idx on public.client_payer_organisations (created_by);

alter table public.payer_organisations enable row level security;
alter table public.billing_payer_rates enable row level security;
alter table public.client_payer_organisations enable row level security;
revoke all on public.payer_organisations, public.billing_payer_rates, public.client_payer_organisations from anon, authenticated;
grant select on public.payer_organisations, public.billing_payer_rates, public.client_payer_organisations to authenticated;
create policy payer_organisations_select on public.payer_organisations
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.view')));
create policy billing_payer_rates_select on public.billing_payer_rates
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.view')));
create policy client_payer_organisations_select on public.client_payer_organisations
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.view')));
create trigger payer_organisations_audit after insert or update or delete on public.payer_organisations
  for each row execute function private.audit_trigger('note');
create trigger billing_payer_rates_audit after insert or update or delete on public.billing_payer_rates
  for each row execute function private.audit_trigger();
create trigger client_payer_organisations_audit after insert or update or delete on public.client_payer_organisations
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- invoices and their lines
-- -----------------------------------------------------------------------------
alter table public.invoices
  add column payer_organisation_id uuid,
  add column payer_reference text,
  add constraint invoices_payer_organisation_fkey foreign key (org_id, payer_organisation_id)
    references public.payer_organisations (org_id, id),
  add constraint invoices_payer_reference_check check (payer_reference is null or char_length(payer_reference) between 1 and 60);
alter table public.invoices
  drop constraint invoices_payer_kind_check,
  add constraint invoices_payer_kind_check check (
    (payer_kind in ('client', 'relation') and payer_organisation_id is null and ((payer_kind = 'client') = (payer_client_id = client_id)))
    or (payer_kind = 'organisation' and payer_organisation_id is not null and payer_client_id = client_id)),
  drop constraint invoices_source_check,
  add constraint invoices_source_check check (source_type in ('appointment', 'manual', 'service', 'import', 'payer'));
create index invoices_org_payer_organisation_idx on public.invoices (org_id, payer_organisation_id) where payer_organisation_id is not null;

alter table public.invoice_lines
  add column client_payer_id uuid references public.client_payers(id),
  add column payer_organisation_id uuid,
  add column source_line_id uuid references public.invoice_lines(id),
  add column service_on date,
  add constraint invoice_lines_payer_organisation_fkey foreign key (org_id, payer_organisation_id)
    references public.payer_organisations (org_id, id);
alter table public.invoice_lines
  drop constraint invoice_lines_type_check,
  add constraint invoice_lines_type_check check (
    line_type in ('service', 'cancellation_fee', 'file_opening', 'adjustment', 'ivac_gap', 'payer_share', 'payer_claim')),
  drop constraint invoice_lines_price_check,
  add constraint invoice_lines_price_check check (
    unit_price_cents is null
    or (line_type = 'payer_share' and unit_price_cents between -10000000 and 0)
    or (line_type <> 'payer_share' and unit_price_cents between 0 and 10000000)),
  add constraint invoice_lines_payer_check check (
    (line_type in ('payer_share', 'payer_claim')) = (client_payer_id is not null and payer_organisation_id is not null)),
  add constraint invoice_lines_claim_check check ((line_type = 'payer_claim') = (source_line_id is not null));
create index invoice_lines_client_payer_idx on public.invoice_lines (client_payer_id) where client_payer_id is not null;
create index invoice_lines_org_payer_organisation_idx on public.invoice_lines (org_id, payer_organisation_id) where payer_organisation_id is not null;
-- A share is claimed by one live line (a credited payer invoice frees it).
create unique index invoice_lines_one_claim_idx on public.invoice_lines (source_line_id) where source_line_id is not null and not credited;

-- -----------------------------------------------------------------------------
-- The clinic's IVAC and its rate (every clinic; new ones through the reference seed)
-- -----------------------------------------------------------------------------
create or replace function private.seed_billing_reference(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  perform pg_catalog.set_config('app.audit_source', 'seed:billing_reference', true);
  insert into public.payment_modes (org_id, code, name, is_deposit, sort_order) values
    (p_org, 'interac',           'Virement Interac',            true,  1),
    (p_org, 'stripe',            'Carte (Stripe)',              true,  2),
    (p_org, 'qbo_payments_card', 'Carte (QuickBooks Payments)', true,  3),
    (p_org, 'bank_transfer',     'Virement bancaire',           true,  4),
    (p_org, 'cheque',            'Chèque',                      true,  5),
    (p_org, 'credit_note',       'Note de crédit',              false, 6)
  on conflict (org_id, code) do nothing;
  -- FP: the clinic's IVAC (its address to complete) and what it pays per session (Christine 12).
  insert into public.payer_organisations (org_id, kind, name, cadence)
  select p_org, 'ivac', 'IVAC', 'monthly'
   where not exists (select 1 from public.payer_organisations o where o.org_id = p_org and o.kind = 'ivac');
  insert into public.billing_payer_rates (org_id, kind, effective_from, session_cents)
  values (p_org, 'ivac', date '2000-01-01', 9450)
  on conflict do nothing;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
end;
$$;
select private.seed_billing_reference(o.id) from public.organizations o;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
-- What IVAC pays for a session that day.
create function private.billing_ivac_rate(p_org uuid, p_on date)
returns int
language sql
stable
set search_path = ''
as $$
  select r.session_cents from public.billing_payer_rates r
   where r.org_id = p_org and r.kind = 'ivac' and r.effective_from <= p_on
   order by r.effective_from desc limit 1
$$;

-- The organisation a client's payer is billed to: the one chosen, else IVAC's, else the PAE
-- provider of the same name (accents and case as typed, case ignored); null: to choose.
create function private.billing_payer_organisation(p_org uuid, p_client_payer_id uuid, p_kind text, p_name text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select c.organisation_id from public.client_payer_organisations c
       join public.payer_organisations o on o.id = c.organisation_id and o.is_active
      where c.org_id = p_org and c.client_payer_id = p_client_payer_id),
    case when p_kind = 'ivac' then
      (select o.id from public.payer_organisations o where o.org_id = p_org and o.kind = 'ivac' and o.is_active)
    else
      (select o.id from public.payer_organisations o
        where o.org_id = p_org and o.kind = 'pae' and o.is_active and pg_catalog.lower(o.name) = pg_catalog.lower(p_name))
    end)
$$;

-- The agreement's year holding a day: from the day after a renewal to the next renewal (both
-- counted), within the agreement's own dates; no renewal: the agreement's dates.
create function private.billing_payer_period(p_on date, p_renewal_month int, p_renewal_day int, p_starts_on date, p_expires_on date,
                                             out period_from date, out period_to date)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_this date;
begin
  if p_renewal_month is null then
    period_from := coalesce(p_starts_on, date '1900-01-01');
    period_to := coalesce(p_expires_on, date '2999-12-31');
    return;
  end if;
  v_this := pg_catalog.make_date(extract(year from p_on)::int, p_renewal_month, p_renewal_day);
  period_to := case when p_on <= v_this then v_this else (v_this + interval '1 year')::date end;
  period_from := ((period_to - interval '1 year')::date) + 1;
  period_from := greatest(period_from, coalesce(p_starts_on, period_from));
  period_to := least(period_to, coalesce(p_expires_on, period_to));
end;
$$;

-- A payer's consumption in a period: the shares of the issued invoices not credited (an invoice left out).
create function private.billing_payer_consumed(p_org uuid, p_client_payer_id uuid, p_from date, p_to date, p_except uuid,
                                               out amount_cents int, out sessions int)
language sql
stable
set search_path = ''
as $$
  select coalesce(-pg_catalog.sum(l.total_cents), 0)::int, pg_catalog.count(*)::int
    from public.invoice_lines l
    join public.invoices i on i.id = l.invoice_id
   where l.org_id = p_org and l.line_type = 'payer_share' and l.client_payer_id = p_client_payer_id and not l.credited
     and i.status = 'issued' and i.id is distinct from p_except and l.service_on between p_from and p_to
$$;

-- (Re)computes a client's draft invoice's shares (FP-2): returns how many sessions a payer covers.
create function private.billing_apply_payer_shares(p_org uuid, p_invoice_id uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v public.invoices;
  l record;
  t record;
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
    if t.kind = 'ivac' then
      v_amount := least(coalesce(private.billing_ivac_rate(p_org, l.local_date), 0), l.subtotal_cents);
    elsif t.coverage_percent is not null then
      v_amount := pg_catalog.round(l.subtotal_cents * t.coverage_percent / 100.0)::int;
    elsif t.session_amount_cents is not null then
      v_amount := least(t.session_amount_cents, l.subtotal_cents);
    else
      continue;
    end if;
    select x.period_from, x.period_to into v_from, v_to
      from private.billing_payer_period(l.local_date, t.renewal_month, t.renewal_day, t.starts_on, t.expires_on) x;
    select c.amount_cents, c.sessions into v_used, v_count
      from private.billing_payer_consumed(p_org, t.client_payer_id, v_from, v_to, v.id) c;
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

-- A client's draft has a session a payer should cover but cannot yet (a stub, no organisation,
-- a PAE without its amount or share): « Payeur tiers à compléter ».
create function private.billing_payer_incomplete(p_invoice public.invoices)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_invoice.status = 'draft' and p_invoice.payer_kind <> 'organisation' and exists (
    select 1
      from public.invoice_lines x
      join private.appointment_billing_facts(p_invoice.org_id, array[x.appointment_id]) f on true
     cross join lateral (select t.* from private.client_payer_terms(p_invoice.org_id, p_invoice.client_id, f.local_date) t limit 1) t
     where x.invoice_id = p_invoice.id and x.line_type = 'service' and x.appointment_id is not null
       and (t.is_stub
            or private.billing_payer_organisation(p_invoice.org_id, t.client_payer_id, t.kind, t.organisation_name) is null
            or (t.kind = 'pae' and t.session_amount_cents is null and t.coverage_percent is null)))
$$;

-- An invoice's payer as its documents show it: the person, or the organisation (FP-4).
create function private.billing_invoice_payer(p_invoice public.invoices)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when p_invoice.payer_kind = 'organisation' then (
           select pg_catalog.jsonb_build_object('id', o.id, 'name', o.name, 'first_name', coalesce(o.contact_name, o.name),
                                                'client_number', null, 'language', o.language, 'kind', 'organisation')
             from public.payer_organisations o where o.id = p_invoice.payer_organisation_id)
         else private.billing_person(p_invoice.org_id, p_invoice.payer_client_id) end
$$;

-- Where an invoice's documents go: the organisation's billing address, else the payer's.
create function private.billing_invoice_payer_email(p_invoice public.invoices)
returns text
language sql
stable
set search_path = ''
as $$
  select case when p_invoice.payer_kind = 'organisation' then (
           select nullif(pg_catalog.btrim(o.billing_email), '') from public.payer_organisations o where o.id = p_invoice.payer_organisation_id)
         else private.billing_payer_email(p_invoice.org_id, p_invoice.client_id, p_invoice.payer_client_id) end
$$;

-- A payer invoice draft for a client's payer (open one first: the next claims join it).
create function private.billing_payer_draft(p_org uuid, p_client_payer_id uuid, p_organisation_id uuid, p_actor uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  t record;
  o public.payer_organisations;
  v_id uuid;
begin
  select f.* into t from private.client_payer_facts(p_org, array[p_client_payer_id]) f;
  select x.* into o from public.payer_organisations x where x.org_id = p_org and x.id = p_organisation_id;
  if t.client_payer_id is null or o.id is null then
    raise exception 'Payeur introuvable.' using errcode = 'P0001', hint = 'client_payer_id';
  end if;
  if not o.is_active then
    raise exception 'Cet organisme payeur est désactivé.' using errcode = 'P0001', hint = 'organisation_id';
  end if;
  select i.id into v_id from public.invoices i
   where i.org_id = p_org and i.status = 'draft' and i.payer_kind = 'organisation' and i.source_type = 'payer'
     and i.source_id = p_client_payer_id and i.payer_organisation_id = o.id
   order by i.created_at limit 1;
  if v_id is not null then
    return v_id;
  end if;
  perform private.billing_check_client(p_org, t.client_id);
  insert into public.invoices (org_id, client_id, payer_kind, payer_client_id, payer_organisation_id, payer_reference,
                               tax_exempt, source_type, source_id, notes_client, created_by)
  values (p_org, t.client_id, 'organisation', t.client_id, o.id, t.file_number, false, 'payer', p_client_payer_id,
          case when t.file_number is not null then
            pg_catalog.left(case when o.kind = 'ivac' then 'Dossier IVAC n° ' else 'Dossier n° ' end || t.file_number, 2000) end,
          p_actor)
  returning id into v_id;
  return v_id;
end;
$$;

-- How far a payer's unclaimed shares are invoiced today (FP-3): the last session day to claim, or
-- null (nothing yet). `monthly` (and `threshold` without a maximum): the sessions of the past months;
-- `threshold`: everything once it reaches a third of the maximum, or once the agreement's year is
-- over; `closing`: the year's sessions once it is over.
create function private.billing_payer_claim_until(p_cadence text, p_max_cents int, p_total int, p_before_month int,
                                                  p_period_to date, p_today date)
returns date
language sql
immutable
set search_path = ''
as $$
  select case
    when p_cadence = 'monthly' or (p_cadence = 'threshold' and p_max_cents is null) then
      case when coalesce(p_before_month, 0) > 0 then (pg_catalog.date_trunc('month', p_today)::date - 1) end
    when p_cadence = 'threshold' then
      case when p_total * 3 >= p_max_cents or p_period_to < p_today then p_today end
    else
      case when p_period_to < p_today then p_period_to end
  end
$$;

-- The shares to claim (FP-3): the payer invoices due, as drafts; `p_closing` claims every share
-- (« Facturer les PAE »). One organisation, or all. Returns the drafts made or added to.
create function private.billing_build_payer_invoices(p_org uuid, p_organisation_id uuid, p_closing boolean, p_actor uuid)
returns uuid[]
language plpgsql
set search_path = ''
as $$
declare
  v_today date := private.billing_today(p_org);
  v_month date := pg_catalog.date_trunc('month', v_today)::date;
  g record;
  t record;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_due boolean;
  v_take date;
  v_from date;
  v_to date;
begin
  for g in
    with s as (
      select l.id, l.client_payer_id, l.payer_organisation_id, l.service_on, -l.total_cents as amount
        from public.invoice_lines l
        join public.invoices i on i.id = l.invoice_id
       where l.org_id = p_org and l.line_type = 'payer_share' and not l.credited and i.status = 'issued'
         and (p_organisation_id is null or l.payer_organisation_id = p_organisation_id)
         and not exists (select 1 from public.invoice_lines c where c.source_line_id = l.id and not c.credited)
    )
    select s.client_payer_id, s.payer_organisation_id, o.cadence, o.is_active,
           pg_catalog.sum(s.amount)::int as total, pg_catalog.min(s.service_on) as oldest,
           pg_catalog.sum(s.amount) filter (where s.service_on < v_month)::int as before_month
      from s join public.payer_organisations o on o.id = s.payer_organisation_id
     group by s.client_payer_id, s.payer_organisation_id, o.cadence, o.is_active
  loop
    continue when not g.is_active;
    select f.* into t from private.client_payer_facts(p_org, array[g.client_payer_id]) f;
    select x.period_from, x.period_to into v_from, v_to
      from private.billing_payer_period(g.oldest, t.renewal_month, t.renewal_day, t.starts_on, t.expires_on) x;
    v_take := case when p_closing then v_today
                   else private.billing_payer_claim_until(g.cadence, t.max_amount_cents, g.total, g.before_month, v_to, v_today) end;
    continue when v_take is null;
    v_id := private.billing_payer_draft(p_org, g.client_payer_id, g.payer_organisation_id, p_actor);
    insert into public.invoice_lines (org_id, invoice_id, position, line_type, appointment_id, professional_id, service_code,
                                      description, quantity, unit_price_cents, price_source, tax_rule, client_payer_id,
                                      payer_organisation_id, source_line_id, service_on)
    select p_org, v_id,
           coalesce((select max(z.position) from public.invoice_lines z where z.invoice_id = v_id), 0)
             + pg_catalog.row_number() over (order by l.service_on, l.id),
           'payer_claim', l.appointment_id, l.professional_id, sl.service_code,
           pg_catalog.left(coalesce(sl.description, 'Séance du ' || private.format_date_fr(l.service_on)), 300),
           1, -l.total_cents, 'payer', 'exempt', l.client_payer_id, l.payer_organisation_id, l.id, l.service_on
      from public.invoice_lines l
      join public.invoices i on i.id = l.invoice_id
      left join lateral (select x.service_code, x.description from public.invoice_lines x
                          where x.invoice_id = l.invoice_id and x.appointment_id = l.appointment_id and x.line_type = 'service'
                          limit 1) sl on true
     where l.org_id = p_org and l.line_type = 'payer_share' and not l.credited and i.status = 'issued'
       and l.client_payer_id = g.client_payer_id and l.payer_organisation_id = g.payer_organisation_id
       and l.service_on <= v_take
       and not exists (select 1 from public.invoice_lines c where c.source_line_id = l.id and not c.credited);
    perform private.billing_recompute(v_id, v_today);
    v_ids := v_ids || v_id;
  end loop;
  return (select coalesce(pg_catalog.array_agg(distinct x), '{}') from pg_catalog.unnest(v_ids) x);
end;
$$;

revoke all on function private.billing_ivac_rate(uuid, date), private.billing_payer_organisation(uuid, uuid, text, text),
  private.billing_payer_period(date, int, int, date, date), private.billing_payer_consumed(uuid, uuid, date, date, uuid),
  private.billing_apply_payer_shares(uuid, uuid), private.billing_payer_incomplete(public.invoices),
  private.billing_invoice_payer(public.invoices), private.billing_invoice_payer_email(public.invoices),
  private.billing_payer_draft(uuid, uuid, uuid, uuid), private.billing_build_payer_invoices(uuid, uuid, boolean, uuid),
  private.billing_payer_claim_until(text, int, int, int, date, date)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- What changes elsewhere (the current bodies, patched)
-- -----------------------------------------------------------------------------
-- A session's draft: the payer's share under each session it covers (FP-2).
create or replace function private.billing_invoice_appointments(
  p_org uuid, p_appointment_ids uuid[], p_payer_client_id uuid, p_file_opening boolean,
  p_notes_client text, p_notes_internal text, p_actor uuid, p_allow_missing boolean
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_client uuid;
  v_id uuid;
  v_first_date date;
  v_file_service uuid;
  a record;
  v_title uuid;
  v_count int := 0;
begin
  if coalesce(pg_catalog.cardinality(p_appointment_ids), 0) = 0 then
    raise exception 'Choisissez les rendez-vous à facturer.' using errcode = 'P0001', hint = 'appointment_ids';
  end if;
  -- One appointment at a time: no second invoice for it in a concurrent call.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('billing.appointment:' || x::text, 0))
     from (select distinct x from pg_catalog.unnest(p_appointment_ids) x order by x) y;
  for a in select f.* from private.appointment_billing_facts(p_org, p_appointment_ids) f order by f.starts_at loop
    v_count := v_count + 1;
    if a.is_personal then
      raise exception 'Un rendez-vous personnel ne se facture pas.' using errcode = 'P0001', hint = 'appointment_ids';
    end if;
    if a.state not in ('booked', 'confirmed', 'completed') then
      raise exception 'Ce rendez-vous est annulé ou en attente d''acceptation : il ne se facture pas ainsi.' using errcode = 'P0001', hint = 'appointment_ids';
    end if;
    if v_client is null then
      v_client := a.client_ids[1];
      v_first_date := a.local_date;
      v_id := private.billing_new_invoice(p_org, v_client, p_payer_client_id, 'appointment', a.appointment_id, p_actor);
    elsif not (v_client = any (a.client_ids)) then
      raise exception 'Une facture regroupe les rendez-vous d''un même dossier.' using errcode = 'P0001', hint = 'appointment_ids';
    end if;
    if exists (select 1 from public.invoice_lines l where l.appointment_id = a.appointment_id and l.line_type = 'service' and not l.credited) then
      raise exception 'Le rendez-vous du % est déjà facturé.', private.format_date_fr(a.local_date) using errcode = 'P0001', hint = 'appointment_ids';
    end if;
    select (f.title_ids)[1] into v_title from private.professional_booking_facts(p_org, a.professional_id) f;
    perform private.billing_add_service_line(p_org, v_id, 'service', a.service_id, v_title, a.local_date, a.appointment_id,
                                             a.professional_id, p_allow_missing);
  end loop;
  if v_count <> (select count(distinct x) from pg_catalog.unnest(p_appointment_ids) x) then
    raise exception 'Rendez-vous introuvable.' using errcode = 'P0001', hint = 'appointment_ids';
  end if;
  select b.file_opening_service_id into v_file_service from private.billing_policy_for(p_org, v_first_date) b;
  if v_file_service is not null and coalesce(p_file_opening,
       not exists (select 1 from public.invoices i where i.org_id = p_org and i.client_id = v_client and i.id <> v_id and i.status <> 'credited')) then
    perform private.billing_add_service_line(p_org, v_id, 'file_opening', v_file_service, null, v_first_date, null, null, p_allow_missing);
  end if;
  update public.invoices i
     set notes_client = nullif(pg_catalog.btrim(coalesce(p_notes_client, '')), ''),
         notes_internal = nullif(pg_catalog.btrim(coalesce(p_notes_internal, '')), '')
   where i.id = v_id;
  perform private.billing_apply_payer_shares(p_org, v_id);
  perform private.billing_recompute(v_id, private.billing_today(p_org));
  return v_id;
end;
$$;

-- Finalising: an organisation's invoice is due in its delay; a client's gets its shares again (FP-2, FP-4).
create or replace function private.billing_finalize(p_org uuid, p_invoice_id uuid, p_actor uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v public.invoices;
  v_today date := private.billing_today(p_org);
  v_year int := extract(year from v_today)::int;
  v_seq int;
  v_number text;
begin
  select i.* into v from public.invoices i where i.org_id = p_org and i.id = p_invoice_id for update;
  if v.id is null or v.status <> 'draft' then
    raise exception 'Cette facture est finalisée : corrigez-la par une note de crédit et une nouvelle facture.' using errcode = 'P0001', hint = 'status';
  end if;
  if not exists (select 1 from public.invoice_lines l where l.invoice_id = v.id) then
    raise exception 'Une facture compte au moins une ligne.' using errcode = 'P0001', hint = 'lines';
  end if;
  if exists (select 1 from public.invoice_lines l where l.invoice_id = v.id and l.unit_price_cents is null) then
    raise exception 'Indiquez le montant de chaque ligne « montant saisi à la facture ».' using errcode = 'P0001', hint = 'price_missing';
  end if;
  if v.payer_kind = 'organisation' then
    if not exists (select 1 from public.payer_organisations o where o.id = v.payer_organisation_id and o.is_active) then
      raise exception 'Cet organisme payeur est désactivé : réactivez-le ou supprimez le brouillon.' using errcode = 'P0001', hint = 'payer';
    end if;
  elsif not private.billing_payer_allowed(p_org, v.client_id, v.payer_client_id) then
    raise exception 'Cette personne ne peut plus recevoir les factures de ce client : choisissez un autre payeur.' using errcode = 'P0001', hint = 'payer';
  end if;
  perform private.billing_check_client(p_org, v.client_id);
  -- FP-9: a session a payer should cover is never billed in full to the client by mistake.
  if private.billing_payer_incomplete(v) then
    raise exception 'Complétez d''abord le payeur tiers du client (IVAC ou PAE) dans son dossier : sinon la séance lui serait facturée en entier.'
      using errcode = 'P0001', hint = 'payer_incomplete';
  end if;
  -- FP-2: the payers' shares again, on this year's consumption at this moment.
  perform private.billing_apply_payer_shares(p_org, v.id);
  perform private.billing_recompute(v.id, v_today);
  v_seq := private.billing_next_number(p_org, 'invoice', v_year);
  v_number := v_year::text || '-' || v_seq::text;
  update public.invoices i
     set status = 'issued', number = v_number, year = v_year, seq = v_seq, issued_on = v_today,
         due_on = v_today + case when v.payer_kind = 'organisation'
           then coalesce((select o.due_days from public.payer_organisations o where o.id = v.payer_organisation_id), 30) else 0 end,
         finalized_at = pg_catalog.now(), finalized_by = p_actor, hold_reason = null, hold_note = null
   where i.id = v.id;
  perform private.billing_apply_payments(v.id);
  perform private.billing_queue_sync(p_org, 'invoice_issued', v.id, v.id);
  return v_number;
end;
$$;

-- A draft's live holds: an organisation's address; a third-party payer to complete (FP-9).
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
           then 'payer_missing' end,
    case when private.billing_payer_incomplete(p_invoice) then 'payer_incomplete' end)
$$;

-- A document's payer: the organisation for its invoices; a statement never holds them (FP-4, FP-6).
create or replace function private.billing_document(p_org uuid, p_kind text, p_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v public.invoices;
  c public.credit_notes;
  r public.receipts;
  p public.payments;
  s public.statements;
  v_ids uuid[];
begin
  if p_kind = 'invoice' then
    select i.* into v from public.invoices i where i.org_id = p_org and i.id = p_id;
  elsif p_kind = 'credit_note' then
    select x.* into c from public.credit_notes x where x.org_id = p_org and x.id = p_id;
    select i.* into v from public.invoices i where i.org_id = p_org and i.id = c.invoice_id;
  elsif p_kind = 'receipt' then
    select x.* into r from public.receipts x where x.org_id = p_org and x.id = p_id;
    select x.* into p from public.payments x where x.org_id = p_org and x.id = r.payment_id;
    select i.* into v from public.invoices i where i.org_id = p_org and i.id = r.invoice_id;
  elsif p_kind = 'statement' then
    select x.* into s from public.statements x where x.org_id = p_org and x.id = p_id;
    if s.id is null then
      return null;
    end if;
    select coalesce(pg_catalog.array_agg(i.id), '{}') into v_ids from public.invoices i
     where i.org_id = p_org and i.client_id = s.client_id and i.payer_client_id = s.payer_client_id and i.payer_kind <> 'organisation' and i.status <> 'draft'
       and i.issued_on between s.period_from and s.period_to;
    return pg_catalog.jsonb_build_object(
      'kind', 'statement', 'id', s.id, 'year', s.year, 'period_from', s.period_from, 'period_to', s.period_to,
      'issued_on', (s.created_at at time zone coalesce((select o.timezone from public.organizations o where o.id = p_org), 'America/Toronto'))::date,
      'clinic', private.billing_clinic(p_org), 'client', private.billing_person(p_org, s.client_id),
      'payer', private.billing_person(p_org, s.payer_client_id),
      'invoices', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                    'id', i.id, 'number', i.number, 'issued_on', i.issued_on, 'status', i.status, 'total_cents', i.total_cents,
                    'paid_cents', i.paid_cents, 'credit_note_number', (select cn.number from public.credit_notes cn where cn.invoice_id = i.id))
                    order by i.issued_on, i.seq)
                    from public.invoices i where i.id = any (v_ids)), '[]'::jsonb),
      'payments', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                    'receipt_number', rc.number, 'paid_on', x.paid_on, 'amount_cents', x.amount_cents, 'mode', m.name,
                    'invoice_number', i.number) order by x.paid_on, rc.seq)
                    from public.payments x join public.receipts rc on rc.payment_id = x.id
                    join public.invoices i on i.id = x.invoice_id
                    join public.payment_modes m on m.org_id = x.org_id and m.code = x.mode_code
                   where x.invoice_id = any (v_ids)), '[]'::jsonb),
      'lines', private.billing_lines(p_org, v_ids),
      'professionals', private.billing_professionals(p_org, v_ids));
  else
    return null;
  end if;
  if v.id is null then
    return null;
  end if;
  return pg_catalog.jsonb_build_object(
    'kind', p_kind,
    'id', p_id,
    'number', case p_kind when 'invoice' then v.number when 'credit_note' then c.number else r.number end,
    'issued_on', case p_kind when 'invoice' then v.issued_on when 'credit_note' then c.issued_on else r.issued_on end,
    'invoice', pg_catalog.jsonb_build_object(
      'id', v.id, 'number', v.number, 'status', v.status, 'issued_on', v.issued_on, 'due_on', v.due_on, 'tax_exempt', v.tax_exempt,
      'gst_rate', v.gst_rate, 'qst_rate', v.qst_rate, 'subtotal_cents', v.subtotal_cents, 'gst_cents', v.gst_cents,
      'qst_cents', v.qst_cents, 'total_cents', v.total_cents, 'paid_cents', v.paid_cents, 'notes_client', v.notes_client,
      'payer_kind', v.payer_kind, 'payer_reference', v.payer_reference),
    'payment', case when p_kind = 'receipt' then pg_catalog.jsonb_build_object(
      'amount_cents', p.amount_cents, 'paid_on', p.paid_on,
      'mode', (select m.name from public.payment_modes m where m.org_id = p.org_id and m.code = p.mode_code)) end,
    'clinic', private.billing_clinic(p_org),
    'client', private.billing_person(p_org, v.client_id),
    'payer', private.billing_invoice_payer(v),
    'lines', private.billing_lines(p_org, array[v.id]),
    'professionals', private.billing_professionals(p_org, array[v.id]));
end;
$$;

-- An organisation's invoice goes to its billing address (FP-4).
create or replace function public.billing_document_for_service(p_org_id uuid, p_delivery_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.billing_deliveries;
  v_doc_id uuid;
  v_doc jsonb;
  v_file uuid;
  v_client uuid;
  v_payer uuid;
  v_email text;
  v_skip text;
begin
  select x.* into d from public.billing_deliveries x where x.org_id = p_org_id and x.id = p_delivery_id and x.status = 'sending';
  if d.id is null then
    return null;
  end if;
  v_doc_id := case d.kind when 'invoice' then d.invoice_id when 'reminder' then d.invoice_id when 'credit_note' then d.credit_note_id
                          when 'receipt' then d.receipt_id else d.statement_id end;
  -- A reminder prints the invoice (its PDF, kept on the invoice).
  v_doc := private.billing_document(p_org_id, case when d.kind = 'reminder' then 'invoice' else d.kind end, v_doc_id);
  if v_doc is null then
    return null;
  end if;
  v_file := case d.kind
    when 'invoice' then (select i.pdf_file_id from public.invoices i where i.id = d.invoice_id)
    when 'reminder' then (select i.pdf_file_id from public.invoices i where i.id = d.invoice_id)
    when 'credit_note' then (select c.pdf_file_id from public.credit_notes c where c.id = d.credit_note_id)
    when 'receipt' then (select r.pdf_file_id from public.receipts r where r.id = d.receipt_id)
    else (select s.pdf_file_id from public.statements s where s.id = d.statement_id) end;
  v_client := (v_doc -> 'client' ->> 'id')::uuid;
  v_payer := (v_doc -> 'payer' ->> 'id')::uuid;
  if not d.send_email then
    v_skip := 'not_requested';
  elsif not public.module_open_to_all_for_org(p_org_id, 'billing') then
    v_skip := 'reserved';
  else
    v_email := case when d.kind = 'statement' then private.billing_payer_email(p_org_id, v_client, v_payer)
                    else private.billing_invoice_payer_email((select i from public.invoices i where i.id = (v_doc -> 'invoice' ->> 'id')::uuid)) end;
    if v_email is null then
      v_skip := 'no_email';
    end if;
  end if;
  return pg_catalog.jsonb_build_object(
    'delivery_id', d.id, 'kind', d.kind, 'document_id', v_doc_id, 'explicit', d.explicit, 'attempts', d.attempts,
    'document', v_doc,
    'stored', (select pg_catalog.jsonb_build_object('file_id', f.id, 'bucket', f.bucket, 'object_path', f.object_path)
                 from public.stored_files f where f.id = v_file and f.status = 'ready'),
    'logo', (select pg_catalog.jsonb_build_object('bucket', f.bucket, 'object_path', f.object_path)
               from public.organizations o join public.stored_files f on f.id = o.logo_file_id and f.status = 'ready'
              where o.id = p_org_id),
    'email', case when v_skip is null then pg_catalog.jsonb_build_object(
               'to', v_email, 'first_name', v_doc -> 'payer' ->> 'first_name', 'language', v_doc -> 'payer' ->> 'language') end,
    'skip_reason', v_skip,
    'reminder', case when d.kind = 'reminder' then (
      select pg_catalog.jsonb_build_object('step', r.step, 'days', private.billing_today(p_org_id) - i.due_on,
                                           'balance_cents', i.total_cents - i.paid_cents)
        from public.billing_dunning_runs r join public.invoices i on i.id = r.invoice_id
       where r.delivery_id = d.id) end);
end;
$$;

-- What a payer owes never blocks the client (FP-6).
create or replace function private.client_has_balance(p_org uuid, p_client_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.module_enabled_for_org(p_org, 'billing')
     and exists (
       select 1
         from public.billing_settings s
         join public.invoices i on i.org_id = s.org_id
        where s.org_id = p_org and s.dunning_from is not null
          and i.client_id = p_client_id and i.payer_kind <> 'organisation' and i.status = 'issued' and i.total_cents > i.paid_cents
          and i.issued_on >= s.dunning_from
          and i.due_on <= private.billing_today(p_org) - s.block_after_days)
$$;

-- « Impayés »: an organisation's invoice with its name, never blocking (FP-6).
create or replace function public.list_overdue_invoices()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.view');
  v_today date := private.billing_today(v_org);
  v_block int := coalesce((select s.block_after_days from public.billing_settings s where s.org_id = v_org), 10);
begin
  return coalesce((
    with v as (
      select i.* from public.invoices i
       where i.org_id = v_org and i.status = 'issued' and i.total_cents > i.paid_cents and i.due_on < v_today
       order by i.due_on limit 500
    ),
    names as (
      select n.* from private.clients_display_names(v_org, (select coalesce(pg_catalog.array_agg(distinct x), '{}')
                                                              from (select v.client_id x from v union select v.payer_client_id from v) y)) n
    )
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', v.id, 'number', v.number, 'client_id', v.client_id, 'client_name', c.display_name,
             'payer_client_id', v.payer_client_id, 'payer_kind', v.payer_kind,
             'payer_name', case when v.payer_kind = 'organisation' then (select o.name from public.payer_organisations o where o.id = v.payer_organisation_id) else p.display_name end, 'issued_on', v.issued_on, 'due_on', v.due_on,
             'days', v_today - v.due_on, 'total_cents', v.total_cents, 'paid_cents', v.paid_cents,
             'balance_cents', v.total_cents - v.paid_cents,
             'last_step', (select max(r.step) from public.billing_dunning_runs r where r.invoice_id = v.id),
             'blocking', v.payer_kind <> 'organisation' and private.client_has_balance(v_org, v.client_id) and v_today - v.due_on >= v_block,
             'payer_has_email', private.billing_invoice_payer_email((select i from public.invoices i where i.id = v.id)) is not null)
             order by v.due_on, v.number)
      from v
      left join names c on c.client_id = v.client_id
      left join names p on p.client_id = v.payer_client_id), '[]'::jsonb);
end;
$$;

-- Reminders: an organisation's when it wants them; never the balance notices (FP-6).
create or replace function private.billing_run_dunning(p_org uuid, p_today date)
returns int
language plpgsql
set search_path = ''
as $$
declare
  i record;
  v_days int;
  v_step smallint;
  v_delivery uuid;
  v_count int := 0;
  v_client text;
  v_pro record;
begin
  for i in select inv.*, s.dunning_days, s.block_after_days
             from public.invoices inv join public.billing_settings s on s.org_id = inv.org_id
            where inv.org_id = p_org and s.dunning_from is not null and inv.status = 'issued'
              and inv.total_cents > inv.paid_cents and inv.issued_on >= s.dunning_from and inv.due_on < p_today
              -- FP-6: an organisation gets reminders only when it is set to.
              and (inv.payer_kind <> 'organisation'
                   or exists (select 1 from public.payer_organisations o where o.id = inv.payer_organisation_id and o.reminders_enabled))
            order by inv.due_on loop
    v_days := p_today - i.due_on;
    select max(x) into v_step from pg_catalog.unnest(i.dunning_days) x
     where x <= v_days and not exists (select 1 from public.billing_dunning_runs r where r.invoice_id = i.id and r.step = x);
    if v_step is not null then
      v_delivery := private.billing_queue_delivery(p_org, 'reminder', i.id, true, false, null);
      insert into public.billing_dunning_runs (org_id, invoice_id, step, run_on, delivery_id)
      select p_org, i.id, x, p_today, case when x = v_step then v_delivery end
        from pg_catalog.unnest(i.dunning_days) x
       where x <= v_step and not exists (select 1 from public.billing_dunning_runs r where r.invoice_id = i.id and r.step = x);
      v_count := v_count + 1;
    end if;
    if v_days >= i.block_after_days and i.payer_kind <> 'organisation' then
      select n.display_name into v_client from private.clients_display_names(p_org, array[i.client_id]) n;
      perform private.notify(p_org, 'billing', 'billing.balance_due', 'important',
        pg_catalog.left('Solde impayé : ' || coalesce(v_client, 'un client'), 200),
        pg_catalog.left('La facture ' || i.number || ' est impayée depuis ' || v_days || ' jours ('
                        || private.billing_format_money(i.total_cents - i.paid_cents)
                        || '). Un nouveau rendez-vous demande une exception approuvée.', 500),
        '/facturation/factures/' || i.id::text, 'invoice', i.id, 'billing.view', null, 'balance:' || i.id::text, null);
      for v_pro in select distinct l.professional_id, private.professional_profile_id(p_org, l.professional_id) as profile_id
                     from public.invoice_lines l where l.invoice_id = i.id and l.professional_id is not null loop
        if v_pro.profile_id is not null and exists (select 1 from public.profiles p where p.user_id = v_pro.profile_id and p.status = 'active') then
          perform private.notify(p_org, 'billing', 'billing.balance_due', 'normal',
            pg_catalog.left('Solde impayé : ' || coalesce(v_client, 'un client'), 200),
            'Votre client a un solde impayé depuis ' || v_days || ' jours : un nouveau rendez-vous demande une exception approuvée par la clinique.',
            '/mon-agenda', 'invoice', i.id, 'billing.self', v_pro.profile_id,
            'balance:' || i.id::text || ':' || v_pro.professional_id::text, null);
        end if;
      end loop;
    end if;
  end loop;
  return v_count;
end;
$$;

-- « Factures »: an organisation's invoice says its payer (FP-4).
create or replace function public.list_invoices(p_status text default null, p_client_id uuid default null, p_before timestamptz default null, p_limit int default 50)
returns table (
  id uuid, number text, status text, client_id uuid, client_name text, client_number int, payer_client_id uuid, payer_name text,
  issued_on date, total_cents int, paid_cents int, payment_status text, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.billing_require('billing.view');
begin
  return query
    with v as (
      select i.* from public.invoices i
       where i.org_id = v_org and (p_status is null or i.status = p_status) and (p_client_id is null or i.client_id = p_client_id)
         and (p_before is null or i.created_at < p_before)
       order by i.created_at desc
       limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ),
    names as (
      select n.* from private.clients_display_names(v_org, (select coalesce(array_agg(distinct x), '{}')
                                                              from (select v.client_id x from v union select v.payer_client_id from v) y)) n
    )
    select v.id, v.number, v.status, v.client_id, c.display_name, c.client_number, v.payer_client_id,
           case when v.payer_kind = 'organisation' then (select o.name from public.payer_organisations o where o.id = v.payer_organisation_id) else p.display_name end,
           v.issued_on, v.total_cents, v.paid_cents, v.payment_status, v.created_at
      from v
      left join names c on c.client_id = v.client_id
      left join names p on p.client_id = v.payer_client_id
     order by v.created_at desc;
end;
$$;

-- The invoice page: an organisation as its payer (FP-4).
create or replace function public.get_invoice(p_invoice_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.view');
  v public.invoices;
begin
  select i.* into v from public.invoices i where i.org_id = v_org and i.id = p_invoice_id;
  if v.id is null then
    return null;
  end if;
  return pg_catalog.jsonb_build_object(
    'invoice', pg_catalog.to_jsonb(v) || pg_catalog.jsonb_build_object('hold_now', case when v.status = 'draft' then private.billing_hold_now(v) end,
                                                                       'payer_has_email', private.billing_invoice_payer_email(v) is not null),
    'client', (select pg_catalog.jsonb_build_object('id', f.client_id, 'name', f.display_name, 'client_number', f.client_number)
                 from private.clients_billing_facts(v_org, array[v.client_id]) f),
    'payer', case when v.payer_kind = 'organisation' then (
               select pg_catalog.jsonb_build_object('id', o.id, 'name', o.name, 'client_number', null, 'kind', o.kind,
                                                    'billing_email', o.billing_email)
                 from public.payer_organisations o where o.id = v.payer_organisation_id)
             else (select pg_catalog.jsonb_build_object('id', f.client_id, 'name', f.display_name, 'client_number', f.client_number)
                     from private.clients_billing_facts(v_org, array[v.payer_client_id]) f) end,
    'payer_options', case when v.payer_kind = 'organisation' then '[]'::jsonb else private.billing_payer_options(v_org, v.client_id) end,
    'lines', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(l) order by l.position) from public.invoice_lines l where l.invoice_id = v.id), '[]'::jsonb),
    'credit_note', (select pg_catalog.to_jsonb(c) || pg_catalog.jsonb_build_object('deliveries', private.billing_delivery_list(v_org, 'credit_note', c.id))
                      from public.credit_notes c where c.invoice_id = v.id),
    'payments', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                  'id', p.id, 'mode_code', p.mode_code, 'mode', m.name, 'amount_cents', p.amount_cents, 'paid_on', p.paid_on,
                  'reference', p.reference, 'receipt_id', r.id, 'receipt_number', r.number, 'receipt_file_id', r.pdf_file_id,
                  'receipt_deliveries', private.billing_delivery_list(v_org, 'receipt', r.id),
                  'refunds', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                'id', f.id, 'amount_cents', f.amount_cents, 'reason', f.reason, 'status', f.status,
                                'created_at', f.created_at) order by f.created_at)
                                from public.refunds f where f.payment_id = p.id), '[]'::jsonb),
                  'refundable_cents', p.amount_cents - coalesce((select sum(f.amount_cents) from public.refunds f
                                                                  where f.payment_id = p.id and f.status <> 'failed'), 0))
                  order by p.paid_on, p.created_at)
                  from public.payments p
                  join public.payment_modes m on m.org_id = p.org_id and m.code = p.mode_code
                  left join public.receipts r on r.payment_id = p.id
                 where p.invoice_id = v.id), '[]'::jsonb),
    'deliveries', private.billing_delivery_list(v_org, 'invoice', v.id),
    'reminders', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                    'step', r.step, 'run_on', r.run_on, 'sent', r.delivery_id is not null,
                    'email_status', (select d.email_status from public.billing_deliveries d where d.id = r.delivery_id))
                    order by r.step)
                    from public.billing_dunning_runs r where r.invoice_id = v.id), '[]'::jsonb),
    'fee', (select pg_catalog.jsonb_build_object('appointment_id', c.appointment_id, 'kind', c.kind, 'decided_as', c.decided_as)
              from public.cancellation_fee_decisions c where c.invoice_id = v.id),
    'payment_modes', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('code', m.code, 'name', m.name) order by m.sort_order)
                                 from public.payment_modes m where m.org_id = v_org and m.is_active and m.code <> 'credit_note'), '[]'::jsonb));
end;
$$;

-- A dossier's balance is the client's, never a payer's (FP-6).
create or replace function public.get_client_billing(p_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.view');
  v_today date := private.billing_today(v_org);
begin
  return pg_catalog.jsonb_build_object(
    'default_payer_id', private.billing_default_payer(v_org, p_client_id, v_today),
    'payer_options', private.billing_payer_options(v_org, p_client_id),
    'special_agreement', (select pg_catalog.jsonb_build_object('note', a.note, 'created_at', a.created_at)
                            from public.special_agreements a where a.org_id = v_org and a.client_id = p_client_id and a.is_active),
    'balance_cents', coalesce((select sum(i.total_cents - i.paid_cents)::int from public.invoices i
                                where i.org_id = v_org and i.client_id = p_client_id and i.status = 'issued'
                                  and i.payer_kind <> 'organisation'), 0),
    'invoices', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                  'id', i.id, 'number', i.number, 'status', i.status, 'issued_on', i.issued_on, 'total_cents', i.total_cents,
                  'paid_cents', i.paid_cents, 'payment_status', i.payment_status,
                  'payer_client_id', i.payer_client_id, 'payer_kind', i.payer_kind,
                  'payer_organisation_name', (select o.name from public.payer_organisations o where o.id = i.payer_organisation_id),
                  'created_at', i.created_at) order by i.created_at desc)
                  from public.invoices i where i.org_id = v_org and i.client_id = p_client_id), '[]'::jsonb),
    'payments', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                  'id', p.id, 'invoice_id', p.invoice_id, 'invoice_number', i.number, 'mode', m.name, 'amount_cents', p.amount_cents,
                  'paid_on', p.paid_on, 'payer_client_id', p.payer_client_id, 'receipt_number', r.number, 'receipt_file_id', r.pdf_file_id)
                  order by p.paid_on desc, p.created_at desc)
                  from public.payments p
                  join public.invoices i on i.id = p.invoice_id
                  join public.payment_modes m on m.org_id = p.org_id and m.code = p.mode_code
                  left join public.receipts r on r.payment_id = p.id
                 where p.org_id = v_org and i.client_id = p_client_id), '[]'::jsonb),
    'statements', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                  'id', s.id, 'year', s.year, 'payer_client_id', s.payer_client_id, 'pdf_file_id', s.pdf_file_id, 'created_at', s.created_at,
                  'deliveries', private.billing_delivery_list(v_org, 'statement', s.id)) order by s.created_at desc)
                  from public.statements s where s.org_id = v_org and s.client_id = p_client_id), '[]'::jsonb),
    'to_invoice', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                  'appointment_id', a.appointment_id, 'starts_at', a.starts_at, 'state', a.state, 'service_id', a.service_id,
                  'professional_id', a.professional_id, 'first_client', a.client_ids[1] = p_client_id) order by a.starts_at desc)
                  from private.client_billable_appointments(v_org, p_client_id, v_today - 365) a
                 where a.starts_at < pg_catalog.now() + interval '1 day'
                   and not exists (select 1 from public.invoice_lines l
                                    where l.appointment_id = a.appointment_id and l.line_type = 'service' and not l.credited)), '[]'::jsonb));
end;
$$;

-- An organisation's invoice keeps its payer.
create or replace function public.set_invoice_payer(p_invoice_id uuid, p_payer_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  v public.invoices := private.billing_draft(p_invoice_id);
begin
  if v.payer_kind = 'organisation' then
    raise exception 'La facture d''un organisme payeur garde son payeur.' using errcode = 'P0001', hint = 'payer';
  end if;
  if p_payer_client_id is null or not private.billing_payer_allowed(v_org, v.client_id, p_payer_client_id) then
    raise exception 'Cette personne ne peut pas recevoir les factures de ce client : donnez-lui le droit « recevoir reçus et factures » dans ses proches.'
      using errcode = 'P0001', hint = 'payer';
  end if;
  update public.invoices i
     set payer_client_id = p_payer_client_id,
         payer_kind = case when p_payer_client_id = i.client_id then 'client' else 'relation' end
   where i.id = v.id;
end;
$$;

-- A merge keeps an organisation's invoices its own (FP-1).
create or replace function private.billing_reassign_client(p_old uuid, p_new uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_total int := 0;
  v_count int;
begin
  update public.invoices i set client_id = p_new,
         payer_client_id = case when i.payer_client_id = p_old then p_new else i.payer_client_id end,
         payer_kind = case when i.payer_kind = 'organisation' then 'organisation'
                           when (case when i.payer_client_id = p_old then p_new else i.payer_client_id end) = p_new then 'client' else i.payer_kind end
   where i.client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.invoices i set payer_client_id = p_new,
         payer_kind = case when i.client_id = p_new then 'client' else 'relation' end
   where i.payer_client_id = p_old and i.payer_kind <> 'organisation';
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  delete from public.billing_payer_defaults d
   where d.client_id = p_old
     and exists (select 1 from public.billing_payer_defaults k where k.client_id = p_new and k.effective_from = d.effective_from);
  update public.billing_payer_defaults d set client_id = p_new where d.client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.billing_payer_defaults d set payer_client_id = p_new where d.payer_client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  -- F2: payments, statements, the agreement (the kept dossier's own wins).
  update public.payments p set payer_client_id = p_new where p.payer_client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.statements s set client_id = p_new where s.client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.statements s set payer_client_id = p_new where s.payer_client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.special_agreements a set is_active = false, ended_at = pg_catalog.now()
   where a.client_id = p_old and a.is_active
     and exists (select 1 from public.special_agreements k where k.client_id = p_new and k.is_active);
  update public.special_agreements a set client_id = p_new where a.client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;

  -- F3: the cancellation-fee decisions.
  update public.cancellation_fee_decisions c set client_id = p_new where c.client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  -- FQ (20261013111236_billing_quickbooks): the QuickBooks matches and links, as lane B wrote them.
  update public.qbo_customer_matches m
     set candidate_client_ids = pg_catalog.array_replace(m.candidate_client_ids, p_old, p_new)
   where p_old = any (m.candidate_client_ids);
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.qbo_customer_matches m set client_id = p_new
   where m.client_id = p_old
     and not exists (select 1 from public.qbo_customer_matches k
                      where k.connection_id = m.connection_id and k.client_id = p_new and k.status = 'linked');
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.qbo_links l set payer_client_id = p_new
   where l.payer_client_id = p_old
     and not exists (select 1 from public.qbo_links k
                      where k.connection_id = l.connection_id and k.kind = l.kind and k.payer_client_id = p_new
                        and k.client_id is not distinct from (case when l.client_id = p_old then p_new else l.client_id end));
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.qbo_links l set client_id = p_new
   where l.client_id = p_old
     and not exists (select 1 from public.qbo_links k
                      where k.connection_id = l.connection_id and k.kind = 'dossier'
                        and k.payer_client_id = l.payer_client_id and k.client_id = p_new);
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  return v_total;
end;
$$;

-- A payer's payment: its receipt kept, not emailed (FP-6).
create or replace function private.billing_record_payment(
  p_org uuid, p_invoice_id uuid, p_mode_code text, p_amount_cents int, p_paid_on date, p_reference text,
  p_external_ref text, p_actor uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v public.invoices;
  v_today date := private.billing_today(p_org);
  v_paid_on date := coalesce(p_paid_on, v_today);
  v_reference text := nullif(pg_catalog.btrim(coalesce(p_reference, '')), '');
  v_year int := extract(year from v_today)::int;
  v_payment uuid;
  v_seq int;
  v_receipt uuid;
begin
  select i.* into v from public.invoices i where i.org_id = p_org and i.id = p_invoice_id for update;
  if v.id is null then
    raise exception 'Facture introuvable.' using errcode = 'P0001', hint = 'invoice_id';
  end if;
  -- The same reference twice (a webhook beside the job, a retry): the receipt already made.
  if p_external_ref is not null then
    select r.id into v_receipt
      from public.payments p join public.receipts r on r.payment_id = p.id
     where p.org_id = p_org and p.external_ref = p_external_ref;
    if v_receipt is not null then
      return v_receipt;
    end if;
  end if;
  if v.status <> 'issued' then
    raise exception 'Un paiement s''enregistre sur une facture finalisée, pas créditée.' using errcode = 'P0001', hint = 'status';
  end if;
  if not exists (select 1 from public.payment_modes m where m.org_id = p_org and m.code = p_mode_code and m.is_active and m.code <> 'credit_note') then
    raise exception 'Choisissez un mode de paiement.' using errcode = 'P0001', hint = 'mode';
  end if;
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > v.total_cents - v.paid_cents then
    raise exception 'Le montant va de 0,01 $ au solde de la facture (%).', private.billing_format_money(v.total_cents - v.paid_cents)
      using errcode = 'P0001', hint = 'amount';
  end if;
  if v_paid_on > v_today then
    raise exception 'La date du paiement ne peut pas être dans le futur.' using errcode = 'P0001', hint = 'paid_on';
  end if;
  if v_paid_on < v.issued_on - 365 then
    raise exception 'La date du paiement précède la facture de plus d''un an : vérifiez-la.' using errcode = 'P0001', hint = 'paid_on';
  end if;
  if v_reference is not null and pg_catalog.char_length(v_reference) > 100 then
    raise exception 'La référence compte 100 caractères au plus.' using errcode = 'P0001', hint = 'reference';
  end if;
  insert into public.payments (org_id, invoice_id, payer_client_id, mode_code, amount_cents, paid_on, reference, external_ref, created_by)
  values (p_org, v.id, v.payer_client_id, p_mode_code, p_amount_cents, v_paid_on, v_reference, p_external_ref, p_actor)
  returning id into v_payment;
  perform private.billing_apply_payments(v.id);
  perform private.billing_queue_sync(p_org, 'payment_recorded', v.id, v_payment);
  v_seq := private.billing_next_number(p_org, 'receipt', v_year);
  insert into public.receipts (org_id, payment_id, invoice_id, number, year, seq, issued_on, amount_cents)
  values (p_org, v_payment, v.id, 'R-' || v_year::text || '-' || v_seq::text, v_year, v_seq, v_today, p_amount_cents)
  returning id into v_receipt;
  -- FP-6: an organisation's payment gets its receipt, never emailed.
  perform private.billing_queue_delivery(p_org, 'receipt', v_receipt, v.payer_kind <> 'organisation', false, p_actor);
  return v_receipt;
end;
$$;

-- Crediting a client's invoice whose share is claimed waits for the payer's (FP-3).
create or replace function public.issue_credit_note(p_invoice_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  v public.invoices;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_today date := private.billing_today(v_org);
  v_year int := extract(year from v_today)::int;
  v_seq int;
  v_id uuid;
begin
  select i.* into v from public.invoices i where i.org_id = v_org and i.id = p_invoice_id for update;
  if v.id is null then
    raise exception 'Facture introuvable.' using errcode = 'P0001', hint = 'invoice_id';
  end if;
  if v.status <> 'issued' then
    raise exception 'Seule une facture finalisée, pas déjà créditée, reçoit une note de crédit.' using errcode = 'P0001', hint = 'status';
  end if;
  if v.paid_cents > 0 then
    raise exception 'Cette facture a des paiements : remboursez-les avant de la créditer.' using errcode = 'P0001', hint = 'payments';
  end if;
  -- FP-3: a session's share already claimed from its payer is credited there first.
  if exists (select 1 from public.invoice_lines s join public.invoice_lines c on c.source_line_id = s.id and not c.credited
              where s.invoice_id = v.id and s.line_type = 'payer_share') then
    raise exception 'La part du payeur de cette facture lui est déjà facturée : créditez d''abord la facture du payeur.'
      using errcode = 'P0001', hint = 'payer_claimed';
  end if;
  if v_reason is null or pg_catalog.char_length(v_reason) not between 3 and 500 then
    raise exception 'La raison de la note de crédit compte de 3 à 500 caractères.' using errcode = 'P0001', hint = 'reason';
  end if;
  v_seq := private.billing_next_number(v_org, 'credit_note', v_year);
  insert into public.credit_notes (org_id, invoice_id, number, year, seq, reason, issued_on, subtotal_cents, gst_cents, qst_cents, total_cents, created_by)
  values (v_org, v.id, 'NC-' || v_year::text || '-' || v_seq::text, v_year, v_seq, v_reason, v_today,
          v.subtotal_cents, v.gst_cents, v.qst_cents, v.total_cents, auth.uid())
  returning id into v_id;
  update public.invoice_lines l set credited = true where l.invoice_id = v.id;
  update public.invoices i set status = 'credited', credited_at = pg_catalog.now() where i.id = v.id;
  perform private.billing_queue_sync(v_org, 'invoice_credited', v.id, v_id);
  perform private.billing_queue_delivery(v_org, 'credit_note', v_id,
    exists (select 1 from public.billing_deliveries d where d.invoice_id = v.id and d.kind = 'invoice' and d.email_status = 'sent'),
    false, auth.uid());
  return v_id;
end;
$$;

-- Never an organisation's invoice on the client's card (FP-6).
create or replace function public.stripe_charges_due_for_service(p_org_id uuid, p_limit int default 100)
returns table (invoice_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id
    from public.invoices i
    join public.stripe_customers s on s.org_id = i.org_id and s.payer_client_id = i.payer_client_id and s.card_status = 'active'
   where i.org_id = p_org_id and i.status = 'issued' and i.total_cents - i.paid_cents > 0 and i.payer_kind <> 'organisation'
     and coalesce(i.finalized_at, i.issued_on::timestamptz) >= s.consent_at
     and i.issued_on >= private.billing_today(p_org_id) - 14
     and public.module_open_to_all_for_org(p_org_id, 'billing')
     and private.billing_stripe_configured(p_org_id)
     and not exists (select 1 from public.stripe_charges c where c.invoice_id = i.id and (c.kind = 'auto' or c.status = 'pending'))
   order by i.issued_on, i.number
   limit least(greatest(coalesce(p_limit, 100), 1), 500)
$$;

-- Never an organisation's invoice on the client's card (FP-6).
create or replace function public.begin_stripe_charge_for_service(p_org_id uuid, p_invoice_id uuid, p_kind text, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.invoices;
  s public.stripe_customers;
  c public.stripe_charges;
  v_id uuid;
begin
  if p_kind not in ('auto', 'manual') then
    raise exception 'Arguments invalides.' using errcode = '22023';
  end if;
  if p_kind = 'manual' and (p_actor is null or not ('billing.manage' = any (private.permission_keys_for(p_actor)))) then
    raise exception 'Permission refusée : billing.manage' using errcode = '42501';
  end if;
  select i.* into v from public.invoices i where i.org_id = p_org_id and i.id = p_invoice_id for update;
  update public.stripe_charges x
     set status = 'failed', failure_code = 'abandoned', finished_at = pg_catalog.now()
   where x.org_id = p_org_id and x.invoice_id = p_invoice_id and x.status = 'pending'
     and x.created_at < pg_catalog.now() - interval '24 hours';
  select x.* into s from private.billing_active_card(p_org_id, v.payer_client_id) x;
  select x.* into c from public.stripe_charges x where x.org_id = p_org_id and x.invoice_id = p_invoice_id and x.status = 'pending';
  if c.id is not null and s.payer_client_id is not null and v.payer_kind <> 'organisation' then
    return pg_catalog.jsonb_build_object(
      'charge_id', c.id, 'amount_cents', c.amount_cents, 'invoice_number', v.number, 'resume', true,
      'customer_id', s.stripe_customer_id, 'payment_method_id', s.payment_method_id,
      'clinic_name', (select coalesce(o.legal_name, o.name) from public.organizations o where o.id = p_org_id));
  end if;
  if v.id is null or v.status <> 'issued' or v.total_cents - v.paid_cents <= 0 or s.payer_client_id is null
     or v.payer_kind = 'organisation'
     or not private.billing_stripe_configured(p_org_id)
     or not public.module_open_to_all_for_org(p_org_id, 'billing')
     or coalesce(v.finalized_at, v.issued_on::timestamptz) < s.consent_at
     or (p_kind = 'auto' and exists (select 1 from public.stripe_charges x where x.invoice_id = v.id and x.kind = 'auto')) then
    if p_kind = 'manual' then
      raise exception 'Cette facture ne peut pas être prélevée : elle est payée, émise avant l''autorisation de la carte, sans carte au dossier, ou Facturation est réservé aux testeurs.'
        using errcode = 'P0001', hint = 'charge';
    end if;
    return null;
  end if;
  insert into public.stripe_charges (org_id, invoice_id, payer_client_id, kind, amount_cents, created_by)
  values (p_org_id, v.id, v.payer_client_id, p_kind, v.total_cents - v.paid_cents, p_actor)
  returning id into v_id;
  return pg_catalog.jsonb_build_object(
    'charge_id', v_id, 'amount_cents', v.total_cents - v.paid_cents, 'invoice_number', v.number, 'resume', false,
    'customer_id', s.stripe_customer_id, 'payment_method_id', s.payment_method_id,
    'clinic_name', (select coalesce(o.legal_name, o.name) from public.organizations o where o.id = p_org_id));
end;
$$;

-- No « Payer en ligne » for an organisation (FP-6).
create or replace function public.issue_billing_link_for_service(
  p_org_id uuid, p_purpose text, p_subject_id uuid, p_token_hash bytea, p_actor uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.invoices;
begin
  if p_purpose = 'billing_card_setup' then
    if p_actor is null or not ('billing.manage' = any (private.permission_keys_for(p_actor))) then
      raise exception 'Permission refusée : billing.manage' using errcode = '42501';
    end if;
    if not private.billing_stripe_configured(p_org_id)
       or not exists (select 1 from private.clients_billing_facts(p_org_id, array[p_subject_id]) f where f.found and not f.is_closed) then
      return false;
    end if;
    perform private.issue_secure_link(p_org_id, 'billing_card_setup', 'client', p_subject_id, p_token_hash, p_actor);
    return true;
  elsif p_purpose = 'billing_pay' then
    select i.* into v from public.invoices i where i.org_id = p_org_id and i.id = p_subject_id;
    if v.id is null or v.status <> 'issued' or v.total_cents - v.paid_cents <= 0
       or not private.billing_stripe_configured(p_org_id)
       or v.payer_kind = 'organisation'
       or exists (select 1 from private.billing_active_card(p_org_id, v.payer_client_id)) then
      return false;
    end if;
    perform private.issue_secure_link(p_org_id, 'billing_pay', 'invoice', v.id, p_token_hash, null);
    return true;
  end if;
  raise exception 'Usage de lien inconnu' using errcode = '22023';
end;
$$;

-- An organisation's invoice is never matched by itself to a transfer (FP-6).
create or replace function public.record_interac_notice_for_service(
  p_org_id uuid, p_source_ref text, p_received_on date, p_amount_cents int, p_sender_name text, p_message text, p_reference text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_only uuid[];
  v_receipt uuid;
begin
  if not public.module_enabled_for_org(p_org_id, 'billing') then
    return null;
  end if;
  insert into public.interac_notices (org_id, source, source_ref, received_on, amount_cents, sender_name, message, reference)
  values (p_org_id, 'gmail', p_source_ref, p_received_on, p_amount_cents, pg_catalog.left(pg_catalog.btrim(p_sender_name), 120),
          nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_message, '')), 500), ''),
          nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_reference, '')), 100), ''))
  on conflict (org_id, source, source_ref) do nothing
  returning id into v_id;
  if v_id is null then
    return null;
  end if;
  v_only := array(
    select i.id from public.invoices i
     cross join lateral private.clients_billing_facts(p_org_id, array[i.payer_client_id]) pf
     where i.org_id = p_org_id and i.status = 'issued' and i.total_cents - i.paid_cents = p_amount_cents
       and i.payer_kind <> 'organisation'
       and private.billing_name_score(p_sender_name, pf.first_name,
             pg_catalog.btrim(pg_catalog.substr(pf.display_name, pg_catalog.length(pf.first_name) + 1))) > 0
       and not exists (select 1 from public.stripe_charges c where c.invoice_id = i.id and c.status = 'pending')
       and not exists (select 1 from private.billing_active_card(p_org_id, i.payer_client_id))
     limit 2);
  if pg_catalog.cardinality(v_only) = 1 then
    begin
      v_receipt := private.billing_record_payment(p_org_id, v_only[1], 'interac', p_amount_cents,
                     least(p_received_on, private.billing_today(p_org_id)),
                     nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_reference, '')), 100), ''), 'interac:' || v_id::text, null);
      update public.interac_notices x
         set status = 'matched', invoice_id = v_only[1], matched_at = pg_catalog.now(),
             payment_id = (select r.payment_id from public.receipts r where r.id = v_receipt)
       where x.id = v_id;
    exception when sqlstate 'P0001' then
      -- Left « À rapprocher » for the adjointe.
      null;
    end;
  end if;
  return v_id;
end;
$$;

-- A transfer is never suggested for an organisation's invoice (FP-6).
create or replace function public.list_interac_notices(p_status text default 'to_match', p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.view');
begin
  if p_status not in ('to_match', 'matched', 'ignored') then
    raise exception 'État inconnu.' using errcode = 'P0001', hint = 'status';
  end if;
  return (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', n.id, 'source', n.source, 'received_on', n.received_on, 'amount_cents', n.amount_cents,
             'sender_name', n.sender_name, 'message', n.message, 'reference', n.reference, 'status', n.status,
             'invoice_id', n.invoice_id, 'invoice_number', (select i.number from public.invoices i where i.id = n.invoice_id),
             'matched_at', n.matched_at, 'ignored_reason', n.ignored_reason,
             'suggestions', case when n.status = 'to_match' then (
               select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                        'invoice_id', s.id, 'number', s.number, 'issued_on', s.issued_on,
                        'balance_cents', s.balance, 'payer_name', s.payer_name, 'client_name', s.client_name,
                        'amount_matches', s.balance = n.amount_cents, 'name_score', s.score)
                        order by (s.balance = n.amount_cents) desc, s.score desc, s.issued_on desc), '[]'::jsonb)
                 from (select i.id, i.number, i.issued_on, i.total_cents - i.paid_cents as balance,
                              pf.display_name as payer_name, cf.display_name as client_name,
                              private.billing_name_score(n.sender_name, pf.first_name,
                                pg_catalog.btrim(pg_catalog.substr(pf.display_name, pg_catalog.length(pf.first_name) + 1))) as score
                         from public.invoices i
                         cross join lateral private.clients_billing_facts(v_org, array[i.payer_client_id]) pf
                         cross join lateral private.clients_billing_facts(v_org, array[i.client_id]) cf
                        where i.org_id = v_org and i.status = 'issued' and i.total_cents - i.paid_cents > 0
                          and i.payer_kind <> 'organisation'
                          and (i.total_cents - i.paid_cents = n.amount_cents
                               or private.billing_name_score(n.sender_name, pf.first_name,
                                    pg_catalog.btrim(pg_catalog.substr(pf.display_name, pg_catalog.length(pf.first_name) + 1))) > 0)
                        order by (i.total_cents - i.paid_cents = n.amount_cents) desc, 7 desc, i.issued_on desc
                        limit 3) s) end)
             order by n.received_on desc, n.created_at desc), '[]'::jsonb)
      from (select x.* from public.interac_notices x where x.org_id = v_org and x.status = p_status
             order by x.received_on desc, x.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 300)) n
  );
end;
$$;

-- QuickBooks: an organisation's invoice says its payer (FP-7; lane B maps it).
create or replace function private.billing_invoice_for_sync(p_org uuid, p_invoice_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'id', i.id, 'number', i.number, 'status', i.status, 'issued_on', i.issued_on, 'due_on', i.due_on,
           'client_id', i.client_id, 'payer_client_id', i.payer_client_id, 'payer_kind', i.payer_kind, 'source_type', i.source_type,
           'payer_reference', i.payer_reference,
           'payer_organisation', (select pg_catalog.jsonb_build_object('id', o.id, 'kind', o.kind, 'name', o.name,
                                                                       'billing_email', o.billing_email)
                                    from public.payer_organisations o where o.id = i.payer_organisation_id),
           'tax_exempt', i.tax_exempt, 'gst_rate', i.gst_rate, 'qst_rate', i.qst_rate,
           'subtotal_cents', i.subtotal_cents, 'gst_cents', i.gst_cents, 'qst_cents', i.qst_cents, 'total_cents', i.total_cents,
           'lines', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                       'id', l.id, 'position', l.position, 'line_type', l.line_type, 'service_id', l.service_id, 'service_code', l.service_code,
                       'professional_id', l.professional_id, 'appointment_id', l.appointment_id, 'quantity', l.quantity,
                       'unit_price_cents', l.unit_price_cents, 'tax_rule', l.tax_rule, 'subtotal_cents', l.subtotal_cents,
                       'gst_cents', l.gst_cents, 'qst_cents', l.qst_cents, 'total_cents', l.total_cents) order by l.position)
                       from public.invoice_lines l where l.invoice_id = i.id), '[]'::jsonb),
           'credit_note', (select pg_catalog.jsonb_build_object('id', c.id, 'number', c.number, 'issued_on', c.issued_on,
                                    'subtotal_cents', c.subtotal_cents, 'gst_cents', c.gst_cents, 'qst_cents', c.qst_cents, 'total_cents', c.total_cents)
                             from public.credit_notes c where c.invoice_id = i.id))
    from public.invoices i where i.org_id = p_org and i.id = p_invoice_id
$$;

-- -----------------------------------------------------------------------------
-- RPCs: the organisations, the IVAC rate, a client's payers
-- -----------------------------------------------------------------------------
create function public.list_payer_organisations()
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
             'reminders_enabled', o.reminders_enabled, 'is_active', o.is_active, 'note', o.note)
             order by (o.kind = 'ivac') desc, o.is_active desc, pg_catalog.lower(o.name))
      from public.payer_organisations o where o.org_id = v_org), '[]'::jsonb);
end;
$$;

create function public.save_payer_organisation(
  p_id uuid, p_kind text, p_name text, p_billing_email text, p_contact_name text, p_language text, p_provider_number text,
  p_cadence text, p_due_days int, p_reminders_enabled boolean, p_is_active boolean, p_note text
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
                                            due_days, reminders_enabled, is_active, note, created_by)
    values (v_org, 'pae', v_name, v_email, v_contact, coalesce(p_language, 'fr'), v_provider, p_cadence, p_due_days,
            coalesce(p_reminders_enabled, false), coalesce(p_is_active, true), v_note, auth.uid())
    returning id into v_id;
    return v_id;
  end if;
  if o.kind = 'ivac' and not coalesce(p_is_active, true) then
    raise exception 'L''IVAC de la clinique reste active.' using errcode = 'P0001', hint = 'is_active';
  end if;
  update public.payer_organisations x
     set name = v_name, billing_email = v_email, contact_name = v_contact, language = coalesce(p_language, 'fr'),
         provider_number = v_provider, cadence = p_cadence, due_days = p_due_days,
         reminders_enabled = coalesce(p_reminders_enabled, false), is_active = coalesce(p_is_active, true), note = v_note
   where x.id = o.id;
  return o.id;
end;
$$;

-- The organisation a client's payer is billed to (null: the obvious one again).
create function public.set_client_payer_organisation(p_client_payer_id uuid, p_organisation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  t record;
  o public.payer_organisations;
begin
  select f.* into t from private.client_payer_facts(v_org, array[p_client_payer_id]) f;
  if t.client_payer_id is null or not t.is_active then
    raise exception 'Payeur introuvable.' using errcode = 'P0001', hint = 'client_payer_id';
  end if;
  if p_organisation_id is null then
    delete from public.client_payer_organisations c where c.client_payer_id = p_client_payer_id;
    return;
  end if;
  select x.* into o from public.payer_organisations x where x.org_id = v_org and x.id = p_organisation_id;
  if o.id is null or not o.is_active then
    raise exception 'Choisissez un organisme payeur actif.' using errcode = 'P0001', hint = 'organisation_id';
  end if;
  if o.kind <> t.kind then
    raise exception 'Un payeur IVAC se facture à l''IVAC, un PAE à un fournisseur de PAE.' using errcode = 'P0001', hint = 'organisation_id';
  end if;
  insert into public.client_payer_organisations (client_payer_id, org_id, organisation_id, created_by)
  values (p_client_payer_id, v_org, o.id, auth.uid())
  on conflict (client_payer_id) do update set organisation_id = excluded.organisation_id, created_by = excluded.created_by;
end;
$$;

create function public.get_payer_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.view');
begin
  return pg_catalog.jsonb_build_object(
    'ivac_rate_cents', private.billing_ivac_rate(v_org, private.billing_today(v_org)),
    'ivac_rates', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('effective_from', r.effective_from,
                                                                                      'session_cents', r.session_cents)
                                                       order by r.effective_from desc)
                              from public.billing_payer_rates r where r.org_id = v_org and r.kind = 'ivac'), '[]'::jsonb));
end;
$$;

-- What IVAC pays per session from a day (billing.settings): a new rate never rewrites the past.
create function public.set_ivac_rate(p_effective_from date, p_session_cents int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.settings');
begin
  if p_effective_from is null or p_effective_from < private.billing_today(v_org) - 31 then
    raise exception 'Le nouveau tarif commence au plus tôt il y a un mois.' using errcode = 'P0001', hint = 'effective_from';
  end if;
  if p_session_cents is null or p_session_cents not between 1 and 1000000 then
    raise exception 'Le montant par séance est compris entre 0,01 $ et 10 000 $.' using errcode = 'P0001', hint = 'session_cents';
  end if;
  insert into public.billing_payer_rates (org_id, kind, effective_from, session_cents, created_by)
  values (v_org, 'ivac', p_effective_from, p_session_cents, auth.uid())
  on conflict (org_id, kind, effective_from) do update set session_cents = excluded.session_cents, created_by = excluded.created_by;
end;
$$;

-- A client's payers as Facturation sees them (FP-8): the organisation billed, this year's use,
-- what is left, « Budget bas » (80 % used) and « Expiré », what is still to claim.
create function public.get_client_payers_billing(p_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.view');
  v_today date := private.billing_today(v_org);
begin
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'client_payer_id', t.client_payer_id, 'kind', t.kind, 'organisation_name', t.organisation_name,
             'file_number', t.file_number, 'is_stub', t.is_stub,
             'organisation', (select pg_catalog.jsonb_build_object('id', o.id, 'name', o.name, 'chosen', c.client_payer_id is not null,
                                                                   'billing_email', o.billing_email)
                                from public.payer_organisations o
                                left join public.client_payer_organisations c on c.client_payer_id = t.client_payer_id
                               where o.id = r.organisation_id),
             'period_from', p.period_from, 'period_to', p.period_to,
             'used_cents', u.amount_cents + case when t.prior_used_on between p.period_from and p.period_to then coalesce(t.prior_used_cents, 0) else 0 end,
             'used_sessions', u.sessions + case when t.prior_used_on between p.period_from and p.period_to then coalesce(t.prior_used_sessions, 0) else 0 end,
             'max_amount_cents', t.max_amount_cents, 'max_sessions', t.max_sessions,
             'expired', t.expires_on is not null and t.expires_on < v_today,
             'pending_cents', coalesce((select -pg_catalog.sum(l.total_cents)::int from public.invoice_lines l
                                         join public.invoices i on i.id = l.invoice_id
                                        where l.org_id = v_org and l.line_type = 'payer_share' and l.client_payer_id = t.client_payer_id
                                          and not l.credited and i.status = 'issued'
                                          and not exists (select 1 from public.invoice_lines x where x.source_line_id = l.id and not x.credited)), 0),
             'options', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', o.id, 'name', o.name) order by o.name)
                                    from public.payer_organisations o where o.org_id = v_org and o.kind = t.kind and o.is_active), '[]'::jsonb))
             || pg_catalog.jsonb_build_object('budget_low', t.max_amount_cents is not null
                  and (u.amount_cents + case when t.prior_used_on between p.period_from and p.period_to then coalesce(t.prior_used_cents, 0) else 0 end) * 5
                      >= t.max_amount_cents * 4)
             order by (t.kind = 'ivac') desc)
      from private.client_payers_of(v_org, p_client_id) t
     cross join lateral (select private.billing_payer_organisation(v_org, t.client_payer_id, t.kind, t.organisation_name) as organisation_id) r
     cross join lateral private.billing_payer_period(least(v_today, coalesce(t.expires_on, v_today)), t.renewal_month, t.renewal_day,
                                                     t.starts_on, t.expires_on) p
     cross join lateral private.billing_payer_consumed(v_org, t.client_payer_id, p.period_from, p.period_to, null) u), '[]'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs: « Payeurs » (FP-5)
-- -----------------------------------------------------------------------------
-- Per organisation: the shares still to claim, per client's payer (due now by its cadence, or
-- not yet), and the payer invoices drafted, waiting to be sent.
create function public.list_payer_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.view');
  v_today date := private.billing_today(v_org);
  v_month date := pg_catalog.date_trunc('month', v_today)::date;
begin
  return coalesce((
    with s as (
      select l.client_payer_id, l.payer_organisation_id, i.client_id, l.service_on, -l.total_cents as amount
        from public.invoice_lines l
        join public.invoices i on i.id = l.invoice_id
       where l.org_id = v_org and l.line_type = 'payer_share' and not l.credited and i.status = 'issued'
         and not exists (select 1 from public.invoice_lines c where c.source_line_id = l.id and not c.credited)
    ),
    g as (
      select s.payer_organisation_id, s.client_payer_id, s.client_id, pg_catalog.count(*)::int as sessions,
             pg_catalog.sum(s.amount)::int as total, pg_catalog.min(s.service_on) as oldest,
             pg_catalog.sum(s.amount) filter (where s.service_on < v_month)::int as before_month
        from s group by s.payer_organisation_id, s.client_payer_id, s.client_id
    ),
    gd as (
      select g.*, f.file_number, n.display_name, n.client_number,
             private.billing_payer_claim_until(o.cadence, f.max_amount_cents, g.total, g.before_month, p.period_to, v_today) as claim_until
        from g
        join public.payer_organisations o on o.id = g.payer_organisation_id
        cross join lateral (select x.* from private.client_payer_facts(v_org, array[g.client_payer_id]) x) f
        cross join lateral private.billing_payer_period(g.oldest, f.renewal_month, f.renewal_day, f.starts_on, f.expires_on) p
        left join lateral (select y.display_name, y.client_number from private.clients_display_names(v_org, array[g.client_id]) y) n on true
    )
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'organisation', pg_catalog.jsonb_build_object('id', o.id, 'kind', o.kind, 'name', o.name, 'cadence', o.cadence,
                                                           'billing_email', o.billing_email, 'is_active', o.is_active),
             'pending', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                           'client_payer_id', gd.client_payer_id, 'client_id', gd.client_id, 'client_name', gd.display_name,
                           'client_number', gd.client_number, 'file_number', gd.file_number, 'sessions', gd.sessions,
                           'amount_cents', gd.total, 'oldest', gd.oldest, 'due', gd.claim_until is not null)
                           order by (gd.claim_until is null), gd.display_name)
                           from gd where gd.payer_organisation_id = o.id), '[]'::jsonb),
             'drafts', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                          'id', i.id, 'client_id', i.client_id, 'client_name', n.display_name, 'payer_reference', i.payer_reference,
                          'total_cents', i.total_cents, 'lines', (select pg_catalog.count(*) from public.invoice_lines l where l.invoice_id = i.id),
                          'created_at', i.created_at) order by n.display_name)
                          from public.invoices i
                          left join lateral (select y.display_name from private.clients_display_names(v_org, array[i.client_id]) y) n on true
                         where i.org_id = v_org and i.status = 'draft' and i.payer_organisation_id = o.id), '[]'::jsonb),
             'unpaid', (select pg_catalog.jsonb_build_object('count', pg_catalog.count(*),
                                                             'balance_cents', coalesce(pg_catalog.sum(i.total_cents - i.paid_cents), 0))
                          from public.invoices i
                         where i.org_id = v_org and i.status = 'issued' and i.payer_organisation_id = o.id and i.total_cents > i.paid_cents))
             order by (o.kind = 'ivac') desc, pg_catalog.lower(o.name))
      from public.payer_organisations o
     where o.org_id = v_org
       and (o.is_active or exists (select 1 from gd where gd.payer_organisation_id = o.id))), '[]'::jsonb);
end;
$$;

-- « Préparer les factures » (due ones) or « Facturer les PAE » (`p_closing`: every share).
create function public.prepare_payer_invoices(p_organisation_id uuid default null, p_closing boolean default false)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
begin
  if p_organisation_id is not null and not exists (
       select 1 from public.payer_organisations o where o.org_id = v_org and o.id = p_organisation_id) then
    raise exception 'Organisme payeur introuvable.' using errcode = 'P0001', hint = 'organisation_id';
  end if;
  return private.billing_build_payer_invoices(v_org, p_organisation_id, coalesce(p_closing, false), auth.uid());
end;
$$;

-- A payer invoice by hand (a report billed to IVAC, FP-3): the draft of the client's payer.
create function public.create_payer_invoice(p_client_payer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  t record;
  v_organisation uuid;
begin
  select f.* into t from private.client_payer_facts(v_org, array[p_client_payer_id]) f;
  if t.client_payer_id is null or not t.is_active then
    raise exception 'Payeur introuvable.' using errcode = 'P0001', hint = 'client_payer_id';
  end if;
  if t.is_stub then
    raise exception 'Complétez d''abord ce payeur dans le dossier du client.' using errcode = 'P0001', hint = 'client_payer_id';
  end if;
  v_organisation := private.billing_payer_organisation(v_org, t.client_payer_id, t.kind, t.organisation_name);
  if v_organisation is null then
    raise exception 'Choisissez l''organisme payeur de ce PAE.' using errcode = 'P0001', hint = 'organisation_id';
  end if;
  return private.billing_payer_draft(v_org, t.client_payer_id, v_organisation, auth.uid());
end;
$$;

-- -----------------------------------------------------------------------------
-- The April closing (FP-5): after a PAE agreement's renewal, a reminder to invoice the year
-- -----------------------------------------------------------------------------
-- Daily. For each clinic, the unclaimed PAE shares of an agreement year that ended in the last
-- 14 days: `billing.manage` is told once per clinic and renewal day.
create function private.job_billing_payer_closing()
returns text
language plpgsql
set search_path = ''
as $$
declare
  r record;
  v_count int := 0;
begin
  for r in
    select x.org_id, x.period_to, pg_catalog.count(distinct x.client_payer_id)::int as payers,
           pg_catalog.sum(x.amount)::int as amount
      from (select l.org_id, l.client_payer_id, -l.total_cents as amount, p.period_to
              from public.invoice_lines l
              join public.invoices i on i.id = l.invoice_id
              join public.payer_organisations o on o.id = l.payer_organisation_id and o.kind = 'pae'
             cross join lateral (select f.* from private.client_payer_facts(l.org_id, array[l.client_payer_id]) f) f
             cross join lateral private.billing_payer_period(l.service_on, f.renewal_month, f.renewal_day, f.starts_on, f.expires_on) p
             where l.line_type = 'payer_share' and not l.credited and i.status = 'issued'
               and public.module_enabled_for_org(l.org_id, 'billing')
               and f.renewal_month is not null
               and not exists (select 1 from public.invoice_lines c where c.source_line_id = l.id and not c.credited)) x
     where private.billing_today(x.org_id) - x.period_to between 1 and 14
     group by x.org_id, x.period_to
  loop
    perform private.notify(r.org_id, 'billing', 'billing.payer_closing', 'important', 'Facturer les PAE',
      pg_catalog.left('L''année des ententes PAE s''est terminée le ' || private.format_date_fr(r.period_to) || ' : '
                      || r.payers || ' entente(s), ' || private.billing_format_money(r.amount)
                      || ' à facturer. Ouvrez « Payeurs », puis « Facturer les PAE ».', 500),
      '/facturation/payeurs', null, null, 'billing.manage', null,
      'billing.payer_closing:' || r.period_to::text, null);
    v_count := v_count + 1;
  end loop;
  return 'notices=' || v_count;
end;
$$;
revoke all on function private.job_billing_payer_closing() from public, anon, authenticated, service_role;

insert into public.scheduled_jobs
  (key, module_key, label, description, kind, sql_function, cron_job_name, is_maintenance)
values
  ('billing.payer_closing', 'billing', 'Fermeture de l''année des PAE',
   'Chaque jour : après la date de renouvellement des ententes PAE (le plus souvent le 31 mars), avise la facturation de facturer ce qui reste de l''année.',
   'sql', 'private.job_billing_payer_closing', 'billing.payer_closing', true)
on conflict do nothing;
select cron.schedule('billing.payer_closing', '20 11 * * *', $$select private.run_sql_job('billing.payer_closing')$$);

revoke all on function public.list_payer_organisations(), public.save_payer_organisation(uuid, text, text, text, text, text, text, text, int, boolean, boolean, text),
  public.set_client_payer_organisation(uuid, uuid), public.get_payer_settings(), public.set_ivac_rate(date, int),
  public.get_client_payers_billing(uuid), public.list_payer_queue(), public.prepare_payer_invoices(uuid, boolean),
  public.create_payer_invoice(uuid)
  from public, anon;
grant execute on function public.list_payer_organisations(), public.save_payer_organisation(uuid, text, text, text, text, text, text, text, int, boolean, boolean, text),
  public.set_client_payer_organisation(uuid, uuid), public.get_payer_settings(), public.set_ivac_rate(date, int),
  public.get_client_payers_billing(uuid), public.list_payer_queue(), public.prepare_payer_invoices(uuid, boolean),
  public.create_payer_invoice(uuid)
  to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);

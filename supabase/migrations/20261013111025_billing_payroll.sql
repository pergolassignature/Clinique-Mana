-- =============================================================================
-- Facturation, batch FPay: « Paie des professionnels » (periods, lines, rules, invoices, the job)
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §8 (FPay row, data model)
-- Answers:   docs/research/2026-10-12-christine-answers.md (9, 14, 17)
-- Decisions: FPay-1 … FPay-12 (decisions log), P4-151 (pay at the rate in force)
-- Recipe:    docs/standards/database-conventions.md §9
--
-- Every month, a summary per professional (`payout_periods`, one per professional and month) of
-- what the clinic owes her (`payout_lines`), which she validates in « Ma paie » before attaching
-- her invoice (`professional_invoices`, uploaded or generated); the administration then marks it
-- paid. The job `billing.payout_periods` builds the previous month's drafts on the 1st.
--
-- Rules (Christine 14; each service's rule is `payout_service_rules`, else its default):
--   session            every completed appointment, once: the client price of her primary
--                      title's grid for the session's duration, less her retention in force on
--                      its date (Professionnels' `professional_session_pay`, an « Entente
--                      particulière » first). IVAC and PAE sessions alike: the regular price,
--                      never what the third party pays. One line per appointment (a couple's
--                      session counts once).
--   late_cancellation  a late cancellation or absence fee the client PAID (F3's fee lines, read
--                      through `private.billing_paid_fees`, a stub until F3): the fee less the
--                      clinic's « Annulation tardive » retention, in the period being built when
--                      the payment is in (no waiting for a later month).
--   other_fees         a report, a discussion with another intervener (and a psychometric test):
--                      the issued invoice line's amount before taxes less the « Autres frais »
--                      retention (15 %); `workshop` alike with « Ateliers et conférences ».
--   none               never paid (file opening, discovery call, waitlist…).
-- The percentages are the clinic's dated rates (Professionnels → Paramètres → Rémunération),
-- never constants here.
--
-- Once (FPay-3): an appointment pays one session line and one fee line at most, an invoice
-- line one line, whatever the month, through unique indexes. A month's build also takes, for
-- the months the payroll already ran (three back at most), what was missed there (a session
-- completed late, a period already validated): it lands in the month being built, dated as it
-- happened. Months before the clinic's first period are never read (the GOrendezvous history
-- was paid by hand).
--
-- States (FPay-4): draft (built, staff only) → to_validate (sent to the professional) →
-- correction_requested (her note) → to_validate (sent again) → validated (by her, or by the
-- administration for her) → paid. The lock (FPay-5): a validated or paid period is frozen
-- (a trigger refuses any line write); only the administration reopens a validated one (with a
-- reason, its invoice detached); a paid one never.
--
-- Permissions: `billing.payroll` (new, admin) builds, sends, adjusts, reopens, pays and exports;
-- `billing.self` reads and validates her own periods; `billing.settings` sets the rules.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:billing_payroll', true);

-- -----------------------------------------------------------------------------
-- Registry
-- -----------------------------------------------------------------------------
insert into public.permissions (key, module_key, description) values
  ('billing.payroll', 'billing', 'Calculer, envoyer et verser la paie des professionnels')
on conflict do nothing;

insert into public.role_permissions (role, permission_key) values
  ('admin', 'billing.payroll')
on conflict do nothing;

-- The professional's invoice: uploaded by her (or by the administration for her), or generated.
insert into public.upload_purposes
  (key, module_key, bucket, upload_permission, view_permission, owner_permission, max_bytes, mime_types,
   max_image_side, retain_days)
values
  ('billing_professional_invoice', 'billing', 'documents', 'billing.self', 'billing.payroll', 'billing.self', 10485760,
   array['application/pdf', 'image/jpeg', 'image/png'], null, 1)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- payout_service_rules: a service's rule when it is not its default
-- -----------------------------------------------------------------------------
create table public.payout_service_rules (
  org_id uuid not null,
  service_id uuid not null,
  rule text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id) on delete set null,
  constraint payout_service_rules_pkey primary key (org_id, service_id),
  constraint payout_service_rules_service_fkey foreign key (org_id, service_id) references public.services (org_id, id),
  constraint payout_service_rules_rule_check check (rule in ('session', 'late_cancellation', 'other_fees', 'workshop', 'none'))
);
create index payout_service_rules_updated_by_idx on public.payout_service_rules (updated_by);
create trigger payout_service_rules_set_updated_at before update on public.payout_service_rules
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- payout_periods: one per professional and month
-- -----------------------------------------------------------------------------
create table public.payout_periods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  professional_id uuid not null,
  month date not null,
  state text not null default 'draft',
  title_name text,
  lines_count int not null default 0,
  unpriced_count int not null default 0,
  total_cents int not null default 0,
  built_at timestamptz not null default now(),
  built_by uuid references public.profiles(user_id) on delete set null,
  sent_at timestamptz,
  sent_by uuid references public.profiles(user_id) on delete set null,
  correction_note text,
  correction_requested_at timestamptz,
  validated_at timestamptz,
  validated_by uuid references public.profiles(user_id) on delete set null,
  reopen_reason text,
  paid_on date,
  paid_at timestamptz,
  paid_by uuid references public.profiles(user_id) on delete set null,
  payment_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payout_periods_org_id_id_key unique (org_id, id),
  constraint payout_periods_professional_month_key unique (org_id, professional_id, month),
  constraint payout_periods_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id),
  constraint payout_periods_month_check check (month = pg_catalog.date_trunc('month', month)::date
                                               and month >= date '2020-01-01' and month < date '2100-01-01'),
  constraint payout_periods_state_check check (state in ('draft', 'to_validate', 'correction_requested', 'validated', 'paid')),
  constraint payout_periods_counts_check check (lines_count >= 0 and unpriced_count between 0 and lines_count),
  constraint payout_periods_validated_check check ((state in ('validated', 'paid')) = (validated_at is not null)),
  constraint payout_periods_paid_check check ((state = 'paid') = (paid_at is not null) and (paid_at is null) = (paid_on is null)),
  constraint payout_periods_text_check check (
    (correction_note is null or char_length(correction_note) between 3 and 2000)
    and (reopen_reason is null or char_length(reopen_reason) between 3 and 500)
    and (payment_note is null or char_length(payment_note) between 1 and 500)
    and (title_name is null or char_length(title_name) <= 200))
);
create index payout_periods_org_month_idx on public.payout_periods (org_id, month, state);
create index payout_periods_org_professional_idx on public.payout_periods (org_id, professional_id, month desc);
create index payout_periods_built_by_idx on public.payout_periods (built_by);
create index payout_periods_sent_by_idx on public.payout_periods (sent_by);
create index payout_periods_validated_by_idx on public.payout_periods (validated_by);
create index payout_periods_paid_by_idx on public.payout_periods (paid_by);
create trigger payout_periods_set_updated_at before update on public.payout_periods
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- payout_lines: what a period pays
-- -----------------------------------------------------------------------------
-- amount_cents null: « À compléter » (no grid, no rate…; `pricing` says why): the period cannot
-- be sent until it is fixed in Professionnels and recalculated. An adjustment is the
-- administration's (an amount, maybe negative, and a note).
create table public.payout_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  period_id uuid not null,
  kind text not null,
  appointment_id uuid,
  invoice_line_id uuid,
  client_id uuid,
  service_id uuid,
  occurred_on date not null,
  paid_on date,
  duration smallint,
  base_cents int,
  retention_pct numeric(5, 2),
  amount_cents int,
  pricing text not null,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  constraint payout_lines_period_fkey foreign key (org_id, period_id) references public.payout_periods (org_id, id) on delete cascade,
  constraint payout_lines_appointment_fkey foreign key (org_id, appointment_id) references public.appointments (org_id, id),
  constraint payout_lines_invoice_line_fkey foreign key (invoice_line_id) references public.invoice_lines (id),
  constraint payout_lines_client_fkey foreign key (org_id, client_id) references public.clients (org_id, id),
  constraint payout_lines_service_fkey foreign key (org_id, service_id) references public.services (org_id, id),
  constraint payout_lines_kind_check check (kind in ('session', 'late_cancellation', 'other_fees', 'workshop', 'adjustment')),
  constraint payout_lines_pricing_check check (pricing in ('grid', 'agreement', 'rate', 'manual',
                                                           'no_title', 'no_price', 'no_rate')),
  constraint payout_lines_source_check check (
    case kind
      when 'session' then appointment_id is not null and invoice_line_id is null
      when 'late_cancellation' then appointment_id is not null and invoice_line_id is null
      when 'adjustment' then appointment_id is null and invoice_line_id is null and note is not null
                             and pricing = 'manual' and amount_cents is not null
      else invoice_line_id is not null
    end),
  constraint payout_lines_priced_check check ((amount_cents is null) = (pricing in ('no_title', 'no_price', 'no_rate'))),
  constraint payout_lines_amounts_check check (
    (base_cents is null or base_cents between 0 and 10000000)
    and (amount_cents is null or amount_cents between -10000000 and 10000000)
    and (retention_pct is null or retention_pct between 0 and 100)),
  constraint payout_lines_duration_check check (duration is null or duration in (30, 50, 60)),
  constraint payout_lines_note_check check (note is null or (char_length(note) between 3 and 500 and private.is_tidy_text(note)))
);
create index payout_lines_org_period_idx on public.payout_lines (org_id, period_id, occurred_on);
create index payout_lines_org_appointment_idx on public.payout_lines (org_id, appointment_id);
create index payout_lines_org_client_idx on public.payout_lines (org_id, client_id);
create index payout_lines_org_service_idx on public.payout_lines (org_id, service_id);
create index payout_lines_created_by_idx on public.payout_lines (created_by);
-- Once, whatever the month (FPay-3).
create unique index payout_lines_appointment_once_idx on public.payout_lines (appointment_id, kind)
  where appointment_id is not null;
create unique index payout_lines_invoice_line_once_idx on public.payout_lines (invoice_line_id)
  where invoice_line_id is not null;

-- -----------------------------------------------------------------------------
-- professional_invoices: the professional's invoice for a period
-- -----------------------------------------------------------------------------
create table public.professional_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  period_id uuid not null,
  source text not null,
  file_id uuid not null,
  number text not null,
  issued_on date not null,
  amount_cents int not null,
  qbo_bill_id text,
  exported_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  constraint professional_invoices_period_key unique (period_id),
  constraint professional_invoices_period_fkey foreign key (org_id, period_id) references public.payout_periods (org_id, id) on delete cascade,
  constraint professional_invoices_file_fkey foreign key (file_id) references public.stored_files (id),
  constraint professional_invoices_source_check check (source in ('uploaded', 'generated')),
  constraint professional_invoices_number_check check (char_length(number) between 1 and 40 and private.is_tidy_text(number)),
  constraint professional_invoices_qbo_check check (qbo_bill_id is null or char_length(qbo_bill_id) between 1 and 64)
);
create index professional_invoices_org_idx on public.professional_invoices (org_id);
create index professional_invoices_file_idx on public.professional_invoices (file_id);
create index professional_invoices_created_by_idx on public.professional_invoices (created_by);

-- -----------------------------------------------------------------------------
-- RLS, grants (select only; every write is an RPC), audit
-- -----------------------------------------------------------------------------
alter table public.payout_service_rules enable row level security;
alter table public.payout_periods enable row level security;
alter table public.payout_lines enable row level security;
alter table public.professional_invoices enable row level security;

revoke all on public.payout_service_rules, public.payout_periods, public.payout_lines, public.professional_invoices
  from anon, authenticated;
grant select on public.payout_service_rules, public.payout_periods, public.payout_lines, public.professional_invoices
  to authenticated;

create policy payout_service_rules_select on public.payout_service_rules
  for select to authenticated
  using (org_id = (select private.current_user_org_id())
         and ((select private.has_permission('billing.settings')) or (select private.has_permission('billing.payroll'))));
-- The administration: every period; the professional: hers, once sent (never a draft).
create policy payout_periods_select on public.payout_periods
  for select to authenticated
  using (org_id = (select private.current_user_org_id())
         and ((select private.has_permission('billing.payroll'))
              or ((select private.has_permission('billing.self'))
                  and professional_id = (select private.current_professional_id())
                  and state <> 'draft')));
create policy payout_lines_select on public.payout_lines
  for select to authenticated
  using (org_id = (select private.current_user_org_id())
         and ((select private.has_permission('billing.payroll'))
              or ((select private.has_permission('billing.self'))
                  and period_id in (select p.id from public.payout_periods p
                                     where p.professional_id = (select private.current_professional_id())
                                       and p.state <> 'draft'))));
create policy professional_invoices_select on public.professional_invoices
  for select to authenticated
  using (org_id = (select private.current_user_org_id())
         and ((select private.has_permission('billing.payroll'))
              or ((select private.has_permission('billing.self'))
                  and period_id in (select p.id from public.payout_periods p
                                     where p.professional_id = (select private.current_professional_id())))));

create trigger payout_service_rules_audit after insert or update or delete on public.payout_service_rules
  for each row execute function private.audit_trigger();
create trigger payout_periods_audit after insert or update or delete on public.payout_periods
  for each row execute function private.audit_trigger('correction_note', 'reopen_reason', 'payment_note');
create trigger payout_lines_audit after insert or update or delete on public.payout_lines
  for each row execute function private.audit_trigger('note');
create trigger professional_invoices_audit after insert or update or delete on public.professional_invoices
  for each row execute function private.audit_trigger();

-- The lock (FPay-5): a validated or paid period's lines never change.
create function private.payout_lines_locked()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_state text;
begin
  select p.state into v_state from public.payout_periods p
   where p.id = case when tg_op = 'DELETE' then old.period_id else new.period_id end;
  if v_state in ('validated', 'paid') then
    raise exception 'Cette période de paie est verrouillée.' using errcode = 'P0001', hint = 'locked';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function private.payout_lines_locked() from public, anon, authenticated, service_role;
create trigger payout_lines_lock before insert or update or delete on public.payout_lines
  for each row execute function private.payout_lines_locked();

-- -----------------------------------------------------------------------------
-- F3's paid cancellation fees: a stub until F3 replaces it (create or replace)
-- -----------------------------------------------------------------------------
-- One row per late cancellation or absence fee the professional chose to charge (R-59) and the
-- client paid in full before p_paid_before: its appointment, professional, service, amount
-- before taxes and when it was paid. Until F3, none.
create function private.billing_paid_fees(p_org uuid, p_paid_before timestamptz)
returns table (appointment_id uuid, professional_id uuid, service_id uuid, amount_cents int, paid_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select null::uuid, null::uuid, null::uuid, null::int, null::timestamptz where false
$$;
revoke all on function private.billing_paid_fees(uuid, timestamptz) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Helpers (private, granted to no role)
-- -----------------------------------------------------------------------------
create function private.payroll_tz(p_org uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce((select o.timezone from public.organizations o where o.id = p_org), 'America/Toronto')
$$;

-- « novembre 2026 »
create function private.payroll_month_label(p_month date)
returns text
language sql
immutable
set search_path = ''
as $$
  select (array['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre',
                'octobre', 'novembre', 'décembre'])[pg_catalog.date_part('month', p_month)::int]
         || ' ' || pg_catalog.date_part('year', p_month)::int::text
$$;

-- A service's rule by default: sessions at the grid, workshops at their rate, the two late
-- cancellation fees, reports, discussions and tests at « Autres frais »; nothing else.
create function private.payroll_default_rule(p_kind text, p_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p_kind = 'session' then 'session'
           when p_kind = 'workshop' then 'workshop'
           when p_key in ('late_cancellation_individual', 'late_cancellation_couple_family') then 'late_cancellation'
           when p_key in ('report_writing', 'case_discussion', 'psychometric_test') then 'other_fees'
           else 'none'
         end
$$;

-- Every service of the clinic with its rule (the override, else the default).
create function private.payroll_rules(p_org uuid)
returns table (service_id uuid, code int, name text, kind text, duration_minutes int, grid_duration int,
               is_active boolean, family_code int, family_name text, sort_order int, rule text, is_default boolean)
language sql
stable
set search_path = ''
as $$
  select f.service_id, f.code, f.name, f.kind, f.duration_minutes, f.grid_duration, f.is_active,
         f.family_code, f.family_name, f.sort_order,
         coalesce(r.rule, private.payroll_default_rule(f.kind, f.key)), r.rule is null
    from private.service_payout_facts(p_org, null) f
    left join public.payout_service_rules r on r.org_id = p_org and r.service_id = f.service_id
$$;

-- The period of a caller who may act on it: the administration (billing.payroll) on every one,
-- the professional (billing.self) on hers once sent. Locked FOR UPDATE. 42501, or « introuvable ».
create function private.payroll_period_for(p_id uuid, p_actor uuid, p_staff_only boolean)
returns public.payout_periods
language plpgsql
set search_path = ''
as $$
declare
  v public.payout_periods;
  v_keys text[] := private.permission_keys_for(p_actor);
  v_org uuid := (select p.org_id from public.profiles p where p.user_id = p_actor);
  v_staff boolean := 'billing.payroll' = any (v_keys);
begin
  if not v_staff and (p_staff_only or not ('billing.self' = any (v_keys))) then
    raise exception 'Permission refusée : billing.payroll' using errcode = '42501';
  end if;
  select x.* into v from public.payout_periods x where x.org_id = v_org and x.id = p_id for update;
  if v.id is null
     or (not v_staff and (v.state = 'draft'
                          or v.professional_id is distinct from private.professional_for_profile(v_org, p_actor))) then
    raise exception 'Période de paie introuvable.' using errcode = 'P0001', hint = 'period_id';
  end if;
  return v;
end;
$$;

-- The period's counts and total from its lines.
create function private.payroll_refresh_totals(p_period uuid)
returns void
language sql
set search_path = ''
as $$
  update public.payout_periods p
     set lines_count = s.n, unpriced_count = s.unpriced, total_cents = s.total
    from (select count(*)::int as n, count(*) filter (where l.amount_cents is null)::int as unpriced,
                 coalesce(sum(l.amount_cents), 0)::int as total
            from public.payout_lines l where l.period_id = p_period) s
   where p.id = p_period
$$;

-- Builds (or rebuilds) p_month for the clinic: see the header. Open periods (draft, to_validate,
-- correction_requested) lose their computed lines and are filled again; an adjustment stays; a
-- validated or paid one is left alone and what is new for its professional waits for the next
-- month's build. A period left with no line is removed. p_professional narrows the build to one
-- professional (« Recalculer »). Returns {created, rebuilt, removed, locked}.
create function private.payroll_build(p_org uuid, p_month date, p_actor uuid, p_professional uuid default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tz text := private.payroll_tz(p_org);
  v_first date;
  v_low date;
  v_from timestamptz;
  v_to timestamptz;
  v_low_ts timestamptz;
  v_created int;
  v_removed int;
  v_locked int;
  v_rebuilt int;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('billing.payroll:' || p_org::text, 0));
  v_from := p_month::timestamp at time zone v_tz;
  v_to := (p_month + interval '1 month')::timestamp at time zone v_tz;
  -- Months already run, three back at most, never before the clinic's first period.
  select min(p.month) into v_first from public.payout_periods p where p.org_id = p_org;
  v_low := case when v_first is null or v_first >= p_month then p_month
                else greatest(v_first, (p_month - interval '3 months')::date) end;
  v_low_ts := v_low::timestamp at time zone v_tz;

  -- The open periods' computed lines go; adjustments stay.
  delete from public.payout_lines l
   using public.payout_periods p
   where p.id = l.period_id and p.org_id = p_org and p.month = p_month
     and p.state in ('draft', 'to_validate', 'correction_requested')
     and (p_professional is null or p.professional_id = p_professional)
     and l.kind <> 'adjustment';

  -- The candidates of this build (dropped at commit; a second build in one transaction reuses it).
  if pg_catalog.to_regclass('pg_temp.payroll_candidates') is null then
    create temporary table payroll_candidates (
      professional_id uuid, kind text, appointment_id uuid, invoice_line_id uuid, client_id uuid, service_id uuid,
      occurred_on date, paid_on date, duration smallint, base_cents int, retention_pct numeric, amount_cents int, pricing text
    ) on commit drop;
  end if;
  truncate pg_temp.payroll_candidates;

  -- Sessions: completed, one line per appointment (its first client).
  insert into pg_temp.payroll_candidates
  with s as (
    select distinct on (b.appointment_id) b.appointment_id, b.professional_id, b.service_id, b.client_id,
           (b.starts_at at time zone v_tz)::date as on_date
      from private.appointments_for_billing(p_org, v_low_ts, v_to) b
     where b.state = 'completed' and (p_professional is null or b.professional_id = p_professional)
     order by b.appointment_id, (b.role = 'second'), b.client_id
  ),
  r as (select * from private.payroll_rules(p_org))
  select s.professional_id, 'session', s.appointment_id, null, s.client_id, s.service_id, s.on_date, null,
         d.duration, x.client_price_cents, x.retention_pct, x.pay_cents,
         case when d.duration is null then 'no_price' else coalesce(x.source, 'no_price') end
    from s
    join r on r.service_id = s.service_id and r.rule = 'session'
    cross join lateral (select case when coalesce(r.grid_duration, r.duration_minutes) in (30, 50, 60)
                                    then coalesce(r.grid_duration, r.duration_minutes)::smallint end as duration) d
    left join lateral private.professional_session_pay(p_org, s.professional_id, s.client_id, d.duration, s.on_date) x
      on d.duration is not null
   where not exists (select 1 from public.payout_lines l where l.appointment_id = s.appointment_id and l.kind = 'session');

  -- Paid cancellation fees (F3), whenever the appointment, once paid before the month's end.
  insert into pg_temp.payroll_candidates
  select f.professional_id, 'late_cancellation', f.appointment_id, null, b.client_id, f.service_id,
         coalesce(b.on_date, (f.paid_at at time zone v_tz)::date), (f.paid_at at time zone v_tz)::date, null,
         f.amount_cents, k.pct,
         case when k.pct is null then null else private.retention_pay_cents(f.amount_cents, k.pct) end,
         case when k.pct is null then 'no_rate' else 'rate' end
    from private.billing_paid_fees(p_org, v_to) f
    left join lateral (
      select (x.starts_at at time zone v_tz)::date as on_date, x.client_ids[1] as client_id
        from private.appointment_billing_facts(p_org, array[f.appointment_id]) x) b on true
    cross join lateral (
      select private.professional_compensation_rate(p_org, 'late_cancellation', (f.paid_at at time zone v_tz)::date) as pct) k
   where (p_professional is null or f.professional_id = p_professional)
     and coalesce(b.on_date, (f.paid_at at time zone v_tz)::date) >= v_low
     and not exists (select 1 from public.payout_lines l where l.appointment_id = f.appointment_id and l.kind = 'late_cancellation');

  -- Reports, discussions, workshops: issued invoice lines naming the professional.
  insert into pg_temp.payroll_candidates
  select l.professional_id, r.rule, null, l.id, i.client_id, l.service_id, i.issued_on, null, null,
         l.subtotal_cents, k.pct,
         case when k.pct is null then null else private.retention_pay_cents(l.subtotal_cents, k.pct) end,
         case when k.pct is null then 'no_rate' else 'rate' end
    from public.invoice_lines l
    join public.invoices i on i.org_id = l.org_id and i.id = l.invoice_id
    join private.payroll_rules(p_org) r on r.service_id = l.service_id and r.rule in ('other_fees', 'workshop')
    cross join lateral (select private.professional_compensation_rate(p_org, r.rule, i.issued_on) as pct) k
   where l.org_id = p_org and i.status = 'issued' and not l.credited and l.professional_id is not null
     and i.issued_on >= v_low and i.issued_on < (p_month + interval '1 month')::date
     and (p_professional is null or l.professional_id = p_professional)
     and not exists (select 1 from public.payout_lines x where x.invoice_line_id = l.id);

  -- A period per professional with something to pay, unless hers is locked.
  with ins as (
    insert into public.payout_periods (org_id, professional_id, month, built_by)
    select distinct p_org, c.professional_id, p_month, p_actor from pg_temp.payroll_candidates c
    on conflict (org_id, professional_id, month) do nothing
    returning 1)
  select count(*) into v_created from ins;

  -- A summary already sent and recalculated goes back to the administration (« Brouillon »)
  -- until it is sent again.
  update public.payout_periods p
     set built_at = pg_catalog.now(), built_by = p_actor,
         state = case when p.state = 'to_validate' then 'draft' else p.state end,
         title_name = (select f.title_name from private.professional_payout_facts(p_org, array[p.professional_id]) f)
   where p.org_id = p_org and p.month = p_month and p.state in ('draft', 'to_validate', 'correction_requested')
     and (p_professional is null or p.professional_id = p_professional);

  insert into public.payout_lines (org_id, period_id, kind, appointment_id, invoice_line_id, client_id, service_id,
                                   occurred_on, paid_on, duration, base_cents, retention_pct, amount_cents, pricing, created_by)
  select p_org, p.id, c.kind, c.appointment_id, c.invoice_line_id, c.client_id, c.service_id,
         c.occurred_on, c.paid_on, c.duration, c.base_cents, c.retention_pct,
         case when c.pricing in ('no_title', 'no_price', 'no_rate') then null else c.amount_cents end,
         c.pricing, p_actor
    from pg_temp.payroll_candidates c
    join public.payout_periods p on p.org_id = p_org and p.professional_id = c.professional_id and p.month = p_month
   where p.state in ('draft', 'to_validate', 'correction_requested');

  select count(*) into v_locked from public.payout_periods p
   where p.org_id = p_org and p.month = p_month and p.state in ('validated', 'paid')
     and (p_professional is null or p.professional_id = p_professional);

  -- Empty open periods go.
  with gone as (
    delete from public.payout_periods p
     where p.org_id = p_org and p.month = p_month and p.state in ('draft', 'to_validate', 'correction_requested')
       and (p_professional is null or p.professional_id = p_professional)
       and not exists (select 1 from public.payout_lines l where l.period_id = p.id)
    returning 1)
  select count(*) into v_removed from gone;

  perform private.payroll_refresh_totals(p.id) from public.payout_periods p
   where p.org_id = p_org and p.month = p_month and p.state in ('draft', 'to_validate', 'correction_requested')
     and (p_professional is null or p.professional_id = p_professional);

  select count(*) into v_rebuilt from public.payout_periods p
   where p.org_id = p_org and p.month = p_month and p.state in ('draft', 'to_validate', 'correction_requested')
     and (p_professional is null or p.professional_id = p_professional);
  return pg_catalog.jsonb_build_object('created', v_created, 'rebuilt', v_rebuilt - v_created,
                                       'removed', v_removed, 'locked', v_locked);
end;
$$;

-- The notice to the professional that a summary waits for her (her account only).
create function private.payroll_notify_professional(p_period public.payout_periods, p_kind text, p_title text, p_body text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_profile uuid := private.professional_profile_id(p_period.org_id, p_period.professional_id);
begin
  if v_profile is null
     or not exists (select 1 from public.profiles p where p.user_id = v_profile and p.status = 'active') then
    return;
  end if;
  perform private.notify(p_period.org_id, 'billing', p_kind, 'normal', p_title, p_body,
                         '/ma-paie/' || p_period.id::text, 'payout_period', p_period.id, 'billing.self', v_profile,
                         null, null);
end;
$$;

revoke all on function private.payroll_tz(uuid), private.payroll_month_label(date), private.payroll_default_rule(text, text),
  private.payroll_rules(uuid), private.payroll_period_for(uuid, uuid, boolean), private.payroll_refresh_totals(uuid),
  private.payroll_build(uuid, date, uuid, uuid),
  private.payroll_notify_professional(public.payout_periods, text, text, text)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RPCs: the administration (billing.payroll)
-- -----------------------------------------------------------------------------
-- A month's periods, with each professional's name, specialty and invoice.
create function public.list_payout_periods(p_month date)
returns table (
  id uuid, professional_id uuid, professional_name text, title_name text, state text, lines_count int,
  unpriced_count int, total_cents int, built_at timestamptz, sent_at timestamptz, correction_note text,
  validated_at timestamptz, paid_on date, invoice_number text, invoice_source text, invoice_file_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.payroll');
begin
  if p_month is null or p_month <> pg_catalog.date_trunc('month', p_month)::date then
    raise exception 'Choisissez un mois.' using errcode = 'P0001', hint = 'month';
  end if;
  return query
    select p.id, p.professional_id, n.display_name, p.title_name, p.state, p.lines_count, p.unpriced_count, p.total_cents,
           p.built_at, p.sent_at, p.correction_note, p.validated_at, p.paid_on, i.number, i.source, i.file_id
      from public.payout_periods p
      left join private.professional_display_names(v_org, (select coalesce(pg_catalog.array_agg(x.professional_id), '{}')
                                                             from public.payout_periods x
                                                            where x.org_id = v_org and x.month = p_month)) n
        on n.professional_id = p.professional_id
      left join public.professional_invoices i on i.period_id = p.id
     where p.org_id = v_org and p.month = p_month
     order by n.display_name, p.id;
end;
$$;

-- « Calculer le mois »: builds or rebuilds a finished month (see private.payroll_build).
create function public.build_payout_month(p_month date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.payroll');
  v_tz text;
begin
  v_tz := private.payroll_tz(v_org);
  if p_month is null or p_month <> pg_catalog.date_trunc('month', p_month)::date or p_month < date '2020-01-01' then
    raise exception 'Choisissez un mois.' using errcode = 'P0001', hint = 'month';
  end if;
  if p_month >= pg_catalog.date_trunc('month', (pg_catalog.now() at time zone v_tz))::date then
    raise exception 'Le mois n''est pas terminé : la paie se calcule à partir du 1er du mois suivant.'
      using errcode = 'P0001', hint = 'month';
  end if;
  return private.payroll_build(v_org, p_month, auth.uid());
end;
$$;

-- « Recalculer » one open period.
create function public.rebuild_payout_period(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payout_periods := private.payroll_period_for(p_id, auth.uid(), true);
begin
  if v.state not in ('draft', 'to_validate', 'correction_requested') then
    raise exception 'Cette période de paie est verrouillée.' using errcode = 'P0001', hint = 'locked';
  end if;
  return private.payroll_build(v.org_id, v.month, auth.uid(), v.professional_id);
end;
$$;

-- « Envoyer au professionnel »: drafts and corrected periods become « À valider » and the
-- professional is told. A period with a line to complete is left as is. Returns {sent, unpriced}.
create function public.send_payout_periods(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.payroll');
  v public.payout_periods;
  v_count int := 0;
  v_unpriced int := 0;
begin
  if p_ids is null or pg_catalog.cardinality(p_ids) = 0 or pg_catalog.cardinality(p_ids) > 500 then
    raise exception 'Choisissez les périodes à envoyer.' using errcode = 'P0001', hint = 'period_ids';
  end if;
  for v in select p.* from public.payout_periods p where p.org_id = v_org and p.id = any (p_ids) order by p.id for update loop
    if v.state not in ('draft', 'correction_requested') then
      continue;
    end if;
    if v.unpriced_count > 0 then
      v_unpriced := v_unpriced + 1;
      continue;
    end if;
    update public.payout_periods p
       set state = 'to_validate', sent_at = pg_catalog.now(), sent_by = auth.uid()
     where p.id = v.id;
    perform private.payroll_notify_professional(v, 'billing.payout_ready',
      'Sommaire de paie à valider',
      'Votre sommaire de ' || private.payroll_month_label(v.month) || ' est prêt : vérifiez-le et validez-le dans « Ma paie ».');
    v_count := v_count + 1;
  end loop;
  return pg_catalog.jsonb_build_object('sent', v_count, 'unpriced', v_unpriced);
end;
$$;

-- An adjustment line (an amount, maybe negative, and a note) on an open period.
create function public.add_payout_adjustment(p_period_id uuid, p_amount_cents int, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payout_periods := private.payroll_period_for(p_period_id, auth.uid(), true);
  v_note text := pg_catalog.btrim(p_note);
  v_id uuid;
begin
  if v.state not in ('draft', 'to_validate', 'correction_requested') then
    raise exception 'Cette période de paie est verrouillée.' using errcode = 'P0001', hint = 'locked';
  end if;
  if p_amount_cents is null or p_amount_cents = 0 or p_amount_cents not between -10000000 and 10000000 then
    raise exception 'Le montant de l''ajustement est requis.' using errcode = 'P0001', hint = 'amount_cents';
  end if;
  if v_note is null or char_length(v_note) < 3 or char_length(v_note) > 500 or not private.is_tidy_text(v_note) then
    raise exception 'Expliquez l''ajustement (3 à 500 caractères).' using errcode = 'P0001', hint = 'note';
  end if;
  insert into public.payout_lines (org_id, period_id, kind, occurred_on, amount_cents, pricing, note, created_by)
  values (v.org_id, v.id, 'adjustment', (v.month + interval '1 month' - interval '1 day')::date, p_amount_cents, 'manual',
          v_note, auth.uid())
  returning id into v_id;
  perform private.payroll_refresh_totals(v.id);
  return v_id;
end;
$$;

create function public.remove_payout_adjustment(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.payroll');
  v_period uuid;
  v public.payout_periods;
begin
  select l.period_id into v_period from public.payout_lines l
   where l.org_id = v_org and l.id = p_line_id and l.kind = 'adjustment';
  if v_period is null then
    raise exception 'Ajustement introuvable.' using errcode = 'P0001', hint = 'line_id';
  end if;
  v := private.payroll_period_for(v_period, auth.uid(), true);
  delete from public.payout_lines l where l.id = p_line_id;
  perform private.payroll_refresh_totals(v.id);
end;
$$;

-- « Rouvrir » a validated period (never a paid one): back to « À valider », its invoice detached.
create function public.reopen_payout_period(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payout_periods := private.payroll_period_for(p_id, auth.uid(), true);
  v_reason text := pg_catalog.btrim(p_reason);
begin
  if v.state <> 'validated' then
    raise exception 'Seule une période validée et non versée se rouvre.' using errcode = 'P0001', hint = 'state';
  end if;
  if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'Indiquez la raison (3 à 500 caractères).' using errcode = 'P0001', hint = 'reason';
  end if;
  delete from public.professional_invoices i where i.period_id = v.id;
  update public.payout_periods p
     set state = 'to_validate', validated_at = null, validated_by = null, reopen_reason = v_reason
   where p.id = v.id;
  perform private.payroll_notify_professional(v, 'billing.payout_reopened', 'Sommaire de paie rouvert',
    'Votre sommaire de ' || private.payroll_month_label(v.month) || ' a été rouvert par l''administration : '
    || v_reason);
end;
$$;

-- « Marquer comme versée »: a validated period with its invoice.
create function public.mark_period_paid(p_id uuid, p_paid_on date, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payout_periods := private.payroll_period_for(p_id, auth.uid(), true);
  v_note text := nullif(pg_catalog.btrim(p_note), '');
begin
  if v.state <> 'validated' then
    raise exception 'La période doit être validée par le professionnel avant d''être versée.' using errcode = 'P0001', hint = 'state';
  end if;
  if not exists (select 1 from public.professional_invoices i where i.period_id = v.id) then
    raise exception 'La facture du professionnel est requise avant le versement.' using errcode = 'P0001', hint = 'invoice';
  end if;
  if p_paid_on is null or p_paid_on < v.month or p_paid_on > private.billing_today(v.org_id) + 31 then
    raise exception 'Indiquez la date du versement.' using errcode = 'P0001', hint = 'paid_on';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'La note est trop longue (500 caractères au plus).' using errcode = 'P0001', hint = 'note';
  end if;
  update public.payout_periods p
     set state = 'paid', paid_on = p_paid_on, paid_at = pg_catalog.now(), paid_by = auth.uid(), payment_note = v_note
   where p.id = v.id;
  perform private.payroll_notify_professional(v, 'billing.payout_paid', 'Paie versée',
    'Votre paie de ' || private.payroll_month_label(v.month) || ' a été versée le ' || private.format_date_fr(p_paid_on) || '.');
end;
$$;

-- The month's professional invoices for QuickBooks, one row per validated or paid period with its
-- invoice, classed by specialty (the primary title, Christine 17). FQ pushes them later.
create function public.list_payout_export(p_month date)
returns table (
  period_id uuid, professional_name text, specialty text, invoice_number text, issued_on date, amount_cents int,
  state text, paid_on date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.payroll');
begin
  return query
    select p.id, n.display_name, coalesce(p.title_name, 'Profession à confirmer'), i.number, i.issued_on, i.amount_cents,
           p.state, p.paid_on
      from public.payout_periods p
      join public.professional_invoices i on i.period_id = p.id
      left join private.professional_display_names(v_org, (select coalesce(pg_catalog.array_agg(x.professional_id), '{}')
                                                             from public.payout_periods x
                                                            where x.org_id = v_org and x.month = p_month)) n
        on n.professional_id = p.professional_id
     where p.org_id = v_org and p.month = p_month and p.state in ('validated', 'paid')
     order by 3, 2, p.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs: the professional (billing.self) and the administration
-- -----------------------------------------------------------------------------
-- « Ma paie »: her periods once sent, newest first.
create function public.list_my_payout_periods()
returns table (
  id uuid, month date, state text, lines_count int, total_cents int, sent_at timestamptz, validated_at timestamptz,
  paid_on date, has_invoice boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.self');
  v_me uuid := private.current_professional_id();
begin
  return query
    select p.id, p.month, p.state, p.lines_count, p.total_cents, p.sent_at, p.validated_at, p.paid_on,
           exists (select 1 from public.professional_invoices i where i.period_id = p.id)
      from public.payout_periods p
     where p.org_id = v_org and p.professional_id = v_me and p.state <> 'draft'
     order by p.month desc;
end;
$$;

-- One period: its state, its lines (the client's name and file number, the service), its
-- invoice and the professional's facts for her invoice. The professional: hers, once sent; the
-- administration: any.
create function public.get_payout_period(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.payout_periods;
  v_staff boolean := private.has_permission('billing.payroll');
  v_org uuid := private.current_user_org_id();
begin
  if not (v_staff or private.has_permission('billing.self')) then
    raise exception 'Permission refusée : billing.self' using errcode = '42501';
  end if;
  select p.* into v from public.payout_periods p where p.org_id = v_org and p.id = p_id;
  if v.id is null
     or (not v_staff and (v.state = 'draft' or v.professional_id is distinct from private.current_professional_id())) then
    raise exception 'Période de paie introuvable.' using errcode = 'P0001', hint = 'period_id';
  end if;
  return (
    with lines as (
      select l.* from public.payout_lines l where l.period_id = v.id
    ),
    clients as (
      select c.* from private.clients_billing_facts(v_org, (select coalesce(pg_catalog.array_agg(distinct l.client_id), '{}')
                                                              from lines l where l.client_id is not null)) c
    ),
    services as (
      select s.* from private.service_payout_facts(v_org, (select coalesce(pg_catalog.array_agg(distinct l.service_id), '{}')
                                                             from lines l where l.service_id is not null)) s
    )
    select pg_catalog.jsonb_build_object(
      'id', v.id,
      'month', v.month,
      'state', v.state,
      'professional', (select pg_catalog.to_jsonb(f) - 'profile_id'
                         from private.professional_payout_facts(v_org, array[v.professional_id]) f),
      'title_name', v.title_name,
      'lines_count', v.lines_count,
      'unpriced_count', v.unpriced_count,
      'total_cents', v.total_cents,
      'built_at', v.built_at,
      'sent_at', v.sent_at,
      'correction_note', v.correction_note,
      'correction_requested_at', v.correction_requested_at,
      'validated_at', v.validated_at,
      'reopen_reason', v.reopen_reason,
      'paid_on', v.paid_on,
      'payment_note', v.payment_note,
      'lines', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                  'id', l.id, 'kind', l.kind, 'occurred_on', l.occurred_on, 'paid_on', l.paid_on,
                  'client_id', l.client_id, 'client_name', c.display_name, 'client_number', c.client_number,
                  'service_code', s.code, 'service_name', s.name, 'duration', l.duration,
                  'base_cents', l.base_cents, 'retention_pct', l.retention_pct, 'amount_cents', l.amount_cents,
                  'pricing', l.pricing, 'note', l.note, 'late', l.occurred_on < v.month)
                  order by l.kind = 'adjustment', l.occurred_on, s.code, l.id), '[]'::jsonb)
                  from lines l
                  left join clients c on c.client_id = l.client_id
                  left join services s on s.service_id = l.service_id),
      'invoice', (select pg_catalog.jsonb_build_object('id', i.id, 'source', i.source, 'file_id', i.file_id,
                                                       'number', i.number, 'issued_on', i.issued_on,
                                                       'amount_cents', i.amount_cents, 'created_at', i.created_at)
                    from public.professional_invoices i where i.period_id = v.id)
    )
  );
end;
$$;

-- « Signaler une correction »: her note to the administration.
create function public.request_payout_correction(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payout_periods := private.payroll_period_for(p_id, auth.uid(), false);
  v_note text := pg_catalog.btrim(p_note);
  v_name text;
begin
  if v.state <> 'to_validate' then
    raise exception 'Seul un sommaire à valider peut faire l''objet d''une correction.' using errcode = 'P0001', hint = 'state';
  end if;
  if v_note is null or char_length(v_note) < 3 or char_length(v_note) > 2000 then
    raise exception 'Décrivez la correction (3 à 2 000 caractères).' using errcode = 'P0001', hint = 'note';
  end if;
  update public.payout_periods p
     set state = 'correction_requested', correction_note = v_note, correction_requested_at = pg_catalog.now()
   where p.id = v.id;
  select n.display_name into v_name from private.professional_display_names(v.org_id, array[v.professional_id]) n;
  perform private.notify(v.org_id, 'billing', 'billing.payout_correction', 'important', 'Correction de paie demandée',
                         coalesce(v_name, 'Un professionnel') || ' demande une correction à son sommaire de '
                         || private.payroll_month_label(v.month) || '.',
                         '/facturation/paie?mois=' || pg_catalog.to_char(v.month, 'YYYY-MM') || '&periode=' || v.id::text,
                         'payout_period', v.id, 'billing.payroll', null, null, null);
end;
$$;

-- « Valider le sommaire »: by her, or by the administration for her. Locks the period.
create function public.validate_payout_period(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payout_periods := private.payroll_period_for(p_id, auth.uid(), false);
begin
  if v.state <> 'to_validate' then
    raise exception 'Ce sommaire n''est pas à valider.' using errcode = 'P0001', hint = 'state';
  end if;
  if v.unpriced_count > 0 or v.lines_count = 0 then
    raise exception 'Une ligne est à compléter : l''administration doit la corriger.' using errcode = 'P0001', hint = 'unpriced';
  end if;
  update public.payout_periods p
     set state = 'validated', validated_at = pg_catalog.now(), validated_by = auth.uid()
   where p.id = v.id;
end;
$$;

-- Records the period's invoice (replaces the previous one while not paid): the file, her
-- number and its date; the amount is the period's total.
create function private.payroll_record_invoice(p_period public.payout_periods, p_source text, p_file_id uuid,
                                               p_number text, p_issued_on date, p_actor uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_number text := pg_catalog.btrim(p_number);
  v_old uuid;
  v_id uuid;
  v_profile uuid := private.professional_profile_id(p_period.org_id, p_period.professional_id);
begin
  if p_period.state <> 'validated' then
    raise exception 'Validez d''abord le sommaire : la facture suit le sommaire validé.' using errcode = 'P0001', hint = 'state';
  end if;
  if v_number is null or char_length(v_number) < 1 or char_length(v_number) > 40 or not private.is_tidy_text(v_number) then
    raise exception 'Indiquez le numéro de votre facture (40 caractères au plus).' using errcode = 'P0001', hint = 'number';
  end if;
  if p_issued_on is null or p_issued_on < p_period.month or p_issued_on > private.billing_today(p_period.org_id) then
    raise exception 'La date de la facture doit suivre le début du mois et ne pas être dans le futur.' using errcode = 'P0001', hint = 'issued_on';
  end if;
  select i.file_id into v_old from public.professional_invoices i where i.period_id = p_period.id;
  delete from public.professional_invoices i where i.period_id = p_period.id;
  if v_old is not null and v_old <> p_file_id then
    perform private.soft_delete_stored_file(v_old, p_actor);
  end if;
  -- Her file, read by the administration, by her as its owner.
  update public.stored_files f
     set subject_type = 'payout_period', subject_id = p_period.id, view_permission = 'billing.payroll',
         owner_profile_id = v_profile, owner_permission = case when v_profile is not null then 'billing.self' end,
         retain_until = null
   where f.id = p_file_id;
  insert into public.professional_invoices (org_id, period_id, source, file_id, number, issued_on, amount_cents, created_by)
  values (p_period.org_id, p_period.id, p_source, p_file_id, v_number, p_issued_on, p_period.total_cents, p_actor)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.payroll_record_invoice(public.payout_periods, text, uuid, text, date, uuid)
  from public, anon, authenticated, service_role;

-- « Téléverser ma facture »: a file the caller uploaded (purpose billing_professional_invoice).
create function public.attach_professional_invoice(p_period_id uuid, p_file_id uuid, p_number text, p_issued_on date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payout_periods := private.payroll_period_for(p_period_id, auth.uid(), false);
begin
  if not exists (select 1 from public.stored_files f
                  where f.id = p_file_id and f.org_id = v.org_id and f.status = 'ready'
                    and f.purpose = 'billing_professional_invoice' and f.uploaded_by = auth.uid()
                    and (f.retain_until is null or f.retain_until > pg_catalog.now())) then
    raise exception 'Fichier introuvable.' using errcode = 'P0001', hint = 'file_id';
  end if;
  return private.payroll_record_invoice(v, 'uploaded', p_file_id, p_number, p_issued_on, auth.uid());
end;
$$;

-- -----------------------------------------------------------------------------
-- Service RPCs (billing-payout-invoice: « Générer ma facture »)
-- -----------------------------------------------------------------------------
-- What the generated invoice prints, for p_actor (the caller verifyAuth verified): the period
-- (validated), its lines (client file numbers, never names: the clinic's copy needs no more),
-- the professional's facts and the clinic's identity. Refusals as the user RPCs.
create function public.prepare_professional_invoice(p_period_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payout_periods := private.payroll_period_for(p_period_id, p_actor, false);
begin
  if v.state <> 'validated' then
    raise exception 'Validez d''abord le sommaire : la facture suit le sommaire validé.' using errcode = 'P0001', hint = 'state';
  end if;
  return (
    select pg_catalog.jsonb_build_object(
      'org_id', v.org_id,
      'period_id', v.id,
      'month', v.month,
      'month_label', private.payroll_month_label(v.month),
      'total_cents', v.total_cents,
      'title_name', v.title_name,
      'professional', (select pg_catalog.to_jsonb(f) - 'profile_id' - 'email'
                         from private.professional_payout_facts(v.org_id, array[v.professional_id]) f),
      'clinic', (select pg_catalog.jsonb_build_object('name', coalesce(o.legal_name, o.name), 'address_line1', o.address_line1,
                                                      'address_line2', o.address_line2, 'city', o.city,
                                                      'province', o.province, 'postal_code', o.postal_code)
                   from public.organizations o where o.id = v.org_id),
      'today', private.billing_today(v.org_id),
      'lines', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                  'kind', l.kind, 'occurred_on', l.occurred_on, 'client_number', c.client_number,
                  'service_code', s.code, 'service_name', s.name, 'base_cents', l.base_cents,
                  'retention_pct', l.retention_pct, 'amount_cents', l.amount_cents, 'note', l.note)
                  order by l.kind = 'adjustment', l.occurred_on, s.code, l.id), '[]'::jsonb)
                  from public.payout_lines l
                  left join private.clients_billing_facts(v.org_id, array[l.client_id]) c on l.client_id is not null
                  left join private.service_payout_facts(v.org_id, array[l.service_id]) s on l.service_id is not null
                 where l.period_id = v.id)
    )
  );
end;
$$;

-- Records the rendered invoice the function stored (register_system_file, purpose
-- billing_professional_invoice, subject the period) for p_actor.
create function public.record_generated_professional_invoice(
  p_period_id uuid, p_file_id uuid, p_number text, p_issued_on date, p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payout_periods := private.payroll_period_for(p_period_id, p_actor, false);
begin
  if not exists (select 1 from public.stored_files f
                  where f.id = p_file_id and f.org_id = v.org_id and f.status = 'ready'
                    and f.purpose = 'billing_professional_invoice' and f.subject_type = 'payout_period'
                    and f.subject_id = v.id) then
    raise exception 'Fichier introuvable.' using errcode = 'P0001', hint = 'file_id';
  end if;
  return private.payroll_record_invoice(v, 'generated', p_file_id, p_number, p_issued_on, p_actor);
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs: Paramètres → Paie (billing.settings)
-- -----------------------------------------------------------------------------
create function public.list_payout_rules()
returns table (service_id uuid, code int, name text, kind text, is_active boolean, family_code int, family_name text,
               rule text, is_default boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  if not (private.has_permission('billing.settings') or private.has_permission('billing.payroll')) then
    raise exception 'Permission refusée : billing.settings' using errcode = '42501';
  end if;
  return query
    select r.service_id, r.code, r.name, r.kind, r.is_active, r.family_code, r.family_name, r.rule, r.is_default
      from private.payroll_rules(v_org) r
     order by r.family_code, r.sort_order, r.code;
end;
$$;

-- Sets a service's rule; its default removes the override.
create function public.set_payout_rule(p_service_id uuid, p_rule text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.settings');
  v_default text;
begin
  select private.payroll_default_rule(f.kind, f.key) into v_default
    from private.service_payout_facts(v_org, array[p_service_id]) f;
  if v_default is null then
    raise exception 'Ce service n''existe pas.' using errcode = 'P0001', hint = 'service_id';
  end if;
  if p_rule is null or p_rule not in ('session', 'late_cancellation', 'other_fees', 'workshop', 'none') then
    raise exception 'Règle de paie inconnue.' using errcode = 'P0001', hint = 'rule';
  end if;
  if p_rule = v_default then
    delete from public.payout_service_rules r where r.org_id = v_org and r.service_id = p_service_id;
  else
    insert into public.payout_service_rules (org_id, service_id, rule, updated_by)
    values (v_org, p_service_id, p_rule, auth.uid())
    on conflict (org_id, service_id) do update set rule = excluded.rule, updated_by = excluded.updated_by;
  end if;
end;
$$;

revoke all on function public.list_payout_periods(date), public.build_payout_month(date), public.rebuild_payout_period(uuid),
  public.send_payout_periods(uuid[]), public.add_payout_adjustment(uuid, int, text), public.remove_payout_adjustment(uuid),
  public.reopen_payout_period(uuid, text), public.mark_period_paid(uuid, date, text), public.list_payout_export(date),
  public.list_my_payout_periods(), public.get_payout_period(uuid), public.request_payout_correction(uuid, text),
  public.validate_payout_period(uuid), public.attach_professional_invoice(uuid, uuid, text, date),
  public.list_payout_rules(), public.set_payout_rule(uuid, text),
  public.prepare_professional_invoice(uuid, uuid), public.record_generated_professional_invoice(uuid, uuid, text, date, uuid)
  from public, anon, authenticated;
grant execute on function public.list_payout_periods(date), public.build_payout_month(date), public.rebuild_payout_period(uuid),
  public.send_payout_periods(uuid[]), public.add_payout_adjustment(uuid, int, text), public.remove_payout_adjustment(uuid),
  public.reopen_payout_period(uuid, text), public.mark_period_paid(uuid, date, text), public.list_payout_export(date),
  public.list_my_payout_periods(), public.get_payout_period(uuid), public.request_payout_correction(uuid, text),
  public.validate_payout_period(uuid), public.attach_professional_invoice(uuid, uuid, text, date),
  public.list_payout_rules(), public.set_payout_rule(uuid, text)
  to authenticated;
grant execute on function public.prepare_professional_invoice(uuid, uuid),
  public.record_generated_professional_invoice(uuid, uuid, text, date, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- The job: the previous month's drafts on the 1st
-- -----------------------------------------------------------------------------
-- For every clinic with Facturation on: builds last month (clinic time) and tells the
-- administration once. Idempotent: a second run rebuilds the open periods.
create function private.job_billing_payout_periods()
returns text
language plpgsql
set search_path = ''
as $$
declare
  r record;
  v_month date;
  v_result jsonb;
  v_orgs int := 0;
  v_periods int := 0;
begin
  for r in select o.id from public.organizations o where public.module_enabled_for_org(o.id, 'billing') loop
    v_month := (pg_catalog.date_trunc('month', (pg_catalog.now() at time zone private.payroll_tz(r.id))) - interval '1 month')::date;
    v_result := private.payroll_build(r.id, v_month, null);
    v_orgs := v_orgs + 1;
    v_periods := v_periods + (v_result ->> 'created')::int + (v_result ->> 'rebuilt')::int;
    if exists (select 1 from public.payout_periods p where p.org_id = r.id and p.month = v_month and p.state = 'draft') then
      perform private.notify(r.id, 'billing', 'billing.payout_built', 'important', 'Sommaires de paie calculés',
                             'Les sommaires de ' || private.payroll_month_label(v_month)
                             || ' sont prêts à vérifier avant l''envoi aux professionnels.',
                             '/facturation/paie?mois=' || pg_catalog.to_char(v_month, 'YYYY-MM'),
                             null, null, 'billing.payroll', null,
                             'billing.payout_built:' || pg_catalog.to_char(v_month, 'YYYY-MM'), null);
    end if;
  end loop;
  return 'orgs=' || v_orgs || ' periods=' || v_periods;
end;
$$;
revoke all on function private.job_billing_payout_periods() from public, anon, authenticated, service_role;

insert into public.scheduled_jobs
  (key, module_key, label, description, kind, sql_function, cron_job_name, is_maintenance)
values
  ('billing.payout_periods', 'billing', 'Sommaires de paie',
   'Le 1er du mois, calcule les sommaires de paie du mois précédent, à vérifier avant l''envoi aux professionnels.',
   'sql', 'private.job_billing_payout_periods', 'billing.payout_periods', true)
on conflict do nothing;

-- 11:15 UTC on the 1st: 6:15 or 7:15 in Montréal, after the night's completions.
select cron.schedule('billing.payout_periods', '15 11 1 * *',
  $$select private.run_sql_job('billing.payout_periods')$$);

select pg_catalog.set_config('app.audit_source', '', true);

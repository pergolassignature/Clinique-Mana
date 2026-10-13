-- =============================================================================
-- Module Facturation (« billing »), batch F1: invoices, lines, payers, numbering, taxes, credit notes
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §8 (F1; data model, payer model)
-- Answers:   docs/research/2026-10-12-christine-answers.md (5, 11, 15, 16)
-- Legacy:    docs/plans/2026-10-06-legacy-feature-inventory.md §F (per-line tax rounding)
-- Decisions: R-40, R-57, R-61, R-64, R-65, BI-1 … (decisions log)
-- Recipe:    docs/standards/database-conventions.md §9
--
-- The `billing` module (lane B's FQ, which adds the QuickBooks tables, rebases onto this one):
--   * `payment_modes`: the clinic's modes by code (`interac`, `stripe`, `qbo_payments_card`,
--     `bank_transfer`, `cheque`, `credit_note`), seeded per clinic; QuickBooks maps
--     `deposit.<code>` to an account (FQ); `credit_note` is no deposit.
--   * `invoices`: a client's dossier billed to a payer (« Facturé à »: the client herself or a
--     relation holding the right « recevoir reçus et factures », chosen per invoice, never split
--     between separated parents, R-61); `draft` until finalised, then numbered `AAAA-N` from
--     `invoice_sequences` (gapless: the number is taken in the finalising transaction; the clinic
--     sets where GOrendezvous's sequence stopped), `issued`, and `credited` by a credit note.
--   * `invoice_lines`: a session (priced by Services et tarifs' `service_price` with the
--     professional's primary title, the client's rate variant and « Statut Indien », R-64), the
--     file-opening fee, an adjustment; taxes per line, each rounded on its own, the invoice's are
--     their sum (§F); the rates applied are kept on the invoice.
--   * `credit_notes`: the whole invoice credited (« NC-AAAA-N », its own sequence) with a reason:
--     a correction is a credit note and a new invoice, never an edit (Christine, answer 5).
--   * `billing_payer_defaults`: the dossier's dated default payer.
-- Every write is an RPC (billing.manage; the sequence: billing.settings). Payments, receipts and
-- the morning queue are F2; dunning, the balance rule and cancellation fees F3.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:billing_module', true);

-- -----------------------------------------------------------------------------
-- Registry
-- -----------------------------------------------------------------------------
insert into public.modules (key, name) values ('billing', 'Facturation')
on conflict do nothing;

insert into public.module_dependencies (module_key, depends_on) values
  ('billing', 'clients'),
  ('billing', 'services'),
  ('billing', 'professionals'),
  ('billing', 'appointments')
on conflict do nothing;

insert into public.permissions (key, module_key, description) values
  ('billing.view',     'billing', 'Voir les factures, les paiements et les soldes des clients'),
  ('billing.manage',   'billing', 'Créer, finaliser et créditer les factures ; enregistrer les paiements'),
  ('billing.self',     'billing', 'Voir ses propres reçus, sa paie et ses frais d''annulation (professionnel)'),
  ('billing.settings', 'billing', 'Configurer QuickBooks et la facturation')
on conflict do nothing;

-- Defaults (BI-1): the adjointe bills (the morning queue, R-56), the admin too; the conseillère
-- reads; the professional her own (F2, FPay); the admin sets the numbering and QuickBooks.
insert into public.role_permissions (role, permission_key) values
  ('admin',           'billing.view'),
  ('admin',           'billing.manage'),
  ('admin',           'billing.self'),
  ('admin',           'billing.settings'),
  ('admin_assistant', 'billing.view'),
  ('admin_assistant', 'billing.manage'),
  ('counselor',       'billing.view'),
  ('provider',        'billing.self')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- payment_modes: the clinic's modes (seeded per clinic)
-- -----------------------------------------------------------------------------
create table public.payment_modes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  is_deposit boolean not null default true,
  is_active boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint payment_modes_org_code_key unique (org_id, code),
  constraint payment_modes_code_check check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  constraint payment_modes_name_check check (pg_catalog.length(pg_catalog.btrim(name)) between 1 and 80)
);

create function private.seed_billing_reference(p_org uuid)
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
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
end;
$$;

create function private.seed_billing_reference_on_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_billing_reference(new.id);
  return null;
end;
$$;
create trigger organizations_seed_billing_reference
  after insert on public.organizations
  for each row execute function private.seed_billing_reference_on_org();
revoke all on function private.seed_billing_reference(uuid), private.seed_billing_reference_on_org()
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- invoice_sequences: `AAAA-N` per clinic, kind and year (gapless)
-- -----------------------------------------------------------------------------
create table public.invoice_sequences (
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  year smallint not null,
  last_number int not null default 0,
  updated_at timestamptz not null default now(),
  constraint invoice_sequences_pkey primary key (org_id, kind, year),
  constraint invoice_sequences_kind_check check (kind in ('invoice', 'credit_note')),
  constraint invoice_sequences_year_check check (year between 2000 and 2100),
  constraint invoice_sequences_last_check check (last_number >= 0)
);
create trigger invoice_sequences_set_updated_at before update on public.invoice_sequences
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- billing_payer_defaults: the dossier's dated default payer
-- -----------------------------------------------------------------------------
create table public.billing_payer_defaults (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  client_id uuid not null,
  payer_client_id uuid not null,
  effective_from date not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  constraint billing_payer_defaults_client_fkey foreign key (org_id, client_id) references public.clients (org_id, id),
  constraint billing_payer_defaults_payer_fkey foreign key (org_id, payer_client_id) references public.clients (org_id, id),
  constraint billing_payer_defaults_day_key unique (org_id, client_id, effective_from)
);
create index billing_payer_defaults_payer_idx on public.billing_payer_defaults (org_id, payer_client_id);
create index billing_payer_defaults_created_by_idx on public.billing_payer_defaults (created_by);

-- -----------------------------------------------------------------------------
-- invoices
-- -----------------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  number text,
  year smallint,
  seq int,
  status text not null default 'draft',
  client_id uuid not null,
  payer_kind text not null default 'client',
  payer_client_id uuid not null,
  issued_on date,
  due_on date,
  gst_rate numeric(7, 6) not null default 0,
  qst_rate numeric(7, 6) not null default 0,
  tax_exempt boolean not null default false,
  subtotal_cents int not null default 0,
  gst_cents int not null default 0,
  qst_cents int not null default 0,
  total_cents int not null default 0,
  source_type text not null default 'manual',
  source_id uuid,
  external_ref text,
  notes_client text,
  notes_internal text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  finalized_at timestamptz,
  finalized_by uuid references public.profiles(user_id) on delete set null,
  credited_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint invoices_org_id_id_key unique (org_id, id),
  constraint invoices_org_number_key unique (org_id, number),
  constraint invoices_org_external_ref_key unique (org_id, external_ref),
  constraint invoices_client_fkey foreign key (org_id, client_id) references public.clients (org_id, id),
  constraint invoices_payer_fkey foreign key (org_id, payer_client_id) references public.clients (org_id, id),
  constraint invoices_status_check check (status in ('draft', 'issued', 'credited')),
  constraint invoices_payer_kind_check check (payer_kind in ('client', 'relation')
                                              and ((payer_kind = 'client') = (payer_client_id = client_id))),
  constraint invoices_numbered_check check ((status = 'draft') = (number is null)
                                            and (number is null) = (issued_on is null)
                                            and (number is null) = (seq is null)),
  constraint invoices_number_format_check check (number is null or number ~ '^[0-9]{4}-[1-9][0-9]*$'),
  constraint invoices_credited_check check ((status = 'credited') = (credited_at is not null)),
  constraint invoices_source_check check (source_type in ('appointment', 'manual', 'service', 'import')),
  constraint invoices_totals_check check (total_cents = subtotal_cents + gst_cents + qst_cents and total_cents >= 0),
  constraint invoices_text_check check (
    (notes_client is null or char_length(notes_client) <= 2000) and (notes_internal is null or char_length(notes_internal) <= 5000))
);
create index invoices_org_client_idx on public.invoices (org_id, client_id, created_at desc);
create index invoices_org_payer_idx on public.invoices (org_id, payer_client_id);
create index invoices_org_status_idx on public.invoices (org_id, status, created_at desc);
create index invoices_created_by_idx on public.invoices (created_by);
create index invoices_finalized_by_idx on public.invoices (finalized_by);
create trigger invoices_set_updated_at before update on public.invoices
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- invoice_lines
-- -----------------------------------------------------------------------------
create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  invoice_id uuid not null,
  position smallint not null,
  line_type text not null,
  appointment_id uuid,
  professional_id uuid,
  service_id uuid,
  service_code int,
  description text not null,
  quantity numeric(7, 2) not null default 1,
  unit_price_cents int,
  price_source text,
  tax_rule text not null default 'exempt',
  subtotal_cents int not null default 0,
  gst_cents int not null default 0,
  qst_cents int not null default 0,
  total_cents int not null default 0,
  credited boolean not null default false,
  created_at timestamptz not null default now(),
  constraint invoice_lines_invoice_fkey foreign key (org_id, invoice_id) references public.invoices (org_id, id) on delete cascade,
  constraint invoice_lines_appointment_fkey foreign key (org_id, appointment_id) references public.appointments (org_id, id),
  constraint invoice_lines_professional_fkey foreign key (org_id, professional_id) references public.professionals (org_id, id),
  constraint invoice_lines_service_fkey foreign key (org_id, service_id) references public.services (org_id, id),
  constraint invoice_lines_type_check check (line_type in ('service', 'cancellation_fee', 'file_opening', 'adjustment', 'ivac_gap')),
  constraint invoice_lines_tax_rule_check check (tax_rule in ('exempt', 'taxable')),
  constraint invoice_lines_quantity_check check (quantity > 0 and quantity <= 1000),
  constraint invoice_lines_price_check check (unit_price_cents is null or unit_price_cents between 0 and 10000000),
  constraint invoice_lines_description_check check (pg_catalog.length(pg_catalog.btrim(description)) between 1 and 300),
  constraint invoice_lines_totals_check check (total_cents = subtotal_cents + gst_cents + qst_cents)
);
create index invoice_lines_org_invoice_idx on public.invoice_lines (org_id, invoice_id, position);
create index invoice_lines_org_appointment_idx on public.invoice_lines (org_id, appointment_id);
create index invoice_lines_org_service_idx on public.invoice_lines (org_id, service_id);
create index invoice_lines_org_professional_idx on public.invoice_lines (org_id, professional_id);
-- One live session line per appointment (a credited invoice frees it).
create unique index invoice_lines_one_session_idx on public.invoice_lines (appointment_id)
  where line_type = 'service' and appointment_id is not null and not credited;

-- -----------------------------------------------------------------------------
-- credit_notes
-- -----------------------------------------------------------------------------
create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  invoice_id uuid not null,
  number text not null,
  year smallint not null,
  seq int not null,
  reason text not null,
  issued_on date not null,
  subtotal_cents int not null,
  gst_cents int not null,
  qst_cents int not null,
  total_cents int not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  constraint credit_notes_org_number_key unique (org_id, number),
  constraint credit_notes_invoice_key unique (invoice_id),
  constraint credit_notes_invoice_fkey foreign key (org_id, invoice_id) references public.invoices (org_id, id),
  constraint credit_notes_number_format_check check (number ~ '^NC-[0-9]{4}-[1-9][0-9]*$'),
  constraint credit_notes_reason_check check (char_length(reason) between 3 and 500),
  constraint credit_notes_totals_check check (total_cents = subtotal_cents + gst_cents + qst_cents)
);
create index credit_notes_org_invoice_idx on public.credit_notes (org_id, invoice_id);
create index credit_notes_created_by_idx on public.credit_notes (created_by);

-- -----------------------------------------------------------------------------
-- RLS, grants (select only; every write is an RPC), audit
-- -----------------------------------------------------------------------------
alter table public.payment_modes enable row level security;
alter table public.invoice_sequences enable row level security;
alter table public.billing_payer_defaults enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.credit_notes enable row level security;

revoke all on public.payment_modes, public.invoice_sequences, public.billing_payer_defaults, public.invoices,
  public.invoice_lines, public.credit_notes from anon, authenticated;
grant select on public.payment_modes, public.invoice_sequences, public.billing_payer_defaults, public.invoices,
  public.invoice_lines, public.credit_notes to authenticated;

create policy payment_modes_select on public.payment_modes
  for select to authenticated
  using (org_id = (select private.current_user_org_id())
         and ((select private.has_permission('billing.view')) or (select private.has_permission('billing.self'))));
create policy invoice_sequences_select on public.invoice_sequences
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.view')));
create policy billing_payer_defaults_select on public.billing_payer_defaults
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.view')));
create policy invoices_select on public.invoices
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.view')));
create policy invoice_lines_select on public.invoice_lines
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.view')));
create policy credit_notes_select on public.credit_notes
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.view')));

create trigger payment_modes_audit after insert or update or delete on public.payment_modes
  for each row execute function private.audit_trigger();
create trigger invoice_sequences_audit after insert or update or delete on public.invoice_sequences
  for each row execute function private.audit_trigger();
create trigger billing_payer_defaults_audit after insert or update or delete on public.billing_payer_defaults
  for each row execute function private.audit_trigger();
create trigger invoices_audit after insert or update or delete on public.invoices
  for each row execute function private.audit_trigger('notes_client', 'notes_internal');
create trigger invoice_lines_audit after insert or update or delete on public.invoice_lines
  for each row execute function private.audit_trigger('description');
create trigger credit_notes_audit after insert or update or delete on public.credit_notes
  for each row execute function private.audit_trigger('reason');

-- Existing organizations (production): the payment modes.
select private.seed_billing_reference(o.id) from public.organizations o;

-- -----------------------------------------------------------------------------
-- Helpers (private, granted to no role)
-- -----------------------------------------------------------------------------
create function private.billing_today(p_org uuid)
returns date
language sql
stable
set search_path = ''
as $$
  select (pg_catalog.now() at time zone coalesce((select o.timezone from public.organizations o where o.id = p_org), 'America/Toronto'))::date
$$;

-- The rate in force on a date (core's « Fiscalité »), 0 when none.
create function private.billing_tax_rate(p_org uuid, p_tax text, p_on date)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce((select t.rate from public.tax_rates t
                    where t.org_id = p_org and t.tax = p_tax and t.effective_from <= p_on
                      and (t.effective_to is null or p_on < t.effective_to)), 0)
$$;

-- Who may be billed for a dossier: the client herself, or a relation holding the right
-- « recevoir reçus et factures » (Clients' contacts, R-61).
create function private.billing_payer_allowed(p_org uuid, p_client_id uuid, p_payer_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_payer_id = p_client_id
      or exists (select 1 from private.client_contacts_for(p_org, p_client_id, 'invoices') c
                  where c.client_id = p_payer_id and not c.is_self)
$$;

-- The dossier's default payer on a date (the client when none was set, or when the one set lost
-- the right since).
create function private.billing_default_payer(p_org uuid, p_client_id uuid, p_on date)
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select d.payer_client_id from public.billing_payer_defaults d
      where d.org_id = p_org and d.client_id = p_client_id and d.effective_from <= p_on
        and private.billing_payer_allowed(p_org, p_client_id, d.payer_client_id)
      order by d.effective_from desc limit 1),
    p_client_id)
$$;

-- A line's amounts: the subtotal rounded to the cent, then each tax rounded on its own (§F).
create function private.billing_line_amounts(p_quantity numeric, p_unit_cents int, p_taxable boolean, p_gst numeric, p_qst numeric,
                                             out subtotal_cents int, out gst_cents int, out qst_cents int, out total_cents int)
language plpgsql
immutable
set search_path = ''
as $$
begin
  subtotal_cents := pg_catalog.round(coalesce(p_quantity, 1) * coalesce(p_unit_cents, 0))::int;
  gst_cents := case when p_taxable then pg_catalog.round(subtotal_cents * p_gst)::int else 0 end;
  qst_cents := case when p_taxable then pg_catalog.round(subtotal_cents * p_qst)::int else 0 end;
  total_cents := subtotal_cents + gst_cents + qst_cents;
end;
$$;

-- Recomputes a draft's rates (on p_on), its lines and its totals.
create function private.billing_recompute(p_invoice_id uuid, p_on date)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v public.invoices;
  v_gst numeric;
  v_qst numeric;
begin
  select i.* into v from public.invoices i where i.id = p_invoice_id for update;
  v_gst := private.billing_tax_rate(v.org_id, 'gst', p_on);
  v_qst := private.billing_tax_rate(v.org_id, 'qst', p_on);
  update public.invoice_lines l
     set subtotal_cents = a.subtotal_cents, gst_cents = a.gst_cents, qst_cents = a.qst_cents, total_cents = a.total_cents
    from public.invoice_lines x
   cross join lateral private.billing_line_amounts(x.quantity, x.unit_price_cents, x.tax_rule = 'taxable' and not v.tax_exempt, v_gst, v_qst) a
   where x.id = l.id and l.invoice_id = p_invoice_id;
  update public.invoices i
     set gst_rate = v_gst, qst_rate = v_qst,
         subtotal_cents = coalesce((select sum(l.subtotal_cents) from public.invoice_lines l where l.invoice_id = i.id), 0),
         gst_cents = coalesce((select sum(l.gst_cents) from public.invoice_lines l where l.invoice_id = i.id), 0),
         qst_cents = coalesce((select sum(l.qst_cents) from public.invoice_lines l where l.invoice_id = i.id), 0),
         total_cents = coalesce((select sum(l.total_cents) from public.invoice_lines l where l.invoice_id = i.id), 0)
   where i.id = p_invoice_id;
end;
$$;

-- The next number of a sequence (the row stays locked until the transaction ends: gapless).
create function private.billing_next_number(p_org uuid, p_kind text, p_year int)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_n int;
begin
  insert into public.invoice_sequences as s (org_id, kind, year, last_number)
  values (p_org, p_kind, p_year, 1)
  on conflict (org_id, kind, year) do update set last_number = s.last_number + 1
  returning s.last_number into v_n;
  return v_n;
end;
$$;

-- A dossier the clinic may bill: found, not merged nor anonymised. Returns its « Statut Indien ».
create function private.billing_check_client(p_org uuid, p_client_id uuid)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  r record;
begin
  select f.* into r from private.clients_billing_facts(p_org, array[p_client_id]) f;
  if r.found is not true then
    raise exception 'Dossier client introuvable.' using errcode = 'P0001', hint = 'client_id';
  end if;
  if r.is_closed then
    raise exception 'Ce dossier est fusionné ou anonymisé : facturez le dossier conservé.' using errcode = 'P0001', hint = 'client_id';
  end if;
  return r.tax_exempt;
end;
$$;

-- A new draft for a dossier and its payer.
create function private.billing_new_invoice(p_org uuid, p_client_id uuid, p_payer_id uuid, p_source_type text, p_source_id uuid, p_actor uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_exempt boolean;
  v_payer uuid;
  v_id uuid;
begin
  v_exempt := private.billing_check_client(p_org, p_client_id);
  v_payer := coalesce(p_payer_id, private.billing_default_payer(p_org, p_client_id, private.billing_today(p_org)));
  if not private.billing_payer_allowed(p_org, p_client_id, v_payer) then
    raise exception 'Cette personne ne peut pas recevoir les factures de ce client : donnez-lui le droit « recevoir reçus et factures » dans ses proches.'
      using errcode = 'P0001', hint = 'payer';
  end if;
  insert into public.invoices (org_id, client_id, payer_kind, payer_client_id, tax_exempt, source_type, source_id, created_by)
  values (p_org, p_client_id, case when v_payer = p_client_id then 'client' else 'relation' end, v_payer, v_exempt,
          p_source_type, p_source_id, p_actor)
  returning id into v_id;
  return v_id;
end;
$$;

-- A service line priced by Services et tarifs on a date (the professional's primary title, the
-- client's variant and « Statut Indien »). A price to confirm (a grid without a rate) refuses; an
-- amount « saisi à la facture » leaves the price to type (null).
create function private.billing_add_service_line(
  p_org uuid, p_invoice_id uuid, p_line_type text, p_service_id uuid, p_title_id uuid, p_on date, p_appointment_id uuid,
  p_professional_id uuid default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v public.invoices;
  c record;
  p record;
  s record;
  v_name text;
  v_id uuid;
begin
  select i.* into v from public.invoices i where i.id = p_invoice_id;
  select f.* into c from private.clients_billing_facts(p_org, array[v.client_id]) f;
  select x.* into p from private.service_price(p_org, p_service_id, p_title_id, c.rate_variant, p_on, c.tax_exempt) x;
  select f.code into s from private.service_booking_facts(p_org, p_service_id) f;
  if p.source is null then
    raise exception 'Ce service n''existe pas.' using errcode = 'P0001', hint = 'service_id';
  end if;
  if p.price_cents is null and p.source <> 'entered' then
    raise exception 'Le prix de ce service n''est pas fixé pour ce professionnel à cette date : à confirmer dans Services et tarifs.'
      using errcode = 'P0001', hint = 'price_missing';
  end if;
  select x.name into v_name from public.services_catalog x where x.org_id = p_org and x.id = p_service_id;
  insert into public.invoice_lines (org_id, invoice_id, position, line_type, appointment_id, professional_id, service_id, service_code,
                                    description, quantity, unit_price_cents, price_source, tax_rule)
  values (p_org, p_invoice_id,
          coalesce((select max(l.position) + 1 from public.invoice_lines l where l.invoice_id = p_invoice_id), 1),
          p_line_type, p_appointment_id, p_professional_id, p_service_id, s.code,
          pg_catalog.left(coalesce(v_name, 'Service ' || s.code::text)
                          || case when p_appointment_id is not null then ' — ' || private.format_date_fr(p_on) else '' end, 300),
          1, case when p.source = 'free' then 0 else p.price_cents end, p.source, p.tax_rule)
  returning id into v_id;
  return v_id;
end;
$$;

-- The draft of a dossier, the caller's clinic, locked; refuses anything but a draft.
create function private.billing_draft(p_invoice_id uuid)
returns public.invoices
language plpgsql
set search_path = ''
as $$
declare
  v public.invoices;
begin
  select i.* into v from public.invoices i where i.org_id = private.current_user_org_id() and i.id = p_invoice_id for update;
  if v.id is null then
    raise exception 'Facture introuvable.' using errcode = 'P0001', hint = 'invoice_id';
  end if;
  if v.status <> 'draft' then
    raise exception 'Cette facture est finalisée : corrigez-la par une note de crédit et une nouvelle facture.' using errcode = 'P0001', hint = 'status';
  end if;
  return v;
end;
$$;

create function private.billing_require(p_permission text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.has_permission(p_permission) then
    raise exception 'Permission refusée : %', p_permission using errcode = '42501';
  end if;
  return private.current_user_org_id();
end;
$$;

revoke all on function private.billing_today(uuid), private.billing_tax_rate(uuid, text, date),
  private.billing_payer_allowed(uuid, uuid, uuid), private.billing_default_payer(uuid, uuid, date),
  private.billing_line_amounts(numeric, int, boolean, numeric, numeric), private.billing_recompute(uuid, date),
  private.billing_next_number(uuid, text, int), private.billing_check_client(uuid, uuid),
  private.billing_new_invoice(uuid, uuid, uuid, text, uuid, uuid),
  private.billing_add_service_line(uuid, uuid, text, uuid, uuid, date, uuid, uuid), private.billing_draft(uuid),
  private.billing_require(text)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RPCs (billing.manage)
-- -----------------------------------------------------------------------------
-- A draft invoice for appointments of one dossier (the first client of the first appointment):
-- one session line per appointment (booked, confirmed or completed; never invoiced twice), priced
-- on its date; the file-opening fee on a dossier's first invoice (`p_file_opening` null: when the
-- policy names one and the dossier has no invoice yet); the payer chosen, else the default.
create function public.create_invoice(
  p_appointment_ids uuid[],
  p_payer_client_id uuid default null,
  p_file_opening boolean default null,
  p_notes_client text default null,
  p_notes_internal text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
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
  for a in select f.* from private.appointment_billing_facts(v_org, p_appointment_ids) f order by f.starts_at loop
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
      v_id := private.billing_new_invoice(v_org, v_client, p_payer_client_id, 'appointment', a.appointment_id, auth.uid());
    elsif not (v_client = any (a.client_ids)) then
      raise exception 'Une facture regroupe les rendez-vous d''un même dossier.' using errcode = 'P0001', hint = 'appointment_ids';
    end if;
    if exists (select 1 from public.invoice_lines l where l.appointment_id = a.appointment_id and l.line_type = 'service' and not l.credited) then
      raise exception 'Le rendez-vous du % est déjà facturé.', private.format_date_fr(a.local_date) using errcode = 'P0001', hint = 'appointment_ids';
    end if;
    select (f.title_ids)[1] into v_title from private.professional_booking_facts(v_org, a.professional_id) f;
    perform private.billing_add_service_line(v_org, v_id, 'service', a.service_id, v_title, a.local_date, a.appointment_id, a.professional_id);
  end loop;
  if v_count <> (select count(distinct x) from pg_catalog.unnest(p_appointment_ids) x) then
    raise exception 'Rendez-vous introuvable.' using errcode = 'P0001', hint = 'appointment_ids';
  end if;
  -- The file-opening fee (Services et tarifs' policy) on the dossier's first invoice.
  select b.file_opening_service_id into v_file_service from public.billing_policy_on(v_first_date) b;
  if v_file_service is not null and coalesce(p_file_opening,
       not exists (select 1 from public.invoices i where i.org_id = v_org and i.client_id = v_client and i.id <> v_id and i.status <> 'credited')) then
    perform private.billing_add_service_line(v_org, v_id, 'file_opening', v_file_service, null, v_first_date, null);
  end if;
  update public.invoices i
     set notes_client = nullif(pg_catalog.btrim(coalesce(p_notes_client, '')), ''),
         notes_internal = nullif(pg_catalog.btrim(coalesce(p_notes_internal, '')), '')
   where i.id = v_id;
  perform private.billing_recompute(v_id, private.billing_today(v_org));
  return v_id;
end;
$$;

-- A manual draft for a dossier (a report, an adjustment): lines are added next.
create function public.create_manual_invoice(p_client_id uuid, p_payer_client_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  v_id uuid;
begin
  v_id := private.billing_new_invoice(v_org, p_client_id, p_payer_client_id, 'manual', null, auth.uid());
  perform private.billing_recompute(v_id, private.billing_today(v_org));
  return v_id;
end;
$$;

-- A line on a draft: a service of the catalogue (priced today, or the amount typed for an
-- « entered » one) or an adjustment (a description, an amount, taxable or not).
create function public.add_invoice_line(
  p_invoice_id uuid,
  p_line_type text,
  p_service_id uuid default null,
  p_description text default null,
  p_quantity numeric default 1,
  p_unit_price_cents int default null,
  p_taxable boolean default false,
  p_professional_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  v public.invoices := private.billing_draft(p_invoice_id);
  v_desc text := nullif(pg_catalog.btrim(coalesce(p_description, '')), '');
  v_id uuid;
begin
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000 then
    raise exception 'La quantité est un nombre positif.' using errcode = 'P0001', hint = 'quantity';
  end if;
  if p_line_type = 'service' then
    if p_service_id is null then
      raise exception 'Choisissez le service.' using errcode = 'P0001', hint = 'service_id';
    end if;
    -- The professional who did it (a report, a discussion: her payroll counts it, FPay), priced with her primary title.
    v_id := private.billing_add_service_line(v_org, v.id, 'service', p_service_id,
                                             (select (f.title_ids)[1] from private.professional_booking_facts(v_org, p_professional_id) f),
                                             private.billing_today(v_org), null, p_professional_id);
    update public.invoice_lines l
       set quantity = p_quantity,
           unit_price_cents = coalesce(l.unit_price_cents, p_unit_price_cents),
           description = coalesce(v_desc, l.description)
     where l.id = v_id;
  elsif p_line_type = 'adjustment' then
    if v_desc is null or pg_catalog.char_length(v_desc) > 300 then
      raise exception 'Décrivez la ligne (300 caractères au plus).' using errcode = 'P0001', hint = 'description';
    end if;
    if p_unit_price_cents is null or p_unit_price_cents < 0 or p_unit_price_cents > 10000000 then
      raise exception 'Indiquez un montant positif.' using errcode = 'P0001', hint = 'unit_price_cents';
    end if;
    insert into public.invoice_lines (org_id, invoice_id, position, line_type, professional_id, description, quantity, unit_price_cents,
                                      price_source, tax_rule)
    values (v_org, v.id, coalesce((select max(l.position) + 1 from public.invoice_lines l where l.invoice_id = v.id), 1),
            'adjustment', p_professional_id, v_desc, p_quantity, p_unit_price_cents, 'entered',
            case when coalesce(p_taxable, false) then 'taxable' else 'exempt' end)
    returning id into v_id;
  else
    raise exception 'Une ligne est un service ou un ajustement.' using errcode = 'P0001', hint = 'line_type';
  end if;
  perform private.billing_recompute(v.id, private.billing_today(v_org));
  return v_id;
end;
$$;

-- The amount of a draft's line (an « entered » service, an adjustment, a correction).
create function public.set_invoice_line_price(p_line_id uuid, p_unit_price_cents int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  v_invoice uuid;
begin
  select l.invoice_id into v_invoice from public.invoice_lines l where l.org_id = v_org and l.id = p_line_id;
  if v_invoice is null then
    raise exception 'Ligne introuvable.' using errcode = 'P0001', hint = 'line_id';
  end if;
  perform private.billing_draft(v_invoice);
  if p_unit_price_cents is null or p_unit_price_cents < 0 or p_unit_price_cents > 10000000 then
    raise exception 'Indiquez un montant positif.' using errcode = 'P0001', hint = 'unit_price_cents';
  end if;
  update public.invoice_lines l set unit_price_cents = p_unit_price_cents where l.id = p_line_id;
  perform private.billing_recompute(v_invoice, private.billing_today(v_org));
end;
$$;

create function public.remove_invoice_line(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  v_invoice uuid;
begin
  select l.invoice_id into v_invoice from public.invoice_lines l where l.org_id = v_org and l.id = p_line_id;
  if v_invoice is null then
    raise exception 'Ligne introuvable.' using errcode = 'P0001', hint = 'line_id';
  end if;
  perform private.billing_draft(v_invoice);
  delete from public.invoice_lines l where l.id = p_line_id;
  perform private.billing_recompute(v_invoice, private.billing_today(v_org));
end;
$$;

-- « Facturé à » of a draft: the client or a relation with the right (R-61); never split.
create function public.set_invoice_payer(p_invoice_id uuid, p_payer_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  v public.invoices := private.billing_draft(p_invoice_id);
begin
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

create function public.set_invoice_notes(p_invoice_id uuid, p_notes_client text, p_notes_internal text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  v public.invoices;
  v_client text := nullif(pg_catalog.btrim(coalesce(p_notes_client, '')), '');
  v_internal text := nullif(pg_catalog.btrim(coalesce(p_notes_internal, '')), '');
begin
  select i.* into v from public.invoices i where i.org_id = v_org and i.id = p_invoice_id for update;
  if v.id is null then
    raise exception 'Facture introuvable.' using errcode = 'P0001', hint = 'invoice_id';
  end if;
  -- The note to the client prints on the invoice: fixed once finalised; the internal one is not.
  if v.status <> 'draft' and v_client is distinct from v.notes_client then
    raise exception 'La note au client d''une facture finalisée ne change plus.' using errcode = 'P0001', hint = 'notes_client';
  end if;
  if (v_client is not null and pg_catalog.char_length(v_client) > 2000) or (v_internal is not null and pg_catalog.char_length(v_internal) > 5000) then
    raise exception 'La note au client compte 2 000 caractères au plus, la note interne 5 000.' using errcode = 'P0001', hint = 'notes';
  end if;
  update public.invoices i set notes_client = v_client, notes_internal = v_internal where i.id = v.id;
end;
$$;

create function public.delete_invoice_draft(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  v public.invoices := private.billing_draft(p_invoice_id);
begin
  delete from public.invoices i where i.id = v.id;
end;
$$;

-- Finalises a draft: today's tax rates, the totals, the next number of the year (`AAAA-N`, taken
-- in this transaction: no gap), issued today, due on receipt. Returns the number.
create function public.finalize_invoice(p_invoice_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  v public.invoices := private.billing_draft(p_invoice_id);
  v_today date := private.billing_today(v_org);
  v_year int := extract(year from v_today)::int;
  v_seq int;
  v_number text;
begin
  if not exists (select 1 from public.invoice_lines l where l.invoice_id = v.id) then
    raise exception 'Une facture compte au moins une ligne.' using errcode = 'P0001', hint = 'lines';
  end if;
  if exists (select 1 from public.invoice_lines l where l.invoice_id = v.id and l.unit_price_cents is null) then
    raise exception 'Indiquez le montant de chaque ligne « montant saisi à la facture ».' using errcode = 'P0001', hint = 'price_missing';
  end if;
  if not private.billing_payer_allowed(v_org, v.client_id, v.payer_client_id) then
    raise exception 'Cette personne ne peut plus recevoir les factures de ce client : choisissez un autre payeur.' using errcode = 'P0001', hint = 'payer';
  end if;
  perform private.billing_check_client(v_org, v.client_id);
  perform private.billing_recompute(v.id, v_today);
  v_seq := private.billing_next_number(v_org, 'invoice', v_year);
  v_number := v_year::text || '-' || v_seq::text;
  update public.invoices i
     set status = 'issued', number = v_number, year = v_year, seq = v_seq, issued_on = v_today, due_on = v_today,
         finalized_at = pg_catalog.now(), finalized_by = auth.uid()
   where i.id = v.id;
  return v_number;
end;
$$;

-- Credits a whole issued invoice (« NC-AAAA-N ») with a reason; its appointments may be invoiced
-- again (a correction: a credit note, then a new invoice). Returns the credit note's id.
create function public.issue_credit_note(p_invoice_id uuid, p_reason text)
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
  return v_id;
end;
$$;

-- The dossier's default payer from today (null: the client herself).
create function public.set_default_payer(p_client_id uuid, p_payer_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  v_payer uuid := coalesce(p_payer_client_id, p_client_id);
  v_today date := private.billing_today(v_org);
begin
  perform private.billing_check_client(v_org, p_client_id);
  if not private.billing_payer_allowed(v_org, p_client_id, v_payer) then
    raise exception 'Cette personne ne peut pas recevoir les factures de ce client : donnez-lui le droit « recevoir reçus et factures » dans ses proches.'
      using errcode = 'P0001', hint = 'payer';
  end if;
  insert into public.billing_payer_defaults (org_id, client_id, payer_client_id, effective_from, created_by)
  values (v_org, p_client_id, v_payer, v_today, auth.uid())
  on conflict (org_id, client_id, effective_from) do update set payer_client_id = excluded.payer_client_id, created_by = excluded.created_by;
end;
$$;

-- Where the numbering continues (GOrendezvous's last number of the year, at the cutover): never
-- below a number this app already gave (billing.settings).
create function public.set_invoice_sequence(p_year int, p_last_number int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.settings');
  v_used int;
begin
  if p_year is null or p_year not between 2000 and 2100 or p_last_number is null or p_last_number < 0 then
    raise exception 'Indiquez l''année et le dernier numéro utilisé.' using errcode = 'P0001', hint = 'last_number';
  end if;
  select max(i.seq) into v_used from public.invoices i where i.org_id = v_org and i.year = p_year;
  if v_used is not null and p_last_number < v_used then
    raise exception 'La facture %-% existe déjà : la numérotation ne peut pas reculer.', p_year, v_used using errcode = 'P0001', hint = 'last_number';
  end if;
  insert into public.invoice_sequences as s (org_id, kind, year, last_number)
  values (v_org, 'invoice', p_year, p_last_number)
  on conflict (org_id, kind, year) do update set last_number = excluded.last_number;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reads (billing.view)
-- -----------------------------------------------------------------------------
-- The invoices, newest first (keyset on the creation), by status and dossier, with the names.
create function public.list_invoices(p_status text default null, p_client_id uuid default null, p_before timestamptz default null, p_limit int default 50)
returns table (
  id uuid, number text, status text, client_id uuid, client_name text, client_number int, payer_client_id uuid, payer_name text,
  issued_on date, total_cents int, created_at timestamptz
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
    select v.id, v.number, v.status, v.client_id, c.display_name, c.client_number, v.payer_client_id, p.display_name,
           v.issued_on, v.total_cents, v.created_at
      from v
      left join names c on c.client_id = v.client_id
      left join names p on p.client_id = v.payer_client_id
     order by v.created_at desc;
end;
$$;

-- An invoice with its lines, its credit note, the names and who may be billed for it.
create function public.get_invoice(p_invoice_id uuid)
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
    'invoice', pg_catalog.to_jsonb(v),
    'client', (select pg_catalog.jsonb_build_object('id', f.client_id, 'name', f.display_name, 'client_number', f.client_number)
                 from private.clients_billing_facts(v_org, array[v.client_id]) f),
    'payer', (select pg_catalog.jsonb_build_object('id', f.client_id, 'name', f.display_name, 'client_number', f.client_number)
                from private.clients_billing_facts(v_org, array[v.payer_client_id]) f),
    'payer_options', private.billing_payer_options(v_org, v.client_id),
    'lines', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(l) order by l.position) from public.invoice_lines l where l.invoice_id = v.id), '[]'::jsonb),
    'credit_note', (select pg_catalog.to_jsonb(c) from public.credit_notes c where c.invoice_id = v.id));
end;
$$;

-- Who may be billed for a dossier: the client first, then the relations with the right.
create function private.billing_payer_options(p_org uuid, p_client_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'id', c.client_id, 'name', c.first_name || ' ' || c.last_name, 'is_self', c.is_self, 'relation', c.relation_type)
           order by c.is_self desc, c.first_name), '[]'::jsonb)
    from private.client_contacts_for(p_org, p_client_id, 'invoices') c
   where c.is_self or c.client_id is not null
$$;
revoke all on function private.billing_payer_options(uuid, uuid) from public, anon, authenticated, service_role;

-- A dossier's billing (Clients' « Visites et paiements »): the default payer and the choices,
-- the invoices, and the appointments of the last year not invoiced yet.
create function public.get_client_billing(p_client_id uuid)
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
    'invoices', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                  'id', i.id, 'number', i.number, 'status', i.status, 'issued_on', i.issued_on, 'total_cents', i.total_cents,
                  'payer_client_id', i.payer_client_id, 'created_at', i.created_at) order by i.created_at desc)
                  from public.invoices i where i.org_id = v_org and i.client_id = p_client_id), '[]'::jsonb),
    'to_invoice', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                  'appointment_id', a.appointment_id, 'starts_at', a.starts_at, 'state', a.state, 'service_id', a.service_id,
                  'professional_id', a.professional_id, 'first_client', a.client_ids[1] = p_client_id) order by a.starts_at desc)
                  from private.client_billable_appointments(v_org, p_client_id, v_today - 365) a
                 where a.starts_at < pg_catalog.now() + interval '1 day'
                   and not exists (select 1 from public.invoice_lines l
                                    where l.appointment_id = a.appointment_id and l.line_type = 'service' and not l.credited)), '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
-- For other modules (granted to no role; definer callers after their own check)
-- -----------------------------------------------------------------------------
-- A draft for a service outside the agenda (Demandes' waiting-list fee, a report): one line
-- priced today; the caller names its actor. Returns the draft's id.
create function private.billing_create_service_invoice(p_org uuid, p_client_id uuid, p_service_id uuid, p_source_id uuid, p_actor uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  v_id := private.billing_new_invoice(p_org, p_client_id, null, 'service', p_source_id, p_actor);
  perform private.billing_add_service_line(p_org, v_id, 'service', p_service_id, null, private.billing_today(p_org), null);
  perform private.billing_recompute(v_id, private.billing_today(p_org));
  return v_id;
end;
$$;
revoke all on function private.billing_create_service_invoice(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Clients' merge and anonymisation (data plug-ins, ADR 0003). Lane B's FQ adds its QuickBooks
-- part to these two functions (create or replace).
-- -----------------------------------------------------------------------------
create function private.billing_reassign_client(p_old uuid, p_new uuid)
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
         payer_kind = case when (case when i.payer_client_id = p_old then p_new else i.payer_client_id end) = p_new then 'client' else i.payer_kind end
   where i.client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.invoices i set payer_client_id = p_new,
         payer_kind = case when i.client_id = p_new then 'client' else 'relation' end
   where i.payer_client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  delete from public.billing_payer_defaults d
   where d.client_id = p_old
     and exists (select 1 from public.billing_payer_defaults k where k.client_id = p_new and k.effective_from = d.effective_from);
  update public.billing_payer_defaults d set client_id = p_new where d.client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.billing_payer_defaults d set payer_client_id = p_new where d.payer_client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  return v_total;
end;
$$;

-- An anonymisation keeps the invoices (accounting records, seven years) and their amounts, blanks
-- their free texts, and drops the dossier's default payers.
create function private.billing_anonymize_client(p_id uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_total int := 0;
  v_count int;
begin
  update public.invoices i set notes_client = null, notes_internal = null
   where (i.client_id = p_id or i.payer_client_id = p_id) and (i.notes_client is not null or i.notes_internal is not null);
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  delete from public.billing_payer_defaults d where d.client_id = p_id or d.payer_client_id = p_id;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  return v_total;
end;
$$;
revoke all on function private.billing_reassign_client(uuid, uuid), private.billing_anonymize_client(uuid)
  from public, anon, authenticated, service_role;

insert into public.client_merge_handlers (module_key, function_name)
values ('billing', 'private.billing_reassign_client')
on conflict do nothing;
insert into public.client_anonymize_handlers (module_key, function_name)
values ('billing', 'private.billing_anonymize_client')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function
  public.create_invoice(uuid[], uuid, boolean, text, text),
  public.create_manual_invoice(uuid, uuid),
  public.add_invoice_line(uuid, text, uuid, text, numeric, int, boolean, uuid),
  public.set_invoice_line_price(uuid, int),
  public.remove_invoice_line(uuid),
  public.set_invoice_payer(uuid, uuid),
  public.set_invoice_notes(uuid, text, text),
  public.delete_invoice_draft(uuid),
  public.finalize_invoice(uuid),
  public.issue_credit_note(uuid, text),
  public.set_default_payer(uuid, uuid),
  public.set_invoice_sequence(int, int),
  public.list_invoices(text, uuid, timestamptz, int),
  public.get_invoice(uuid),
  public.get_client_billing(uuid)
from public, anon;
grant execute on function
  public.create_invoice(uuid[], uuid, boolean, text, text),
  public.create_manual_invoice(uuid, uuid),
  public.add_invoice_line(uuid, text, uuid, text, numeric, int, boolean, uuid),
  public.set_invoice_line_price(uuid, int),
  public.remove_invoice_line(uuid),
  public.set_invoice_payer(uuid, uuid),
  public.set_invoice_notes(uuid, text, text),
  public.delete_invoice_draft(uuid),
  public.finalize_invoice(uuid),
  public.issue_credit_note(uuid, text),
  public.set_default_payer(uuid, uuid),
  public.set_invoice_sequence(int, int),
  public.list_invoices(text, uuid, timestamptz, int),
  public.get_invoice(uuid),
  public.get_client_billing(uuid)
to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);

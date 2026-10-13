-- =============================================================================
-- Facturation, batch F2: the morning queue, payments, receipts, statements, documents and emails
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §8 (F2)
-- Answers:   docs/research/2026-10-12-christine-answers.md (5, 8, 10, 11)
-- Decisions: R-56 (the morning queue), R-60 (the supervisor on an intern's receipt), R-61, P3-40,
--            BI-7 … BI-12 (decisions log)
-- Needs:     *_professionals_supervisor.sql (receipt facts, client agreements), F1's billing_module
--
-- * The morning queue (R-56): the SQL job `billing.build_drafts` (hourly) turns the completed
--   sessions of the days before today (from the clinic's « File du matin à partir du », at most 14
--   days back) into draft invoices, once per appointment (`billing_queue_items`, so a draft
--   deleted is not built again: the session stays in the dossier's « à facturer »). A draft is
--   held (`hold_reason`) when the dossier has an « entente particulière » (`special_agreements`,
--   Christine's answer 8: « un ajustement ou une validation est nécessaire avant d'envoyer ») or
--   when a Professionnels agreement prices this professional's sessions for this dossier
--   (`client_agreement`), or by hand (« Mettre en attente », `manual`); a missing price or a payer
--   without an address shows as held too, computed live (`price_missing`, `payer_missing`). The
--   adjointe sends one draft or every ready one (`send_invoices`): each is finalised (`AAAA-N`)
--   and a delivery queued; a refusal for one leaves the others (a savepoint each: no number lost).
--   Imported history never enters the queue: nothing before the date the clinic sets.
-- * Documents (BI-10): every issued invoice, credit note, receipt and statement gets a PDF once
--   (`pdf_file_id`, purpose `billing_document`, kept), rendered by `billing-documents` from
--   `billing_document_for_service`; a resend reuses it (an issued document never changes).
--   `billing_deliveries` is the queue: claimed (`billing_deliveries_for_service`), finished
--   (`finish_billing_delivery_for_service`: three tries, then failed). An email goes only when
--   asked, to the payer's address, and never while the module is reserved for its testers (P3-40:
--   set aside `reserved`, the PDF still made); the send path holds it a second time (CC-14).
-- * Payments and receipts (BI-8, BI-9): a payment is for one invoice (an Interac transfer for two
--   invoices is two payments), at most its balance, in an active mode other than « Note de crédit »;
--   the receipt (`R-AAAA-N`, its own sequence) goes out on recording. The invoice keeps
--   `paid_cents` and `payment_status` (`unpaid`, `partial`, `paid`). A credit note on an invoice
--   with payments waits for F3's refunds (refused here).
-- * Statements: a dossier's year for one payer (« Relevé »): the invoices billed to that payer,
--   the credit notes and the payments, the balance; made on request, sent or only stored.
-- * QuickBooks (the outbox agreed with lane B): `billing_sync_events` gets `invoice_issued`,
--   `invoice_credited` and `payment_recorded` in the transaction that makes them (never for an
--   imported invoice); lane B's FQ part 2 reads `billing_sync_events_for_service`,
--   `private.billing_invoice_for_sync` / `billing_payment_for_sync` and marks them done.
-- * F1 functions replaced (same signatures): create_invoice (the shared builder), finalize_invoice
--   (a PDF delivery, no email), issue_credit_note (refused with payments; its PDF, emailed when the
--   invoice was), get_invoice, get_client_billing (payments, receipts, deliveries, the
--   agreement, the balance); list_invoices gains the payment state (return type: dropped, made
--   again). billing_add_service_line takes `p_allow_missing` (the queue keeps a session without a
--   grid price, its amount to type). The Clients handlers move and blank the new rows.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:billing_queue_payments', true);

-- -----------------------------------------------------------------------------
-- Settings, special agreements, the queue's memory
-- -----------------------------------------------------------------------------
create table public.billing_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  queue_from date,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id) on delete set null
);
create index billing_settings_updated_by_idx on public.billing_settings (updated_by);
create trigger billing_settings_set_updated_at before update on public.billing_settings
  for each row execute function private.set_updated_at();

create table public.special_agreements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  client_id uuid not null,
  note text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  ended_at timestamptz,
  ended_by uuid references public.profiles(user_id) on delete set null,
  constraint special_agreements_client_fkey foreign key (org_id, client_id) references public.clients (org_id, id),
  constraint special_agreements_note_check check (char_length(note) between 3 and 500),
  constraint special_agreements_active_check check (is_active = (ended_at is null))
);
create unique index special_agreements_one_active_idx on public.special_agreements (client_id) where is_active;
create index special_agreements_org_client_idx on public.special_agreements (org_id, client_id);
create index special_agreements_created_by_idx on public.special_agreements (created_by);
create index special_agreements_ended_by_idx on public.special_agreements (ended_by);

create table public.billing_queue_items (
  appointment_id uuid primary key,
  org_id uuid not null,
  invoice_id uuid,
  queued_on date not null,
  problem text,
  created_at timestamptz not null default now(),
  constraint billing_queue_items_appointment_fkey foreign key (org_id, appointment_id) references public.appointments (org_id, id),
  constraint billing_queue_items_invoice_fkey foreign key (org_id, invoice_id) references public.invoices (org_id, id)
    on delete set null (invoice_id),
  constraint billing_queue_items_problem_check check (problem is null or char_length(problem) <= 300)
);
create index billing_queue_items_org_invoice_idx on public.billing_queue_items (org_id, invoice_id);
create index billing_queue_items_org_day_idx on public.billing_queue_items (org_id, queued_on);

-- -----------------------------------------------------------------------------
-- Invoices and credit notes: the queue, the payments, the PDF
-- -----------------------------------------------------------------------------
alter table public.invoices
  add column queue_day date,
  add column hold_reason text,
  add column hold_note text,
  add column paid_cents int not null default 0,
  add column payment_status text not null default 'unpaid',
  add column pdf_file_id uuid references public.stored_files(id) on delete set null,
  add constraint invoices_hold_reason_check check (hold_reason in ('special_agreement', 'client_agreement', 'manual')),
  add constraint invoices_hold_draft_check check (hold_reason is null or status = 'draft'),
  add constraint invoices_hold_note_check check (hold_note is null or char_length(hold_note) <= 500),
  add constraint invoices_paid_check check (paid_cents >= 0 and paid_cents <= total_cents),
  add constraint invoices_payment_status_check check (payment_status in ('unpaid', 'partial', 'paid'));
create index invoices_org_queue_idx on public.invoices (org_id, queue_day) where status = 'draft' and queue_day is not null;
create index invoices_pdf_file_idx on public.invoices (pdf_file_id);

alter table public.credit_notes
  add column pdf_file_id uuid references public.stored_files(id) on delete set null,
  add constraint credit_notes_org_id_id_key unique (org_id, id);
create index credit_notes_pdf_file_idx on public.credit_notes (pdf_file_id);

alter table public.invoice_sequences drop constraint invoice_sequences_kind_check;
alter table public.invoice_sequences
  add constraint invoice_sequences_kind_check check (kind in ('invoice', 'credit_note', 'receipt'));

-- -----------------------------------------------------------------------------
-- Payments, receipts, statements, deliveries
-- -----------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  invoice_id uuid not null,
  payer_client_id uuid not null,
  mode_code text not null,
  amount_cents int not null,
  paid_on date not null,
  reference text,
  external_ref text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  constraint payments_org_id_id_key unique (org_id, id),
  constraint payments_org_external_ref_key unique (org_id, external_ref),
  constraint payments_invoice_fkey foreign key (org_id, invoice_id) references public.invoices (org_id, id),
  constraint payments_payer_fkey foreign key (org_id, payer_client_id) references public.clients (org_id, id),
  constraint payments_mode_fkey foreign key (org_id, mode_code) references public.payment_modes (org_id, code),
  constraint payments_amount_check check (amount_cents between 1 and 10000000),
  constraint payments_reference_check check (reference is null or char_length(reference) between 1 and 100)
);
create index payments_org_invoice_idx on public.payments (org_id, invoice_id);
create index payments_org_payer_idx on public.payments (org_id, payer_client_id);
create index payments_org_mode_idx on public.payments (org_id, mode_code);
create index payments_org_paid_on_idx on public.payments (org_id, paid_on);
create index payments_created_by_idx on public.payments (created_by);

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  payment_id uuid not null,
  invoice_id uuid not null,
  number text not null,
  year smallint not null,
  seq int not null,
  issued_on date not null,
  amount_cents int not null,
  pdf_file_id uuid references public.stored_files(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint receipts_org_id_id_key unique (org_id, id),
  constraint receipts_payment_key unique (payment_id),
  constraint receipts_org_number_key unique (org_id, number),
  constraint receipts_payment_fkey foreign key (org_id, payment_id) references public.payments (org_id, id),
  constraint receipts_invoice_fkey foreign key (org_id, invoice_id) references public.invoices (org_id, id),
  constraint receipts_number_format_check check (number ~ '^R-[0-9]{4}-[1-9][0-9]*$')
);
create index receipts_org_invoice_idx on public.receipts (org_id, invoice_id);
create index receipts_pdf_file_idx on public.receipts (pdf_file_id);

create table public.statements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  client_id uuid not null,
  payer_client_id uuid not null,
  year smallint not null,
  period_from date not null,
  period_to date not null,
  pdf_file_id uuid references public.stored_files(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  constraint statements_org_id_id_key unique (org_id, id),
  constraint statements_client_fkey foreign key (org_id, client_id) references public.clients (org_id, id),
  constraint statements_payer_fkey foreign key (org_id, payer_client_id) references public.clients (org_id, id),
  constraint statements_year_check check (year between 2000 and 2100),
  constraint statements_period_check check (period_to >= period_from)
);
create index statements_org_client_idx on public.statements (org_id, client_id, created_at desc);
create index statements_org_payer_idx on public.statements (org_id, payer_client_id);
create index statements_pdf_file_idx on public.statements (pdf_file_id);
create index statements_created_by_idx on public.statements (created_by);

create table public.billing_deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  kind text not null,
  invoice_id uuid,
  credit_note_id uuid,
  receipt_id uuid,
  statement_id uuid,
  send_email boolean not null,
  explicit boolean not null default false,
  status text not null default 'pending',
  attempts smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  email_status text,
  skip_reason text,
  email_log_id uuid references public.email_log(id) on delete set null,
  error_code text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  finished_at timestamptz,
  constraint billing_deliveries_invoice_fkey foreign key (org_id, invoice_id) references public.invoices (org_id, id) on delete cascade,
  constraint billing_deliveries_credit_note_fkey foreign key (org_id, credit_note_id) references public.credit_notes (org_id, id),
  constraint billing_deliveries_receipt_fkey foreign key (org_id, receipt_id) references public.receipts (org_id, id),
  constraint billing_deliveries_statement_fkey foreign key (org_id, statement_id) references public.statements (org_id, id),
  constraint billing_deliveries_kind_check check (
    (kind = 'invoice' and invoice_id is not null and credit_note_id is null and receipt_id is null and statement_id is null)
    or (kind = 'credit_note' and credit_note_id is not null and invoice_id is not null and receipt_id is null and statement_id is null)
    or (kind = 'receipt' and receipt_id is not null and invoice_id is not null and credit_note_id is null and statement_id is null)
    or (kind = 'statement' and statement_id is not null and invoice_id is null and credit_note_id is null and receipt_id is null)),
  constraint billing_deliveries_status_check check (status in ('pending', 'sending', 'done', 'failed')),
  constraint billing_deliveries_email_status_check check (email_status in ('sent', 'skipped', 'failed')),
  constraint billing_deliveries_skip_reason_check check (skip_reason in ('not_requested', 'no_email', 'reserved', 'module_disabled')),
  constraint billing_deliveries_error_check check (error_code is null or error_code ~ '^[a-z_]{1,60}$'),
  constraint billing_deliveries_attempts_check check (attempts between 0 and 20)
);
create index billing_deliveries_org_due_idx on public.billing_deliveries (org_id, next_attempt_at) where status in ('pending', 'sending');
create index billing_deliveries_org_invoice_idx on public.billing_deliveries (org_id, invoice_id);
create index billing_deliveries_org_credit_note_idx on public.billing_deliveries (org_id, credit_note_id);
create index billing_deliveries_org_receipt_idx on public.billing_deliveries (org_id, receipt_id);
create index billing_deliveries_org_statement_idx on public.billing_deliveries (org_id, statement_id);
create index billing_deliveries_email_log_idx on public.billing_deliveries (email_log_id);
create index billing_deliveries_created_by_idx on public.billing_deliveries (created_by);

-- The QuickBooks outbox (shape agreed with lane B's FQ, 2026-10-13): one row per event, written
-- in the transaction that makes it; lane B's job pushes it (paused until the cutover's go / no-go).
-- An operational log of ids: not audited (000_invariants), service role only.
create table public.billing_sync_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  invoice_id uuid not null,
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts int not null default 0,
  last_error_code text,
  constraint billing_sync_events_kind_check check (kind in ('invoice_issued', 'invoice_credited', 'payment_recorded', 'payment_refunded')),
  constraint billing_sync_events_error_check check (last_error_code ~ '^[a-z_]{1,40}$'),
  constraint billing_sync_events_entity_key unique (org_id, kind, entity_id)
);
create index billing_sync_events_pending_idx on public.billing_sync_events (org_id, id) where processed_at is null;
alter table public.billing_sync_events enable row level security;
revoke all on public.billing_sync_events from anon, authenticated;

-- -----------------------------------------------------------------------------
-- RLS, grants (select only), audit
-- -----------------------------------------------------------------------------
alter table public.billing_settings enable row level security;
alter table public.special_agreements enable row level security;
alter table public.billing_queue_items enable row level security;
alter table public.payments enable row level security;
alter table public.receipts enable row level security;
alter table public.statements enable row level security;
alter table public.billing_deliveries enable row level security;

revoke all on public.billing_settings, public.special_agreements, public.billing_queue_items, public.payments,
  public.receipts, public.statements, public.billing_deliveries from anon, authenticated;
grant select on public.billing_settings, public.special_agreements, public.billing_queue_items, public.payments,
  public.receipts, public.statements, public.billing_deliveries to authenticated;

create policy billing_settings_select on public.billing_settings
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.view')));
create policy special_agreements_select on public.special_agreements
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.view')));
create policy billing_queue_items_select on public.billing_queue_items
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.view')));
create policy payments_select on public.payments
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.view')));
create policy receipts_select on public.receipts
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.view')));
create policy statements_select on public.statements
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.view')));
create policy billing_deliveries_select on public.billing_deliveries
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.view')));

create trigger billing_settings_audit after insert or update or delete on public.billing_settings
  for each row execute function private.audit_trigger();
create trigger special_agreements_audit after insert or update or delete on public.special_agreements
  for each row execute function private.audit_trigger('note');
create trigger billing_queue_items_audit after insert or update or delete on public.billing_queue_items
  for each row execute function private.audit_trigger('problem');
create trigger payments_audit after insert or update or delete on public.payments
  for each row execute function private.audit_trigger('reference');
create trigger receipts_audit after insert or update or delete on public.receipts
  for each row execute function private.audit_trigger();
create trigger statements_audit after insert or update or delete on public.statements
  for each row execute function private.audit_trigger();
create trigger billing_deliveries_audit after insert or update or delete on public.billing_deliveries
  for each row execute function private.audit_trigger();

-- The documents' PDFs: system files only (no client uploads them: billing.settings is just the
-- strictest key), kept (an issued document is a record), read with billing.view.
insert into public.upload_purposes
  (key, module_key, bucket, upload_permission, view_permission, owner_permission, max_bytes, mime_types,
   max_image_side, retain_days)
values
  ('billing_document', 'billing', 'documents', 'billing.settings', 'billing.view', null, 10485760, array['application/pdf'], null, null)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Helpers (private, granted to no role)
-- -----------------------------------------------------------------------------
-- The payer's address for a dossier's invoices (null: none).
create function private.billing_payer_email(p_org uuid, p_client_id uuid, p_payer_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(pg_catalog.btrim(c.email), '')
    from private.client_contacts_for(p_org, p_client_id, 'invoices') c
   where c.client_id = p_payer_id
   order by c.is_self desc
   limit 1
$$;

-- A service line, priced by Services et tarifs (F1); with p_allow_missing a price to confirm (a
-- grid without a rate) is kept with its amount to type (the morning queue) instead of refused.
drop function private.billing_add_service_line(uuid, uuid, text, uuid, uuid, date, uuid, uuid);
create function private.billing_add_service_line(
  p_org uuid, p_invoice_id uuid, p_line_type text, p_service_id uuid, p_title_id uuid, p_on date, p_appointment_id uuid,
  p_professional_id uuid default null, p_allow_missing boolean default false
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
  v_missing boolean;
  v_id uuid;
begin
  select i.* into v from public.invoices i where i.id = p_invoice_id;
  select f.* into c from private.clients_billing_facts(p_org, array[v.client_id]) f;
  select x.* into p from private.service_price(p_org, p_service_id, p_title_id, c.rate_variant, p_on, c.tax_exempt) x;
  select f.code into s from private.service_booking_facts(p_org, p_service_id) f;
  if p.source is null then
    raise exception 'Ce service n''existe pas.' using errcode = 'P0001', hint = 'service_id';
  end if;
  v_missing := p.price_cents is null and p.source not in ('entered', 'free');
  if v_missing and not p_allow_missing then
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
          1, case when p.source = 'free' then 0 else p.price_cents end,
          case when v_missing then 'missing' else p.source end, coalesce(p.tax_rule, 'exempt'))
  returning id into v_id;
  return v_id;
end;
$$;

-- A draft for appointments of one dossier (F1's create_invoice, shared with the morning queue):
-- the session lines on their dates, the file opening on the dossier's first invoice.
create function private.billing_invoice_appointments(
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
  select b.file_opening_service_id into v_file_service from public.billing_policy_on(v_first_date) b;
  if v_file_service is not null and coalesce(p_file_opening,
       not exists (select 1 from public.invoices i where i.org_id = p_org and i.client_id = v_client and i.id <> v_id and i.status <> 'credited')) then
    perform private.billing_add_service_line(p_org, v_id, 'file_opening', v_file_service, null, v_first_date, null, null, p_allow_missing);
  end if;
  update public.invoices i
     set notes_client = nullif(pg_catalog.btrim(coalesce(p_notes_client, '')), ''),
         notes_internal = nullif(pg_catalog.btrim(coalesce(p_notes_internal, '')), '')
   where i.id = v_id;
  perform private.billing_recompute(v_id, private.billing_today(p_org));
  return v_id;
end;
$$;

-- The invoice's paid amount and payment state from its payments (a total of zero is paid).
create function private.billing_apply_payments(p_invoice_id uuid)
returns void
language sql
set search_path = ''
as $$
  update public.invoices i
     set paid_cents = x.paid,
         payment_status = case when i.status = 'draft' then 'unpaid'
                               when x.paid >= i.total_cents then 'paid'
                               when x.paid > 0 then 'partial' else 'unpaid' end
    from (select coalesce(sum(p.amount_cents), 0)::int as paid from public.payments p where p.invoice_id = p_invoice_id) x
   where i.id = p_invoice_id
$$;

-- Finalises a locked draft of the clinic (the checks of F1's finalize_invoice), returns its number.
create function private.billing_finalize(p_org uuid, p_invoice_id uuid, p_actor uuid)
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
  if not private.billing_payer_allowed(p_org, v.client_id, v.payer_client_id) then
    raise exception 'Cette personne ne peut plus recevoir les factures de ce client : choisissez un autre payeur.' using errcode = 'P0001', hint = 'payer';
  end if;
  perform private.billing_check_client(p_org, v.client_id);
  perform private.billing_recompute(v.id, v_today);
  v_seq := private.billing_next_number(p_org, 'invoice', v_year);
  v_number := v_year::text || '-' || v_seq::text;
  update public.invoices i
     set status = 'issued', number = v_number, year = v_year, seq = v_seq, issued_on = v_today, due_on = v_today,
         finalized_at = pg_catalog.now(), finalized_by = p_actor, hold_reason = null, hold_note = null
   where i.id = v.id;
  perform private.billing_apply_payments(v.id);
  perform private.billing_queue_sync(p_org, 'invoice_issued', v.id, v.id);
  return v_number;
end;
$$;

-- An event for QuickBooks (`billing_sync_events`), once per entity; never for GOrendezvous's
-- imported invoices (already in QuickBooks).
create function private.billing_queue_sync(p_org uuid, p_kind text, p_invoice_id uuid, p_entity uuid)
returns void
language sql
set search_path = ''
as $$
  insert into public.billing_sync_events (org_id, kind, invoice_id, entity_id)
  select p_org, p_kind, p_invoice_id, p_entity
   where not exists (select 1 from public.invoices i where i.id = p_invoice_id and i.source_type = 'import')
  on conflict (org_id, kind, entity_id) do nothing
$$;

-- Queues a document's delivery (its PDF; the email when asked). Returns the delivery's id.
create function private.billing_queue_delivery(p_org uuid, p_kind text, p_id uuid, p_send_email boolean, p_explicit boolean, p_actor uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_invoice uuid;
begin
  if p_kind = 'credit_note' then
    select c.invoice_id into v_invoice from public.credit_notes c where c.org_id = p_org and c.id = p_id;
  elsif p_kind = 'receipt' then
    select r.invoice_id into v_invoice from public.receipts r where r.org_id = p_org and r.id = p_id;
  end if;
  insert into public.billing_deliveries (org_id, kind, invoice_id, credit_note_id, receipt_id, statement_id, send_email, explicit, created_by)
  values (p_org, p_kind,
          case p_kind when 'invoice' then p_id when 'statement' then null else v_invoice end,
          case when p_kind = 'credit_note' then p_id end,
          case when p_kind = 'receipt' then p_id end,
          case when p_kind = 'statement' then p_id end,
          p_send_email, p_explicit, p_actor)
  returning id into v_id;
  return v_id;
end;
$$;

-- What holds a queued draft now: its stored hold, else a price to type, else a payer without an
-- address (null: ready).
create function private.billing_hold_now(p_invoice public.invoices)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(p_invoice.hold_reason,
    case when exists (select 1 from public.invoice_lines l where l.invoice_id = p_invoice.id and l.unit_price_cents is null)
           then 'price_missing' end,
    case when private.billing_payer_email(p_invoice.org_id, p_invoice.client_id, p_invoice.payer_client_id) is null
           then 'payer_missing' end)
$$;

revoke all on function private.billing_payer_email(uuid, uuid, uuid),
  private.billing_add_service_line(uuid, uuid, text, uuid, uuid, date, uuid, uuid, boolean),
  private.billing_invoice_appointments(uuid, uuid[], uuid, boolean, text, text, uuid, boolean),
  private.billing_apply_payments(uuid), private.billing_finalize(uuid, uuid, uuid),
  private.billing_queue_delivery(uuid, text, uuid, boolean, boolean, uuid), private.billing_hold_now(public.invoices),
  private.billing_queue_sync(uuid, text, uuid, uuid)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- F1 RPCs replaced (same signatures)
-- -----------------------------------------------------------------------------
create or replace function public.create_invoice(
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
begin
  return private.billing_invoice_appointments(v_org, p_appointment_ids, p_payer_client_id, p_file_opening,
                                              p_notes_client, p_notes_internal, auth.uid(), false);
end;
$$;

-- Finalises without sending: the PDF is made (a delivery without email).
create or replace function public.finalize_invoice(p_invoice_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  v public.invoices := private.billing_draft(p_invoice_id);
  v_number text;
begin
  v_number := private.billing_finalize(v_org, v.id, auth.uid());
  perform private.billing_queue_delivery(v_org, 'invoice', v.id, false, false, auth.uid());
  return v_number;
end;
$$;

-- Credits a whole issued invoice (F1); an invoice with payments waits for F3's refunds. Its PDF is
-- made, and emailed to the payer when the invoice was.
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

-- -----------------------------------------------------------------------------
-- Settings and special agreements
-- -----------------------------------------------------------------------------
create function public.get_billing_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.view');
begin
  return pg_catalog.jsonb_build_object('queue_from', (select s.queue_from from public.billing_settings s where s.org_id = v_org));
end;
$$;

-- The first day whose sessions the morning queue invoices (null: the queue is off). After the
-- cutover's day, so GOrendezvous's history never enters it.
create function public.set_billing_queue_from(p_queue_from date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.settings');
begin
  if p_queue_from is not null and p_queue_from < private.billing_today(v_org) - 14 then
    raise exception 'La file du matin commence au plus tôt il y a 14 jours.' using errcode = 'P0001', hint = 'queue_from';
  end if;
  insert into public.billing_settings as s (org_id, queue_from, updated_by)
  values (v_org, p_queue_from, auth.uid())
  on conflict (org_id) do update set queue_from = excluded.queue_from, updated_by = excluded.updated_by;
end;
$$;

-- The dossier's « entente particulière » (a note; null or blank ends it): its sessions stop in
-- the morning queue for validation.
create function public.set_special_agreement(p_client_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
begin
  perform private.billing_check_client(v_org, p_client_id);
  if v_note is not null and pg_catalog.char_length(v_note) not between 3 and 500 then
    raise exception 'La note de l''entente compte de 3 à 500 caractères.' using errcode = 'P0001', hint = 'note';
  end if;
  if v_note is not null and exists (select 1 from public.special_agreements a
                                     where a.org_id = v_org and a.client_id = p_client_id and a.is_active) then
    update public.special_agreements a set note = v_note
     where a.org_id = v_org and a.client_id = p_client_id and a.is_active and a.note <> v_note;
    return;
  end if;
  update public.special_agreements a set is_active = false, ended_at = pg_catalog.now(), ended_by = auth.uid()
   where a.org_id = v_org and a.client_id = p_client_id and a.is_active;
  if v_note is not null then
    insert into public.special_agreements (org_id, client_id, note, created_by) values (v_org, p_client_id, v_note, auth.uid());
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- The morning queue
-- -----------------------------------------------------------------------------
-- The queue's drafts: held first (stored or live), then by session date and dossier.
create function public.list_morning_queue()
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
    with q as (
      select i.*, private.billing_hold_now(i) as hold_now,
             (select min(f.local_date) from public.invoice_lines l
                join private.appointment_billing_facts(v_org, array[l.appointment_id]) f on true
               where l.invoice_id = i.id and l.appointment_id is not null) as service_date
        from public.invoices i
       where i.org_id = v_org and i.status = 'draft' and i.queue_day is not null
    ),
    names as (
      select n.* from private.clients_display_names(v_org, (select coalesce(pg_catalog.array_agg(distinct x), '{}')
                                                              from (select q.client_id x from q union select q.payer_client_id from q) y)) n
    )
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', q.id, 'queue_day', q.queue_day, 'service_date', q.service_date,
             'client_id', q.client_id, 'client_name', c.display_name, 'client_number', c.client_number,
             'payer_client_id', q.payer_client_id, 'payer_name', p.display_name,
             'payer_has_email', private.billing_payer_email(v_org, q.client_id, q.payer_client_id) is not null,
             'hold_reason', q.hold_now, 'hold_note', q.hold_note, 'total_cents', q.total_cents,
             'lines', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                         'id', l.id, 'line_type', l.line_type, 'description', l.description, 'professional_id', l.professional_id,
                         'unit_price_cents', l.unit_price_cents, 'total_cents', l.total_cents) order by l.position)
                         from public.invoice_lines l where l.invoice_id = q.id))
             order by (q.hold_now is null), q.service_date, c.display_name)
      from q
      left join names c on c.client_id = q.client_id
      left join names p on p.client_id = q.payer_client_id), '[]'::jsonb);
end;
$$;

-- « Mettre en attente » (a note, optional) / « Remettre dans la file » (the hold lifted, an
-- agreement's included: the adjointe validated it).
create function public.hold_invoice_draft(p_invoice_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  v public.invoices := private.billing_draft(p_invoice_id);
  v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
begin
  if v_note is not null and pg_catalog.char_length(v_note) > 500 then
    raise exception 'La note compte 500 caractères au plus.' using errcode = 'P0001', hint = 'note';
  end if;
  update public.invoices i set hold_reason = 'manual', hold_note = v_note where i.id = v.id and i.org_id = v_org;
end;
$$;

create function public.release_invoice_draft(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  v public.invoices := private.billing_draft(p_invoice_id);
begin
  update public.invoices i set hold_reason = null, hold_note = null where i.id = v.id and i.org_id = v_org and i.hold_reason is not null;
end;
$$;

-- « Envoyer » / « Tout envoyer »: each draft finalised and sent to its payer, an issued invoice
-- sent again; a refusal for one (held, a price to type, a payer without the right…) is answered
-- for that one and leaves the others (each in its own savepoint: no number is lost).
create function public.send_invoices(p_invoice_ids uuid[])
returns table (invoice_id uuid, number text, error text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.billing_require('billing.manage');
  v_id uuid;
  v public.invoices;
  v_number text;
  v_message text;
begin
  if coalesce(pg_catalog.cardinality(p_invoice_ids), 0) not between 1 and 100 then
    raise exception 'Choisissez de 1 à 100 factures.' using errcode = 'P0001', hint = 'invoice_ids';
  end if;
  for v_id in select distinct x from pg_catalog.unnest(p_invoice_ids) x loop
    begin
      select i.* into v from public.invoices i where i.org_id = v_org and i.id = v_id for update;
      if v.id is null then
        raise exception 'Facture introuvable.' using errcode = 'P0001';
      end if;
      if v.status = 'credited' then
        raise exception 'Cette facture est créditée : elle ne s''envoie plus.' using errcode = 'P0001';
      end if;
      if v.status = 'draft' then
        if v.hold_reason is not null then
          raise exception 'Ce brouillon est en attente : remettez-le dans la file avant de l''envoyer.' using errcode = 'P0001';
        end if;
        v_number := private.billing_finalize(v_org, v.id, auth.uid());
      else
        v_number := v.number;
      end if;
      perform private.billing_queue_delivery(v_org, 'invoice', v.id, true, v.status <> 'draft', auth.uid());
      invoice_id := v_id; number := v_number; error := null;
      return next;
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text;
      invoice_id := v_id; number := null; error := v_message;
      return next;
    end;
  end loop;
end;
$$;

-- Sends an issued document again to its payer (« Renvoyer »).
create function public.send_billing_document(p_kind text, p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
begin
  if p_kind not in ('invoice', 'credit_note', 'receipt', 'statement')
     or (p_kind = 'invoice' and not exists (select 1 from public.invoices i where i.org_id = v_org and i.id = p_id and i.status <> 'draft'))
     or (p_kind = 'credit_note' and not exists (select 1 from public.credit_notes c where c.org_id = v_org and c.id = p_id))
     or (p_kind = 'receipt' and not exists (select 1 from public.receipts r where r.org_id = v_org and r.id = p_id))
     or (p_kind = 'statement' and not exists (select 1 from public.statements s where s.org_id = v_org and s.id = p_id)) then
    raise exception 'Document introuvable.' using errcode = 'P0001', hint = 'document';
  end if;
  return private.billing_queue_delivery(v_org, p_kind, p_id, true, true, auth.uid());
end;
$$;

-- -----------------------------------------------------------------------------
-- Payments, receipts, statements
-- -----------------------------------------------------------------------------
-- A payment on an issued invoice (at most its balance; a mode of the clinic, active, not « Note
-- de crédit »; not in the future), with its receipt (`R-AAAA-N`) sent to the payer at once.
-- Returns the receipt's id.
create function public.record_payment(
  p_invoice_id uuid, p_mode_code text, p_amount_cents int, p_paid_on date default null, p_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  v public.invoices;
  v_today date := private.billing_today(v_org);
  v_paid_on date := coalesce(p_paid_on, v_today);
  v_reference text := nullif(pg_catalog.btrim(coalesce(p_reference, '')), '');
  v_year int := extract(year from v_today)::int;
  v_payment uuid;
  v_seq int;
  v_receipt uuid;
begin
  select i.* into v from public.invoices i where i.org_id = v_org and i.id = p_invoice_id for update;
  if v.id is null then
    raise exception 'Facture introuvable.' using errcode = 'P0001', hint = 'invoice_id';
  end if;
  if v.status <> 'issued' then
    raise exception 'Un paiement s''enregistre sur une facture finalisée, pas créditée.' using errcode = 'P0001', hint = 'status';
  end if;
  if not exists (select 1 from public.payment_modes m where m.org_id = v_org and m.code = p_mode_code and m.is_active and m.code <> 'credit_note') then
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
  insert into public.payments (org_id, invoice_id, payer_client_id, mode_code, amount_cents, paid_on, reference, created_by)
  values (v_org, v.id, v.payer_client_id, p_mode_code, p_amount_cents, v_paid_on, v_reference, auth.uid())
  returning id into v_payment;
  perform private.billing_apply_payments(v.id);
  perform private.billing_queue_sync(v_org, 'payment_recorded', v.id, v_payment);
  v_seq := private.billing_next_number(v_org, 'receipt', v_year);
  insert into public.receipts (org_id, payment_id, invoice_id, number, year, seq, issued_on, amount_cents)
  values (v_org, v_payment, v.id, 'R-' || v_year::text || '-' || v_seq::text, v_year, v_seq, v_today, p_amount_cents)
  returning id into v_receipt;
  perform private.billing_queue_delivery(v_org, 'receipt', v_receipt, true, false, auth.uid());
  return v_receipt;
end;
$$;

-- « 1 234,56 $ »: an amount in French, for refusals.
create function private.billing_format_money(p_cents int)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.replace(pg_catalog.replace(pg_catalog.btrim(pg_catalog.to_char(p_cents / 100.0, 'FM999G999G990D00')), ',', ' '), '.', ',')
      || ' $'
$$;
revoke all on function private.billing_format_money(int) from public, anon, authenticated, service_role;

-- A dossier's statement for a year and one payer (default: the dossier's default payer), stored;
-- emailed to the payer when p_send. Returns its id.
create function public.create_statement(p_client_id uuid, p_year int, p_payer_client_id uuid default null, p_send boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  v_today date := private.billing_today(v_org);
  v_payer uuid;
  v_id uuid;
begin
  perform private.billing_check_client(v_org, p_client_id);
  if p_year is null or p_year < 2000 or p_year > extract(year from v_today)::int then
    raise exception 'Choisissez une année passée ou l''année en cours.' using errcode = 'P0001', hint = 'year';
  end if;
  v_payer := coalesce(p_payer_client_id, private.billing_default_payer(v_org, p_client_id, v_today));
  if v_payer <> p_client_id
     and not private.billing_payer_allowed(v_org, p_client_id, v_payer)
     and not exists (select 1 from public.invoices i where i.org_id = v_org and i.client_id = p_client_id and i.payer_client_id = v_payer) then
    raise exception 'Cette personne ne reçoit pas les factures de ce client.' using errcode = 'P0001', hint = 'payer';
  end if;
  insert into public.statements (org_id, client_id, payer_client_id, year, period_from, period_to, created_by)
  values (v_org, p_client_id, v_payer, p_year, pg_catalog.make_date(p_year, 1, 1),
          least(pg_catalog.make_date(p_year, 12, 31), v_today), auth.uid())
  returning id into v_id;
  perform private.billing_queue_delivery(v_org, 'statement', v_id, coalesce(p_send, false), false, auth.uid());
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Documents (what a PDF prints)
-- -----------------------------------------------------------------------------
create function private.billing_clinic(p_org uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'name', o.name, 'legal_name', o.legal_name, 'address_line1', o.address_line1, 'address_line2', o.address_line2,
           'city', o.city, 'province', o.province, 'postal_code', o.postal_code, 'phone', o.phone, 'email', o.email,
           'website', o.website, 'gst_number', o.gst_number, 'qst_number', o.qst_number)
    from public.organizations o where o.id = p_org
$$;

create function private.billing_person(p_org uuid, p_client_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('id', f.client_id, 'name', f.display_name, 'first_name', f.first_name,
                                       'client_number', f.client_number, 'language', f.language)
    from private.clients_billing_facts(p_org, array[p_client_id]) f
$$;

-- An invoice's lines with the session's date and length, and the professionals they name.
create function private.billing_lines(p_org uuid, p_invoice_ids uuid[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  with l as (select x.* from public.invoice_lines x where x.org_id = p_org and x.invoice_id = any (p_invoice_ids)),
  f as (select y.* from private.appointment_billing_facts(p_org, (select coalesce(pg_catalog.array_agg(l.appointment_id), '{}') from l)) y)
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'invoice_id', l.invoice_id, 'position', l.position, 'line_type', l.line_type, 'description', l.description,
           'service_code', l.service_code, 'quantity', l.quantity, 'unit_price_cents', l.unit_price_cents, 'tax_rule', l.tax_rule,
           'subtotal_cents', l.subtotal_cents, 'gst_cents', l.gst_cents, 'qst_cents', l.qst_cents, 'total_cents', l.total_cents,
           'professional_id', l.professional_id, 'service_date', f.local_date,
           'minutes', case when f.appointment_id is not null then (extract(epoch from f.ends_at - f.starts_at) / 60)::int end)
           order by l.invoice_id, l.position), '[]'::jsonb)
    from l left join f on f.appointment_id = l.appointment_id
$$;

create function private.billing_professionals(p_org uuid, p_invoice_ids uuid[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by r.name), '[]'::jsonb)
    from private.professional_receipt_facts(p_org,
           (select coalesce(pg_catalog.array_agg(distinct l.professional_id), '{}') from public.invoice_lines l
             where l.org_id = p_org and l.invoice_id = any (p_invoice_ids) and l.professional_id is not null)) r
$$;

-- What a document prints (kind `invoice`, `credit_note`, `receipt`, `statement`); null when the
-- clinic has no such document. No address: the recipient is the service path's.
create function private.billing_document(p_org uuid, p_kind text, p_id uuid)
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
     where i.org_id = p_org and i.client_id = s.client_id and i.payer_client_id = s.payer_client_id and i.status <> 'draft'
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
      'qst_cents', v.qst_cents, 'total_cents', v.total_cents, 'paid_cents', v.paid_cents, 'notes_client', v.notes_client),
    'payment', case when p_kind = 'receipt' then pg_catalog.jsonb_build_object(
      'amount_cents', p.amount_cents, 'paid_on', p.paid_on,
      'mode', (select m.name from public.payment_modes m where m.org_id = p.org_id and m.code = p.mode_code)) end,
    'clinic', private.billing_clinic(p_org),
    'client', private.billing_person(p_org, v.client_id),
    'payer', private.billing_person(p_org, v.payer_client_id),
    'lines', private.billing_lines(p_org, array[v.id]),
    'professionals', private.billing_professionals(p_org, array[v.id]));
end;
$$;
revoke all on function private.billing_clinic(uuid), private.billing_person(uuid, uuid), private.billing_lines(uuid, uuid[]),
  private.billing_professionals(uuid, uuid[]), private.billing_document(uuid, text, uuid)
  from public, anon, authenticated, service_role;

-- A document for the caller's preview (billing.view): a draft invoice too; with the clinic's logo.
create function public.get_billing_document(p_kind text, p_id uuid)
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
    'document', private.billing_document(v_org, p_kind, p_id),
    'logo', (select pg_catalog.jsonb_build_object('bucket', f.bucket, 'object_path', f.object_path)
               from public.organizations o join public.stored_files f on f.id = o.logo_file_id and f.status = 'ready'
              where o.id = v_org));
end;
$$;

-- -----------------------------------------------------------------------------
-- The deliveries (service role, `billing-documents`)
-- -----------------------------------------------------------------------------
-- Claims the org's due deliveries (oldest first; a claim older than 10 minutes is taken again).
create function public.billing_deliveries_for_service(p_org_id uuid, p_limit int default 25)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  with due as (
    select d.id from public.billing_deliveries d
     where d.org_id = p_org_id
       and ((d.status = 'pending' and d.next_attempt_at <= pg_catalog.now())
            or (d.status = 'sending' and d.claimed_at < pg_catalog.now() - interval '10 minutes'))
     order by d.created_at
     limit least(greatest(coalesce(p_limit, 25), 1), 100)
     for update skip locked
  ), claimed as (
    update public.billing_deliveries d
       set status = 'sending', claimed_at = pg_catalog.now(), attempts = least(d.attempts + 1, 20)
      from due where d.id = due.id
    returning d.id, d.created_at
  )
  select coalesce(pg_catalog.array_agg(claimed.id order by claimed.created_at), '{}') into v_ids from claimed;
  return v_ids;
end;
$$;

-- A claimed delivery: the document, the stored PDF (when made), the clinic's logo, and the email
-- to send (null: none, with the reason: not asked, the module reserved for its testers (P3-40),
-- no address). Null when the delivery is not claimed.
create function public.billing_document_for_service(p_org_id uuid, p_delivery_id uuid)
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
  v_doc_id := case d.kind when 'invoice' then d.invoice_id when 'credit_note' then d.credit_note_id
                          when 'receipt' then d.receipt_id else d.statement_id end;
  v_doc := private.billing_document(p_org_id, d.kind, v_doc_id);
  if v_doc is null then
    return null;
  end if;
  v_file := case d.kind
    when 'invoice' then (select i.pdf_file_id from public.invoices i where i.id = d.invoice_id)
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
    v_email := private.billing_payer_email(p_org_id, v_client, v_payer);
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
    'skip_reason', v_skip);
end;
$$;

-- Ends a claimed delivery. p_file_id: the PDF this run stored (kept on the document unless it has
-- one already: then this one is discarded). p_error: a code, tried again (10, 20 minutes), then
-- failed at the third try (`rate_limited` is no try: again in 2 minutes). Else done, with the
-- email's outcome.
create function public.finish_billing_delivery_for_service(
  p_org_id uuid, p_delivery_id uuid, p_file_id uuid, p_email_status text, p_skip_reason text, p_email_log_id uuid, p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.billing_deliveries;
  v_doc_id uuid;
  v_kept uuid;
begin
  select x.* into d from public.billing_deliveries x where x.org_id = p_org_id and x.id = p_delivery_id and x.status = 'sending' for update;
  if d.id is null then
    raise exception 'Unknown or unclaimed delivery' using errcode = '22023';
  end if;
  if (p_error is not null and p_error !~ '^[a-z_]{1,60}$')
     or (p_error is null and (p_email_status is null or p_email_status not in ('sent', 'skipped', 'failed')))
     or (p_email_status = 'skipped' and (p_skip_reason is null or p_skip_reason not in ('not_requested', 'no_email', 'reserved', 'module_disabled'))) then
    raise exception 'Invalid outcome' using errcode = '22023';
  end if;
  v_doc_id := case d.kind when 'invoice' then d.invoice_id when 'credit_note' then d.credit_note_id
                          when 'receipt' then d.receipt_id else d.statement_id end;
  if p_file_id is not null then
    if not exists (select 1 from public.stored_files f
                    where f.id = p_file_id and f.org_id = p_org_id and f.purpose = 'billing_document' and f.status = 'ready'
                      and f.subject_id = v_doc_id) then
      raise exception 'Unknown file' using errcode = '22023';
    end if;
    if d.kind = 'invoice' then
      update public.invoices i set pdf_file_id = p_file_id where i.id = v_doc_id and i.pdf_file_id is null returning i.pdf_file_id into v_kept;
    elsif d.kind = 'credit_note' then
      update public.credit_notes c set pdf_file_id = p_file_id where c.id = v_doc_id and c.pdf_file_id is null returning c.pdf_file_id into v_kept;
    elsif d.kind = 'receipt' then
      update public.receipts r set pdf_file_id = p_file_id where r.id = v_doc_id and r.pdf_file_id is null returning r.pdf_file_id into v_kept;
    else
      update public.statements s set pdf_file_id = p_file_id where s.id = v_doc_id and s.pdf_file_id is null returning s.pdf_file_id into v_kept;
    end if;
    if v_kept is null then
      perform private.soft_delete_stored_file(p_file_id, null);
    end if;
  end if;
  if p_error = 'rate_limited' then
    -- The send path's per-address limit (two documents to one parent in a minute): not a try.
    update public.billing_deliveries x
       set status = 'pending', attempts = greatest(x.attempts - 1, 0), next_attempt_at = pg_catalog.now() + interval '2 minutes',
           error_code = p_error, claimed_at = null
     where x.id = d.id;
  elsif p_error is not null then
    update public.billing_deliveries x
       set status = case when x.attempts >= 3 then 'failed' else 'pending' end,
           next_attempt_at = pg_catalog.now() + pg_catalog.make_interval(mins => 10 * x.attempts),
           error_code = p_error, claimed_at = null,
           finished_at = case when x.attempts >= 3 then pg_catalog.now() end
     where x.id = d.id;
  else
    update public.billing_deliveries x
       set status = 'done', email_status = p_email_status,
           skip_reason = case when p_email_status = 'skipped' then p_skip_reason end,
           email_log_id = p_email_log_id, error_code = null, claimed_at = null, finished_at = pg_catalog.now()
     where x.id = d.id;
  end if;
end;
$$;

-- A PDF registered by this run whose upload failed: soft-deleted (a billing file the documents do
-- not hold only).
create function public.discard_billing_file_for_service(p_org_id uuid, p_file_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.stored_files f
              where f.id = p_file_id and f.org_id = p_org_id and f.purpose = 'billing_document' and f.status = 'ready')
     and not exists (select 1 from public.invoices i where i.pdf_file_id = p_file_id)
     and not exists (select 1 from public.credit_notes c where c.pdf_file_id = p_file_id)
     and not exists (select 1 from public.receipts r where r.pdf_file_id = p_file_id)
     and not exists (select 1 from public.statements s where s.pdf_file_id = p_file_id) then
    perform private.soft_delete_stored_file(p_file_id, null);
  end if;
end;
$$;

revoke all on function public.billing_deliveries_for_service(uuid, int), public.billing_document_for_service(uuid, uuid),
  public.finish_billing_delivery_for_service(uuid, uuid, uuid, text, text, uuid, text),
  public.discard_billing_file_for_service(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.billing_deliveries_for_service(uuid, int), public.billing_document_for_service(uuid, uuid),
  public.finish_billing_delivery_for_service(uuid, uuid, uuid, text, text, uuid, text),
  public.discard_billing_file_for_service(uuid, uuid)
  to service_role;

-- -----------------------------------------------------------------------------
-- Reads replaced: the payment state, payments, receipts, deliveries
-- -----------------------------------------------------------------------------
drop function public.list_invoices(text, uuid, timestamptz, int);
create function public.list_invoices(p_status text default null, p_client_id uuid default null, p_before timestamptz default null, p_limit int default 50)
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
    select v.id, v.number, v.status, v.client_id, c.display_name, c.client_number, v.payer_client_id, p.display_name,
           v.issued_on, v.total_cents, v.paid_cents, v.payment_status, v.created_at
      from v
      left join names c on c.client_id = v.client_id
      left join names p on p.client_id = v.payer_client_id
     order by v.created_at desc;
end;
$$;

-- The deliveries of a document, newest first (what the screens show: sent, set aside, failed).
create function private.billing_delivery_list(p_org uuid, p_kind text, p_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'id', d.id, 'status', d.status, 'send_email', d.send_email, 'email_status', d.email_status,
           'skip_reason', d.skip_reason, 'error_code', d.error_code, 'created_at', d.created_at, 'finished_at', d.finished_at)
           order by d.created_at desc), '[]'::jsonb)
    from public.billing_deliveries d
   where d.org_id = p_org and d.kind = p_kind
     and p_id = case p_kind when 'invoice' then d.invoice_id when 'credit_note' then d.credit_note_id
                            when 'receipt' then d.receipt_id else d.statement_id end
$$;
revoke all on function private.billing_delivery_list(uuid, text, uuid) from public, anon, authenticated, service_role;

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
                                                                       'payer_has_email', private.billing_payer_email(v_org, v.client_id, v.payer_client_id) is not null),
    'client', (select pg_catalog.jsonb_build_object('id', f.client_id, 'name', f.display_name, 'client_number', f.client_number)
                 from private.clients_billing_facts(v_org, array[v.client_id]) f),
    'payer', (select pg_catalog.jsonb_build_object('id', f.client_id, 'name', f.display_name, 'client_number', f.client_number)
                from private.clients_billing_facts(v_org, array[v.payer_client_id]) f),
    'payer_options', private.billing_payer_options(v_org, v.client_id),
    'lines', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(l) order by l.position) from public.invoice_lines l where l.invoice_id = v.id), '[]'::jsonb),
    'credit_note', (select pg_catalog.to_jsonb(c) || pg_catalog.jsonb_build_object('deliveries', private.billing_delivery_list(v_org, 'credit_note', c.id))
                      from public.credit_notes c where c.invoice_id = v.id),
    'payments', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                  'id', p.id, 'mode_code', p.mode_code, 'mode', m.name, 'amount_cents', p.amount_cents, 'paid_on', p.paid_on,
                  'reference', p.reference, 'receipt_id', r.id, 'receipt_number', r.number, 'receipt_file_id', r.pdf_file_id,
                  'receipt_deliveries', private.billing_delivery_list(v_org, 'receipt', r.id)) order by p.paid_on, p.created_at)
                  from public.payments p
                  join public.payment_modes m on m.org_id = p.org_id and m.code = p.mode_code
                  left join public.receipts r on r.payment_id = p.id
                 where p.invoice_id = v.id), '[]'::jsonb),
    'deliveries', private.billing_delivery_list(v_org, 'invoice', v.id),
    'payment_modes', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('code', m.code, 'name', m.name) order by m.sort_order)
                                 from public.payment_modes m where m.org_id = v_org and m.is_active and m.code <> 'credit_note'), '[]'::jsonb));
end;
$$;

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
                                where i.org_id = v_org and i.client_id = p_client_id and i.status = 'issued'), 0),
    'invoices', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                  'id', i.id, 'number', i.number, 'status', i.status, 'issued_on', i.issued_on, 'total_cents', i.total_cents,
                  'paid_cents', i.paid_cents, 'payment_status', i.payment_status,
                  'payer_client_id', i.payer_client_id, 'created_at', i.created_at) order by i.created_at desc)
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

-- -----------------------------------------------------------------------------
-- QuickBooks (lane B's FQ part 2 reads these; granted to no role, or service role)
-- -----------------------------------------------------------------------------
-- An invoice as QuickBooks needs it: number, dates, the dossier and the payer, the lines (service
-- code, amounts, TPS, TVQ), the totals, its credit note. Null for another clinic's.
create function private.billing_invoice_for_sync(p_org uuid, p_invoice_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'id', i.id, 'number', i.number, 'status', i.status, 'issued_on', i.issued_on, 'due_on', i.due_on,
           'client_id', i.client_id, 'payer_client_id', i.payer_client_id, 'payer_kind', i.payer_kind, 'source_type', i.source_type,
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

-- A payment as QuickBooks needs it: amount, day, the mode's code, the invoice, the payer.
create function private.billing_payment_for_sync(p_org uuid, p_payment_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'id', p.id, 'invoice_id', p.invoice_id, 'invoice_number', i.number, 'client_id', i.client_id,
           'payer_client_id', p.payer_client_id, 'mode_code', p.mode_code, 'amount_cents', p.amount_cents, 'paid_on', p.paid_on,
           'external_ref', p.external_ref)
    from public.payments p join public.invoices i on i.id = p.invoice_id
   where p.org_id = p_org and p.id = p_payment_id
$$;
revoke all on function private.billing_invoice_for_sync(uuid, uuid), private.billing_payment_for_sync(uuid, uuid)
  from public, anon, authenticated, service_role;

-- The org's events not processed yet, oldest first.
create function public.billing_sync_events_for_service(p_org_id uuid, p_limit int default 50)
returns table (id bigint, kind text, invoice_id uuid, entity_id uuid, attempts int, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.kind, e.invoice_id, e.entity_id, e.attempts, e.created_at
    from public.billing_sync_events e
   where e.org_id = p_org_id and e.processed_at is null
   order by e.id
   limit least(greatest(coalesce(p_limit, 50), 1), 500)
$$;

-- An event pushed (p_error_code null: processed) or not (a code: one more try, left pending).
create function public.finish_billing_sync_event_for_service(p_org_id uuid, p_id bigint, p_error_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_error_code is not null and p_error_code !~ '^[a-z_]{1,40}$' then
    raise exception 'Invalid error code' using errcode = '22023';
  end if;
  update public.billing_sync_events e
     set processed_at = case when p_error_code is null then pg_catalog.now() end,
         attempts = e.attempts + case when p_error_code is null then 0 else 1 end,
         last_error_code = p_error_code
   where e.org_id = p_org_id and e.id = p_id and e.processed_at is null;
  if not found then
    raise exception 'Unknown or processed event' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.billing_sync_events_for_service(uuid, int), public.finish_billing_sync_event_for_service(uuid, bigint, text)
  from public, anon, authenticated;
grant execute on function public.billing_sync_events_for_service(uuid, int), public.finish_billing_sync_event_for_service(uuid, bigint, text)
  to service_role;

-- -----------------------------------------------------------------------------
-- The job: the morning queue's drafts
-- -----------------------------------------------------------------------------
-- Per clinic with the module on and a « File du matin à partir du »: the completed sessions of
-- the days before today (from that date, at most 14 days back) not queued yet and not invoiced
-- become drafts, held for an agreement; a refusal (a merged dossier, a payer without the right…)
-- is kept as the item's problem, and the session stays « à facturer ».
create function private.job_billing_build_drafts()
returns text
language plpgsql
set search_path = ''
as $$
declare
  o record;
  a record;
  v_today date;
  v_from date;
  v_id uuid;
  v public.invoices;
  v_note text;
  v_hold text;
  v_message text;
  v_built int := 0;
  v_held int := 0;
  v_failed int := 0;
begin
  for o in select s.org_id, s.queue_from, coalesce(g.timezone, 'America/Toronto') as tz
             from public.billing_settings s join public.organizations g on g.id = s.org_id
            where s.queue_from is not null and public.module_enabled_for_org(s.org_id, 'billing') loop
    v_today := (pg_catalog.now() at time zone o.tz)::date;
    v_from := greatest(o.queue_from, v_today - 14);
    continue when v_from >= v_today;
    for a in select distinct on (x.appointment_id) x.appointment_id, x.starts_at, x.professional_id, x.client_id
               from private.appointments_for_billing(o.org_id, v_from::timestamp at time zone o.tz, v_today::timestamp at time zone o.tz) x
              where x.state = 'completed' and x.role = 'client'
                and not exists (select 1 from public.billing_queue_items q where q.appointment_id = x.appointment_id)
                and not exists (select 1 from public.invoice_lines l
                                 where l.appointment_id = x.appointment_id and l.line_type = 'service' and not l.credited)
              order by x.appointment_id, x.starts_at loop
      begin
        v_id := private.billing_invoice_appointments(o.org_id, array[a.appointment_id], null, null, null, null, null, true);
        select i.* into v from public.invoices i where i.id = v_id;
        v_hold := null;
        v_note := null;
        select 'special_agreement', x.note into v_hold, v_note
          from public.special_agreements x where x.org_id = o.org_id and x.client_id = v.client_id and x.is_active;
        if v_hold is null then
          select 'client_agreement',
                 pg_catalog.left('Entente avec le professionnel : ' || private.billing_format_money(g.client_price_cents)
                                 || ' la séance de ' || g.duration || ' min' || coalesce(' — ' || g.note, ''), 500)
            into v_hold, v_note
            from private.professional_client_agreement_on(o.org_id, a.professional_id, v.client_id,
                                                          (a.starts_at at time zone o.tz)::date) g
           limit 1;
        end if;
        update public.invoices i set queue_day = v_today, hold_reason = v_hold, hold_note = v_note where i.id = v_id;
        insert into public.billing_queue_items (appointment_id, org_id, invoice_id, queued_on) values (a.appointment_id, o.org_id, v_id, v_today);
        v_built := v_built + 1;
        if v_hold is not null then
          v_held := v_held + 1;
        end if;
      exception when sqlstate 'P0001' then
        get stacked diagnostics v_message = message_text;
        insert into public.billing_queue_items (appointment_id, org_id, invoice_id, queued_on, problem)
        values (a.appointment_id, o.org_id, null, v_today, pg_catalog.left(v_message, 300));
        v_failed := v_failed + 1;
      end;
    end loop;
  end loop;
  return 'built=' || v_built || ' held=' || v_held || ' failed=' || v_failed;
end;
$$;
revoke all on function private.job_billing_build_drafts() from public, anon, authenticated, service_role;

insert into public.scheduled_jobs
  (key, module_key, label, description, kind, sql_function, cron_job_name, is_maintenance)
values
  ('billing.build_drafts', 'billing', 'File du matin',
   'Prépare chaque heure les brouillons de facture des séances réalisées les jours précédents, à partir de la date choisie dans Paramètres → Facturation.',
   'sql', 'private.job_billing_build_drafts', 'billing.build_drafts', true)
on conflict do nothing;
select cron.schedule('billing.build_drafts', '40 * * * *', $$select private.run_sql_job('billing.build_drafts')$$);

insert into public.scheduled_jobs
  (key, module_key, label, description, kind, function_name, sql_function, cron_job_name, local_hour, is_maintenance)
values
  ('billing.documents', 'billing', 'Factures, reçus et relevés',
   'Produit le PDF des factures, notes de crédit, reçus et relevés et les envoie aux payeurs. Toutes les 5 minutes (et aussitôt après un envoi).',
   'function', 'billing-documents', null, 'billing.documents', null, false)
on conflict do nothing;
select cron.schedule('billing.documents', '*/5 * * * *', $$select private.invoke_job_function('billing.documents')$$);

-- -----------------------------------------------------------------------------
-- Email templates (attachments: the document's PDF)
-- -----------------------------------------------------------------------------
insert into public.email_template_defaults
  (key, module_key, label, description, why_line, subject, body, button_label, variables, view_permission,
   recipient_mode, allows_attachments)
select x.key, 'billing', x.label, x.description, x.why_line, x.subject, x.body, null,
       (select pg_catalog.jsonb_agg(v.item order by v.ord) from (
          select 1 as ord, pg_catalog.jsonb_build_object('path', 'recipient.first_name', 'label', 'Prénom du payeur',
                   'sample', 'Camille', 'required', true, 'kind', 'text') as item
          union all select 2, pg_catalog.jsonb_build_object('path', 'client.first_name', 'label', 'Prénom du client',
                   'sample', 'Léa', 'required', true, 'kind', 'text')
          union all select 3, pg_catalog.jsonb_build_object('path', 'document.number', 'label', 'Numéro du document',
                   'sample', x.sample_number, 'required', true, 'kind', 'text') where x.key not like 'billing.statement%'
          union all select 4, pg_catalog.jsonb_build_object('path', 'document.amount', 'label', 'Montant',
                   'sample', x.sample_amount, 'required', true, 'kind', 'text')
          union all select 5, pg_catalog.jsonb_build_object('path', 'document.invoice_number', 'label', 'Numéro de la facture',
                   'sample', '2026-412', 'required', true, 'kind', 'text') where x.key like 'billing.receipt%' or x.key like 'billing.credit_note%'
          union all select 6, pg_catalog.jsonb_build_object('path', 'document.period', 'label', 'Période du relevé',
                   'sample', x.sample_period, 'required', true, 'kind', 'text') where x.key like 'billing.statement%'
          union all select 7, pg_catalog.jsonb_build_object('path', 'clinic.name', 'label', 'Nom de la clinique',
                   'sample', 'Clinique MANA', 'required', true, 'kind', 'text')
        ) v),
       'billing.view', 'subject', true
  from (values
    ('billing.invoice', 'Facture', 'Envoyée au payeur quand une facture part de la file du matin (ou est renvoyée), la facture en pièce jointe.',
     'Vous recevez ce courriel parce que vous êtes le payeur des services rendus à la clinique.',
     'Facture {{document.number}} — {{clinic.name}}',
     E'Bonjour {{recipient.first_name}},\n\n'
     'Voici la facture {{document.number}} pour les services rendus à {{client.first_name}}, d''un montant de {{document.amount}}. '
     'Vous la trouverez en pièce jointe.\n\n'
     'Pour toute question, répondez simplement à ce courriel.',
     '2026-412', '130,00 $', null),
    ('billing.invoice_en', 'Facture (anglais)', 'La facture, en anglais.',
     'You receive this email because you are the payer for services provided at the clinic.',
     'Invoice {{document.number}} — {{clinic.name}}',
     E'Hello {{recipient.first_name}},\n\n'
     'Here is invoice {{document.number}} for the services provided to {{client.first_name}}, in the amount of {{document.amount}}. '
     'It is attached to this email.\n\n'
     'If you have any questions, simply reply to this email.',
     '2026-412', '$130.00', null),
    ('billing.receipt', 'Reçu', 'Envoyé au payeur dès qu''un paiement est enregistré, le reçu en pièce jointe.',
     'Vous recevez ce courriel parce qu''un paiement a été enregistré à la clinique.',
     'Reçu {{document.number}} — {{clinic.name}}',
     E'Bonjour {{recipient.first_name}},\n\n'
     'Nous avons bien reçu votre paiement de {{document.amount}} pour la facture {{document.invoice_number}} '
     '(services rendus à {{client.first_name}}). Le reçu {{document.number}} est en pièce jointe.\n\n'
     'Merci !',
     'R-2026-87', '130,00 $', null),
    ('billing.receipt_en', 'Reçu (anglais)', 'Le reçu, en anglais.',
     'You receive this email because a payment was recorded at the clinic.',
     'Receipt {{document.number}} — {{clinic.name}}',
     E'Hello {{recipient.first_name}},\n\n'
     'We have received your payment of {{document.amount}} for invoice {{document.invoice_number}} '
     '(services provided to {{client.first_name}}). Receipt {{document.number}} is attached.\n\n'
     'Thank you!',
     'R-2026-87', '$130.00', null),
    ('billing.credit_note', 'Note de crédit', 'Envoyée au payeur quand une facture qu''il a reçue est créditée (une facture corrigée suit, s''il y a lieu).',
     'Vous recevez ce courriel parce qu''une facture qui vous a été envoyée est corrigée.',
     'Note de crédit {{document.number}} — {{clinic.name}}',
     E'Bonjour {{recipient.first_name}},\n\n'
     'La facture {{document.invoice_number}} (services rendus à {{client.first_name}}) est annulée par la note de crédit '
     '{{document.number}} de {{document.amount}}, en pièce jointe. Une facture corrigée suit, s''il y a lieu.\n\n'
     'Pour toute question, répondez simplement à ce courriel.',
     'NC-2026-3', '130,00 $', null),
    ('billing.credit_note_en', 'Note de crédit (anglais)', 'La note de crédit, en anglais.',
     'You receive this email because an invoice sent to you was corrected.',
     'Credit note {{document.number}} — {{clinic.name}}',
     E'Hello {{recipient.first_name}},\n\n'
     'Invoice {{document.invoice_number}} (services provided to {{client.first_name}}) is cancelled by credit note '
     '{{document.number}} of {{document.amount}}, attached. A corrected invoice follows, if needed.\n\n'
     'If you have any questions, simply reply to this email.',
     'NC-2026-3', '$130.00', null),
    ('billing.statement', 'Relevé', 'Envoyé au payeur sur demande : le relevé de l''année (factures, notes de crédit et paiements), en pièce jointe.',
     'Vous recevez ce courriel parce que vous avez demandé un relevé à la clinique.',
     'Relevé {{document.period}} — {{clinic.name}}',
     E'Bonjour {{recipient.first_name}},\n\n'
     'Voici le relevé des services rendus à {{client.first_name}} pour {{document.period}} : '
     '{{document.amount}} payés. Il est en pièce jointe.\n\n'
     'Pour toute question, répondez simplement à ce courriel.',
     '2026', '1 040,00 $', '2026'),
    ('billing.statement_en', 'Relevé (anglais)', 'Le relevé, en anglais.',
     'You receive this email because you asked the clinic for a statement.',
     'Statement {{document.period}} — {{clinic.name}}',
     E'Hello {{recipient.first_name}},\n\n'
     'Here is the statement of the services provided to {{client.first_name}} for {{document.period}}: '
     '{{document.amount}} paid. It is attached.\n\n'
     'If you have any questions, simply reply to this email.',
     '2026', '$1,040.00', '2026')
  ) as x(key, label, description, why_line, subject, body, sample_number, sample_amount, sample_period)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Clients' merge and anonymisation: F1's part, F2's new rows, FQ's QuickBooks part (lane B)
-- -----------------------------------------------------------------------------
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

create or replace function private.billing_anonymize_client(p_id uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_total int := 0;
  v_count int;
begin
  update public.invoices i set notes_client = null, notes_internal = null, hold_note = null
   where (i.client_id = p_id or i.payer_client_id = p_id)
     and (i.notes_client is not null or i.notes_internal is not null or i.hold_note is not null);
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  delete from public.billing_payer_defaults d where d.client_id = p_id or d.payer_client_id = p_id;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  -- F2: the payments' references, the agreements' notes.
  update public.payments p set reference = null where p.payer_client_id = p_id and p.reference is not null;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  delete from public.special_agreements a where a.client_id = p_id;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  -- FQ (20261013111236_billing_quickbooks): this app's copy of the customers matched to the person.
  update public.qbo_customers q
     set display_name = '(anonymisé)', given_name = null, family_name = null, company_name = null, email = null, phones = '{}'
    from public.qbo_customer_matches m
   where m.connection_id = q.connection_id and m.qbo_id = q.qbo_id and m.client_id = p_id
     and q.display_name <> '(anonymisé)';
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  return v_total;
end;
$$;
revoke all on function private.billing_reassign_client(uuid, uuid), private.billing_anonymize_client(uuid)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function
  public.get_billing_settings(),
  public.set_billing_queue_from(date),
  public.set_special_agreement(uuid, text),
  public.list_morning_queue(),
  public.hold_invoice_draft(uuid, text),
  public.release_invoice_draft(uuid),
  public.send_invoices(uuid[]),
  public.send_billing_document(text, uuid),
  public.record_payment(uuid, text, int, date, text),
  public.create_statement(uuid, int, uuid, boolean),
  public.get_billing_document(text, uuid),
  public.list_invoices(text, uuid, timestamptz, int)
from public, anon;
grant execute on function
  public.get_billing_settings(),
  public.set_billing_queue_from(date),
  public.set_special_agreement(uuid, text),
  public.list_morning_queue(),
  public.hold_invoice_draft(uuid, text),
  public.release_invoice_draft(uuid),
  public.send_invoices(uuid[]),
  public.send_billing_document(text, uuid),
  public.record_payment(uuid, text, int, date, text),
  public.create_statement(uuid, int, uuid, boolean),
  public.get_billing_document(text, uuid),
  public.list_invoices(text, uuid, timestamptz, int)
to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);

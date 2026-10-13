-- =============================================================================
-- Facturation, batch F3: reminders, the balance rule, cancellation fees, refunds
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §8 (F3)
-- Answers:   docs/research/2026-10-12-christine-answers.md (7, 9)
-- Decisions: R-58 (reminders, the balance rule), R-59 (the professional decides the fee), AP-6,
--            BI-14 … BI-18 (decisions log)
-- Needs:     *_services_billing_facts.sql, *_appointments_fee_facts.sql, F2's billing migration
--
-- * Reminders (R-58, BI-14): the SQL job `billing.follow_up` (hourly) emails the payer at 3, 5, 7
--   and 10 days after an unpaid invoice's due date (the clinic's days, Paramètres → Facturation),
--   once per step (`billing_dunning_runs`; a missed step is not sent late, only the latest due),
--   the invoice's PDF attached (`billing.reminder`, delivered by `billing-documents`, held while the
--   module is reserved for its testers, P3-40). Only invoices issued from « Relances à partir du »:
--   empty (the default), nothing is sent and nothing blocks, so GOrendezvous's imported balances
--   never send a reminder at the cutover.
-- * The balance rule (R-58, AP-6, BI-15): `private.client_has_balance` (Rendez-vous' stub, replaced
--   here) is true when the dossier has an invoice still unpaid the last reminder's day (10 days
--   after its due date by default) or later. `book_appointment` then refuses without an override.
--   That day, the staff (billing.view) and the invoice's professionals (billing.self, each her own
--   notice) are told once.
-- * Cancellation fees (R-59, BI-16): the same job lists the late cancellations and absences
--   (Rendez-vous' `appointments_fee_candidates`) from the queue's start date (at most 30 days
--   back) in `cancellation_fee_decisions`, `pending`. The professional decides (« Mon agenda »),
--   or the adjointe for her (`decide_cancellation_fee`): « Appliquer les frais » makes a draft in
--   the morning queue with one `cancellation_fee` line (the fee service, the session's price ×
--   the policy's first or next percent), « Ne pas facturer » waives it. A policy in `automatic`
--   mode applies it at once. `private.billing_paid_fees` (lane C's FPay stub, replaced here) lists
--   the fees paid in full, for the professional's 30 % (R-63).
-- * Refunds (BI-17): `refund_payment(payment, cents, reason)` up to what is left of a payment; a
--   card payment (`stripe`) waits for the provider (`pending_provider`, lane C's FS marks it
--   through `refunds_for_service` / `finish_refund_for_service`); the others are recorded at once.
--   A recorded refund lowers the invoice's paid amount, and goes to QuickBooks' outbox
--   (`payment_refunded`). An invoice refunded in full can then be credited.
-- * « Impayés » (BI-18): `list_overdue_invoices()`, the unpaid invoices past their due date with
--   their last reminder.
-- * Fixed on the way: the morning queue's drafts now get the file-opening fee (the job read the
--   policy through `billing_policy_on`, which needs a user).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:billing_follow_up', true);

-- -----------------------------------------------------------------------------
-- Settings: reminders and the balance rule
-- -----------------------------------------------------------------------------
alter table public.billing_settings
  add column dunning_from date,
  add column dunning_days smallint[] not null default '{3,5,7,10}',
  add column block_after_days smallint not null default 10,
  add constraint billing_settings_dunning_days_check check (
    pg_catalog.cardinality(dunning_days) between 1 and 6 and 0 < all (dunning_days) and 60 >= all (dunning_days)),
  add constraint billing_settings_block_after_check check (block_after_days between 1 and 90);

-- -----------------------------------------------------------------------------
-- Reminders
-- -----------------------------------------------------------------------------
create table public.billing_dunning_runs (
  org_id uuid not null,
  invoice_id uuid not null,
  step smallint not null,
  run_on date not null,
  delivery_id uuid references public.billing_deliveries(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint billing_dunning_runs_pkey primary key (invoice_id, step),
  constraint billing_dunning_runs_invoice_fkey foreign key (org_id, invoice_id) references public.invoices (org_id, id) on delete cascade,
  constraint billing_dunning_runs_step_check check (step between 1 and 60)
);
create index billing_dunning_runs_org_idx on public.billing_dunning_runs (org_id, run_on);
create index billing_dunning_runs_delivery_idx on public.billing_dunning_runs (delivery_id);

alter table public.billing_deliveries drop constraint billing_deliveries_kind_check;
alter table public.billing_deliveries add constraint billing_deliveries_kind_check check (
  (kind in ('invoice', 'reminder') and invoice_id is not null and credit_note_id is null and receipt_id is null and statement_id is null)
  or (kind = 'credit_note' and credit_note_id is not null and invoice_id is not null and receipt_id is null and statement_id is null)
  or (kind = 'receipt' and receipt_id is not null and invoice_id is not null and credit_note_id is null and statement_id is null)
  or (kind = 'statement' and statement_id is not null and invoice_id is null and credit_note_id is null and receipt_id is null));

-- -----------------------------------------------------------------------------
-- Cancellation fees decided by the professional
-- -----------------------------------------------------------------------------
create table public.cancellation_fee_decisions (
  appointment_id uuid primary key,
  org_id uuid not null,
  client_id uuid not null,
  professional_id uuid not null,
  kind text not null,
  status text not null default 'pending',
  fee_percent numeric(5, 2),
  amount_cents int,
  invoice_id uuid,
  decided_as text,
  decided_by uuid references public.profiles(user_id) on delete set null,
  decided_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  constraint cancellation_fee_decisions_appointment_fkey foreign key (org_id, appointment_id) references public.appointments (org_id, id),
  constraint cancellation_fee_decisions_client_fkey foreign key (org_id, client_id) references public.clients (org_id, id),
  constraint cancellation_fee_decisions_professional_fkey foreign key (org_id, professional_id) references public.professionals (org_id, id),
  constraint cancellation_fee_decisions_invoice_fkey foreign key (org_id, invoice_id) references public.invoices (org_id, id)
    on delete set null (invoice_id),
  constraint cancellation_fee_decisions_kind_check check (kind in ('late_cancellation', 'no_show')),
  constraint cancellation_fee_decisions_status_check check (status in ('pending', 'applied', 'waived')),
  constraint cancellation_fee_decisions_decided_check check ((status = 'pending') = (decided_at is null)
                                                             and (decided_as is null or decided_as in ('professional', 'staff', 'automatic'))),
  constraint cancellation_fee_decisions_note_check check (note is null or char_length(note) <= 500)
);
create index cancellation_fee_decisions_org_status_idx on public.cancellation_fee_decisions (org_id, status, created_at);
create index cancellation_fee_decisions_org_client_idx on public.cancellation_fee_decisions (org_id, client_id);
create index cancellation_fee_decisions_org_professional_idx on public.cancellation_fee_decisions (org_id, professional_id);
create index cancellation_fee_decisions_org_invoice_idx on public.cancellation_fee_decisions (org_id, invoice_id);
create index cancellation_fee_decisions_decided_by_idx on public.cancellation_fee_decisions (decided_by);
-- One live fee line per appointment (lane C's payroll counts it once).
create unique index invoice_lines_one_fee_idx on public.invoice_lines (appointment_id)
  where line_type = 'cancellation_fee' and appointment_id is not null and not credited;

-- -----------------------------------------------------------------------------
-- Refunds
-- -----------------------------------------------------------------------------
create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  payment_id uuid not null,
  invoice_id uuid not null,
  amount_cents int not null,
  reason text not null,
  status text not null,
  provider_ref text,
  error_code text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  processed_at timestamptz,
  constraint refunds_org_id_id_key unique (org_id, id),
  constraint refunds_payment_fkey foreign key (org_id, payment_id) references public.payments (org_id, id),
  constraint refunds_invoice_fkey foreign key (org_id, invoice_id) references public.invoices (org_id, id),
  constraint refunds_amount_check check (amount_cents between 1 and 10000000),
  constraint refunds_reason_check check (char_length(reason) between 3 and 500),
  constraint refunds_status_check check (status in ('recorded', 'pending_provider', 'failed')),
  constraint refunds_error_check check (error_code is null or error_code ~ '^[a-z_]{1,60}$'),
  constraint refunds_provider_ref_check check (provider_ref is null or char_length(provider_ref) <= 200)
);
create index refunds_org_payment_idx on public.refunds (org_id, payment_id);
create index refunds_org_invoice_idx on public.refunds (org_id, invoice_id);
create index refunds_org_pending_idx on public.refunds (org_id, created_at) where status = 'pending_provider';
create index refunds_created_by_idx on public.refunds (created_by);

-- -----------------------------------------------------------------------------
-- RLS, grants (select only), audit
-- -----------------------------------------------------------------------------
alter table public.billing_dunning_runs enable row level security;
alter table public.cancellation_fee_decisions enable row level security;
alter table public.refunds enable row level security;
revoke all on public.billing_dunning_runs, public.cancellation_fee_decisions, public.refunds from anon, authenticated;
grant select on public.billing_dunning_runs, public.cancellation_fee_decisions, public.refunds to authenticated;

create policy billing_dunning_runs_select on public.billing_dunning_runs
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.view')));
-- The staff, and a professional her own decisions (« Mon agenda »).
create policy cancellation_fee_decisions_select on public.cancellation_fee_decisions
  for select to authenticated
  using (org_id = (select private.current_user_org_id())
         and ((select private.has_permission('billing.view'))
              or ((select private.has_permission('billing.self')) and professional_id = (select private.current_professional_id()))));
create policy refunds_select on public.refunds
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.view')));

create trigger billing_dunning_runs_audit after insert or update or delete on public.billing_dunning_runs
  for each row execute function private.audit_trigger();
create trigger cancellation_fee_decisions_audit after insert or update or delete on public.cancellation_fee_decisions
  for each row execute function private.audit_trigger('note');
create trigger refunds_audit after insert or update or delete on public.refunds
  for each row execute function private.audit_trigger('reason');

-- -----------------------------------------------------------------------------
-- F1 / F2 functions replaced (same signatures)
-- -----------------------------------------------------------------------------
-- The queue's file opening: the policy of the clinic named (a job has no user).
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
  perform private.billing_recompute(v_id, private.billing_today(p_org));
  return v_id;
end;
$$;

-- The paid amount: the payments less the refunds made.
create or replace function private.billing_apply_payments(p_invoice_id uuid)
returns void
language sql
set search_path = ''
as $$
  update public.invoices i
     set paid_cents = x.paid,
         payment_status = case when i.status = 'draft' then 'unpaid'
                               when x.paid >= i.total_cents then 'paid'
                               when x.paid > 0 then 'partial' else 'unpaid' end
    from (select (coalesce((select sum(p.amount_cents) from public.payments p where p.invoice_id = p_invoice_id), 0)
                 - coalesce((select sum(r.amount_cents) from public.refunds r
                              where r.invoice_id = p_invoice_id and r.status = 'recorded'), 0))::int as paid) x
   where i.id = p_invoice_id
$$;

-- A reminder's delivery names its invoice.
create or replace function private.billing_queue_delivery(p_org uuid, p_kind text, p_id uuid, p_send_email boolean, p_explicit boolean, p_actor uuid)
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
          case p_kind when 'invoice' then p_id when 'reminder' then p_id when 'statement' then null else v_invoice end,
          case when p_kind = 'credit_note' then p_id end,
          case when p_kind = 'receipt' then p_id end,
          case when p_kind = 'statement' then p_id end,
          p_send_email, p_explicit, p_actor)
  returning id into v_id;
  return v_id;
end;
$$;

-- A reminder prints its invoice, and says its step, its days and the balance.
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
    'skip_reason', v_skip,
    'reminder', case when d.kind = 'reminder' then (
      select pg_catalog.jsonb_build_object('step', r.step, 'days', private.billing_today(p_org_id) - i.due_on,
                                           'balance_cents', i.total_cents - i.paid_cents)
        from public.billing_dunning_runs r join public.invoices i on i.id = r.invoice_id
       where r.delivery_id = d.id) end);
end;
$$;

-- A reminder's PDF is the invoice's.
create or replace function public.finish_billing_delivery_for_service(
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
  v_doc_id := case d.kind when 'invoice' then d.invoice_id when 'reminder' then d.invoice_id when 'credit_note' then d.credit_note_id
                          when 'receipt' then d.receipt_id else d.statement_id end;
  if p_file_id is not null then
    if not exists (select 1 from public.stored_files f
                    where f.id = p_file_id and f.org_id = p_org_id and f.purpose = 'billing_document' and f.status = 'ready'
                      and f.subject_id = v_doc_id) then
      raise exception 'Unknown file' using errcode = '22023';
    end if;
    if d.kind in ('invoice', 'reminder') then
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

-- The invoice with its refunds, reminders and fee.
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

-- Clients' merge and anonymisation: F1, F2, F3 and FQ's parts.
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
  -- F3: the decisions' notes, the refunds' reasons.
  update public.cancellation_fee_decisions c set note = null where c.client_id = p_id and c.note is not null;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.refunds f set reason = 'Anonymisé'
    from public.payments p where p.id = f.payment_id and p.payer_client_id = p_id and f.reason <> 'Anonymisé';
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

-- -----------------------------------------------------------------------------
-- Settings
-- -----------------------------------------------------------------------------
create or replace function public.get_billing_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.view');
  s public.billing_settings;
begin
  select x.* into s from public.billing_settings x where x.org_id = v_org;
  return pg_catalog.jsonb_build_object(
    'queue_from', s.queue_from,
    'dunning_from', s.dunning_from,
    'dunning_days', coalesce(pg_catalog.to_jsonb(s.dunning_days), '[3, 5, 7, 10]'::jsonb),
    'block_after_days', coalesce(s.block_after_days, 10));
end;
$$;

-- Reminders: from which issue date (null: off, and nothing blocks a booking), the days after the
-- due date, and the day a balance blocks a new appointment (billing.settings).
create function public.set_billing_dunning(p_dunning_from date, p_days int[], p_block_after_days int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.settings');
  v_days smallint[];
begin
  select coalesce(pg_catalog.array_agg(distinct x::smallint order by x::smallint), '{}') into v_days
    from pg_catalog.unnest(coalesce(p_days, '{}'::int[])) x;
  if pg_catalog.cardinality(v_days) not between 1 and 6 or exists (select 1 from pg_catalog.unnest(v_days) x where x not between 1 and 60) then
    raise exception 'Indiquez de 1 à 6 jours de relance, entre 1 et 60 jours après l''échéance.' using errcode = 'P0001', hint = 'dunning_days';
  end if;
  if p_block_after_days is null or p_block_after_days not between 1 and 90 then
    raise exception 'Le refus de rendez-vous commence entre 1 et 90 jours après l''échéance.' using errcode = 'P0001', hint = 'block_after_days';
  end if;
  insert into public.billing_settings as s (org_id, dunning_from, dunning_days, block_after_days, updated_by)
  values (v_org, p_dunning_from, v_days, p_block_after_days, auth.uid())
  on conflict (org_id) do update
    set dunning_from = excluded.dunning_from, dunning_days = excluded.dunning_days,
        block_after_days = excluded.block_after_days, updated_by = excluded.updated_by;
end;
$$;

-- -----------------------------------------------------------------------------
-- The balance rule (Rendez-vous' stub, replaced: R-58, AP-6)
-- -----------------------------------------------------------------------------
-- A dossier owes money when one of its invoices, issued from « Relances à partir du », is still
-- unpaid on the day the balance blocks (10 days after its due date by default) or later. Off with
-- the module, or without that date.
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
          and i.client_id = p_client_id and i.status = 'issued' and i.total_cents > i.paid_cents
          and i.issued_on >= s.dunning_from
          and i.due_on <= private.billing_today(p_org) - s.block_after_days)
$$;

-- -----------------------------------------------------------------------------
-- Cancellation fees (R-59)
-- -----------------------------------------------------------------------------
-- The fee for an appointment now: the policy's first percent for the dossier's first fee, its next
-- percent after one applied; the amount from the session's price (null: a price to type).
create function private.billing_fee_quote(p_org uuid, p_appointment_id uuid,
                                          out fee_percent numeric, out amount_cents int, out session_cents int)
language plpgsql
stable
set search_path = ''
as $$
declare
  a record;
  c record;
  b public.billing_policies;
  v_title uuid;
begin
  select f.* into a from private.appointment_billing_facts(p_org, array[p_appointment_id]) f;
  select f.* into c from private.clients_billing_facts(p_org, array[a.client_ids[1]]) f;
  select x.* into b from private.billing_policy_for(p_org, a.local_date) x;
  select (f.title_ids)[1] into v_title from private.professional_booking_facts(p_org, a.professional_id) f;
  select x.price_cents into session_cents
    from private.service_price(p_org, a.service_id, v_title, c.rate_variant, a.local_date, c.tax_exempt) x;
  fee_percent := case when exists (select 1 from public.cancellation_fee_decisions d
                                    where d.org_id = p_org and d.client_id = a.client_ids[1] and d.status = 'applied'
                                      and d.appointment_id <> p_appointment_id)
                      then coalesce(b.next_fee_percent, 100) else coalesce(b.first_fee_percent, 50) end;
  amount_cents := case when session_cents is null then null else pg_catalog.round(session_cents * fee_percent / 100)::int end;
end;
$$;

-- « Appliquer les frais »: a draft in the morning queue with the fee line (the clinic's fee
-- service, individual or couple, at the quote); the decision applied. Returns the draft's id.
create function private.billing_apply_fee(p_org uuid, p_appointment_id uuid, p_actor uuid, p_as text, p_note text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  d public.cancellation_fee_decisions;
  a record;
  q record;
  v_fee_service uuid;
  v_name text;
  v_code int;
  v_tax text;
  v_id uuid;
begin
  select x.* into d from public.cancellation_fee_decisions x where x.org_id = p_org and x.appointment_id = p_appointment_id for update;
  select f.* into a from private.appointment_billing_facts(p_org, array[p_appointment_id]) f;
  select x.* into q from private.billing_fee_quote(p_org, p_appointment_id) x;
  v_fee_service := private.service_id_by_key(p_org,
    case when pg_catalog.cardinality(a.client_ids) > 1 then 'late_cancellation_couple_family' else 'late_cancellation_individual' end);
  if v_fee_service is null then
    raise exception 'Le service des frais d''annulation n''existe pas dans Services et tarifs.' using errcode = 'P0001', hint = 'service';
  end if;
  select s.name into v_name from public.services_catalog s where s.org_id = p_org and s.id = v_fee_service;
  select f.code into v_code from private.service_booking_facts(p_org, v_fee_service) f;
  select coalesce(x.tax_rule, 'exempt') into v_tax from private.service_price(p_org, v_fee_service, null, null, a.local_date, false) x;
  v_id := private.billing_new_invoice(p_org, d.client_id, null, 'appointment', p_appointment_id, p_actor);
  insert into public.invoice_lines (org_id, invoice_id, position, line_type, appointment_id, professional_id, service_id, service_code,
                                    description, quantity, unit_price_cents, price_source, tax_rule)
  values (p_org, v_id, 1, 'cancellation_fee', p_appointment_id, d.professional_id, v_fee_service, v_code,
          pg_catalog.left(coalesce(v_name, 'Frais d''annulation') || ' ('
                          || pg_catalog.replace(pg_catalog.rtrim(pg_catalog.rtrim(q.fee_percent::text, '0'), '.'), '.', ',')
                          || ' %) — ' || private.format_date_fr(a.local_date), 300),
          1, q.amount_cents, case when q.amount_cents is null then 'missing' else 'fee' end, v_tax);
  perform private.billing_recompute(v_id, private.billing_today(p_org));
  update public.invoices i set queue_day = private.billing_today(p_org) where i.id = v_id;
  update public.cancellation_fee_decisions x
     set status = 'applied', fee_percent = q.fee_percent, amount_cents = q.amount_cents, invoice_id = v_id,
         decided_as = p_as, decided_by = p_actor, decided_at = pg_catalog.now(), note = p_note
   where x.appointment_id = p_appointment_id;
  return v_id;
end;
$$;

-- The professional decides (billing.self, her own appointment), or the staff for her
-- (billing.manage): « Appliquer les frais » (the draft's id) or « Ne pas facturer » (null).
create function public.decide_cancellation_fee(p_appointment_id uuid, p_apply boolean, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  d public.cancellation_fee_decisions;
  v_as text;
  v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
begin
  select x.* into d from public.cancellation_fee_decisions x where x.org_id = v_org and x.appointment_id = p_appointment_id for update;
  if private.has_permission('billing.manage') then
    v_as := 'staff';
  elsif private.has_permission('billing.self') and d.professional_id is not null and d.professional_id = private.current_professional_id() then
    v_as := 'professional';
  else
    raise exception 'Permission refusée : billing.manage' using errcode = '42501';
  end if;
  if d.appointment_id is null then
    raise exception 'Aucun frais d''annulation à décider pour ce rendez-vous.' using errcode = 'P0001', hint = 'appointment_id';
  end if;
  if d.status <> 'pending' then
    raise exception 'Les frais de ce rendez-vous sont déjà décidés.' using errcode = 'P0001', hint = 'status';
  end if;
  if v_note is not null and pg_catalog.char_length(v_note) > 500 then
    raise exception 'La note compte 500 caractères au plus.' using errcode = 'P0001', hint = 'note';
  end if;
  if p_apply then
    return private.billing_apply_fee(v_org, p_appointment_id, auth.uid(), v_as, v_note);
  end if;
  update public.cancellation_fee_decisions x
     set status = 'waived', decided_as = v_as, decided_by = auth.uid(), decided_at = pg_catalog.now(), note = v_note
   where x.appointment_id = p_appointment_id;
  return null;
end;
$$;

-- The decisions (pending first): the staff all (billing.view), a professional her own
-- (billing.self), with the appointment's day, the dossier, the professional and the fee now.
create function public.list_fee_decisions(p_status text default 'pending')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_pro uuid;
begin
  if private.has_permission('billing.view') then
    v_pro := null;
  elsif private.has_permission('billing.self') then
    v_pro := private.current_professional_id();
    if v_pro is null then
      return '[]'::jsonb;
    end if;
  else
    raise exception 'Permission refusée : billing.view' using errcode = '42501';
  end if;
  return coalesce((
    with d as (
      select x.* from public.cancellation_fee_decisions x
       where x.org_id = v_org and (v_pro is null or x.professional_id = v_pro) and (p_status is null or x.status = p_status)
       order by x.status = 'pending' desc, x.created_at desc
       limit 200
    ),
    f as (select y.* from private.appointment_billing_facts(v_org, (select coalesce(pg_catalog.array_agg(d.appointment_id), '{}') from d)) y),
    names as (select n.* from private.clients_display_names(v_org, (select coalesce(pg_catalog.array_agg(distinct d.client_id), '{}') from d)) n),
    pros as (select p.* from private.professional_display_names(v_org, (select coalesce(pg_catalog.array_agg(distinct d.professional_id), '{}') from d)) p)
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'appointment_id', d.appointment_id, 'kind', d.kind, 'status', d.status, 'starts_at', f.starts_at,
             'client_id', d.client_id, 'client_name', n.display_name, 'professional_id', d.professional_id,
             'professional_name', p.display_name, 'service_id', f.service_id,
             'fee_percent', coalesce(d.fee_percent, q.fee_percent), 'amount_cents', case when d.status = 'pending' then q.amount_cents else d.amount_cents end,
             'invoice_id', d.invoice_id, 'decided_as', d.decided_as, 'decided_at', d.decided_at, 'note', d.note)
             order by d.status = 'pending' desc, f.starts_at desc)
      from d
      left join f on f.appointment_id = d.appointment_id
      left join names n on n.client_id = d.client_id
      left join pros p on p.professional_id = d.professional_id
      left join lateral private.billing_fee_quote(v_org, d.appointment_id) q on d.status = 'pending'), '[]'::jsonb);
end;
$$;

-- The late cancellations and absences since the queue's start (at most 30 days back) become
-- pending decisions; a policy in `automatic` mode applies them at once. Returns how many were added.
create function private.billing_collect_fees(p_org uuid, p_today date)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_from date;
  v_tz text := coalesce((select o.timezone from public.organizations o where o.id = p_org), 'America/Toronto');
  c record;
  v_count int := 0;
begin
  select greatest(s.queue_from, p_today - 30) into v_from from public.billing_settings s where s.org_id = p_org and s.queue_from is not null;
  if v_from is null then
    return 0;
  end if;
  for c in select x.* from private.appointments_fee_candidates(p_org, v_from::timestamp at time zone v_tz, pg_catalog.now()) x
            where x.client_ids is not null
              and not exists (select 1 from public.cancellation_fee_decisions d where d.appointment_id = x.appointment_id) loop
    insert into public.cancellation_fee_decisions (appointment_id, org_id, client_id, professional_id, kind)
    values (c.appointment_id, p_org, c.client_ids[1], c.professional_id, c.kind)
    on conflict do nothing;
    v_count := v_count + 1;
    if (select b.fee_mode from private.billing_policy_for(p_org, c.local_date) b) = 'automatic' then
      begin
        perform private.billing_apply_fee(p_org, c.appointment_id, null, 'automatic', null);
      exception when sqlstate 'P0001' then
        null;  -- left pending: a person decides.
      end;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Lane C's FPay (stub replaced): the fee lines paid in full before p_paid_before, their amount
-- before taxes, paid on the day of the invoice's last payment.
create or replace function private.billing_paid_fees(p_org uuid, p_paid_before timestamptz)
returns table (appointment_id uuid, professional_id uuid, service_id uuid, amount_cents int, paid_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select l.appointment_id, l.professional_id, l.service_id, l.subtotal_cents, x.paid_at
    from public.invoice_lines l
    join public.invoices i on i.org_id = l.org_id and i.id = l.invoice_id
    cross join lateral (
      select (max(p.paid_on)::timestamp
              at time zone coalesce((select o.timezone from public.organizations o where o.id = p_org), 'America/Toronto')) as paid_at
        from public.payments p where p.invoice_id = i.id) x
   where l.org_id = p_org and l.line_type = 'cancellation_fee' and not l.credited and l.appointment_id is not null
     and i.status = 'issued' and i.payment_status = 'paid' and i.total_cents > 0
     and x.paid_at < p_paid_before
$$;

-- -----------------------------------------------------------------------------
-- Reminders (R-58)
-- -----------------------------------------------------------------------------
-- Per unpaid invoice past its due date (issued from « Relances à partir du »): the latest due step
-- not run yet is emailed (a missed earlier step is recorded, not sent late); on the day the
-- balance blocks a booking, the staff and the invoice's professionals are told, once. Returns how
-- many reminders were queued.
create function private.billing_run_dunning(p_org uuid, p_today date)
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
    if v_days >= i.block_after_days then
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

-- The job: per clinic with the module on, the fees to decide and the reminders due.
create function private.job_billing_follow_up()
returns text
language plpgsql
set search_path = ''
as $$
declare
  o record;
  v_fees int := 0;
  v_reminders int := 0;
begin
  for o in select s.org_id from public.billing_settings s where public.module_enabled_for_org(s.org_id, 'billing') loop
    v_fees := v_fees + private.billing_collect_fees(o.org_id, private.billing_today(o.org_id));
    v_reminders := v_reminders + private.billing_run_dunning(o.org_id, private.billing_today(o.org_id));
  end loop;
  return 'fees=' || v_fees || ' reminders=' || v_reminders;
end;
$$;

insert into public.scheduled_jobs
  (key, module_key, label, description, kind, sql_function, cron_job_name, is_maintenance)
values
  ('billing.follow_up', 'billing', 'Relances et frais d''annulation',
   'Chaque heure : envoie les relances des factures impayées aux jours choisis, prévient l''équipe et le professionnel quand un solde bloque les rendez-vous, et liste les annulations tardives et absences dont le professionnel décide les frais.',
   'sql', 'private.job_billing_follow_up', 'billing.follow_up', true)
on conflict do nothing;
select cron.schedule('billing.follow_up', '50 * * * *', $$select private.run_sql_job('billing.follow_up')$$);

-- « Impayés »: the unpaid invoices past their due date, the oldest first, with their last reminder.
create function public.list_overdue_invoices()
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
             'payer_client_id', v.payer_client_id, 'payer_name', p.display_name, 'issued_on', v.issued_on, 'due_on', v.due_on,
             'days', v_today - v.due_on, 'total_cents', v.total_cents, 'paid_cents', v.paid_cents,
             'balance_cents', v.total_cents - v.paid_cents,
             'last_step', (select max(r.step) from public.billing_dunning_runs r where r.invoice_id = v.id),
             'blocking', private.client_has_balance(v_org, v.client_id) and v_today - v.due_on >= v_block,
             'payer_has_email', private.billing_payer_email(v_org, v.client_id, v.payer_client_id) is not null)
             order by v.due_on, v.number)
      from v
      left join names c on c.client_id = v.client_id
      left join names p on p.client_id = v.payer_client_id), '[]'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- Refunds
-- -----------------------------------------------------------------------------
-- A refund recorded: the invoice's paid amount lowered, QuickBooks' outbox told.
create function private.billing_refund_recorded(p_org uuid, p_refund_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  f public.refunds;
begin
  update public.refunds r set status = 'recorded', processed_at = pg_catalog.now(), error_code = null
   where r.org_id = p_org and r.id = p_refund_id
  returning r.* into f;
  perform private.billing_apply_payments(f.invoice_id);
  perform private.billing_queue_sync(p_org, 'payment_refunded', f.invoice_id, f.id);
end;
$$;

-- A refund on a payment (billing.manage), at most what is left of it, with a reason: recorded at
-- once, or waiting for the card provider (a Stripe payment, lane C's FS). Returns its id.
create function public.refund_payment(p_payment_id uuid, p_amount_cents int, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  p public.payments;
  v_left int;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_id uuid;
begin
  select x.* into p from public.payments x where x.org_id = v_org and x.id = p_payment_id for update;
  if p.id is null then
    raise exception 'Paiement introuvable.' using errcode = 'P0001', hint = 'payment_id';
  end if;
  v_left := p.amount_cents - coalesce((select sum(r.amount_cents) from public.refunds r where r.payment_id = p.id and r.status <> 'failed'), 0);
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > v_left then
    raise exception 'Le remboursement va de 0,01 $ à ce qui reste du paiement (%).', private.billing_format_money(v_left)
      using errcode = 'P0001', hint = 'amount';
  end if;
  if v_reason is null or pg_catalog.char_length(v_reason) not between 3 and 500 then
    raise exception 'La raison du remboursement compte de 3 à 500 caractères.' using errcode = 'P0001', hint = 'reason';
  end if;
  insert into public.refunds (org_id, payment_id, invoice_id, amount_cents, reason, status, created_by)
  values (v_org, p.id, p.invoice_id, p_amount_cents, v_reason,
          'pending_provider', auth.uid())
  returning id into v_id;
  -- Every mode but a card through Stripe is refunded by the clinic itself: recorded at once.
  if p.mode_code <> 'stripe' then
    perform private.billing_refund_recorded(v_org, v_id);
  end if;
  return v_id;
end;
$$;

-- The org's card refunds waiting for the provider (lane C's FS), oldest first.
create function public.refunds_for_service(p_org_id uuid, p_limit int default 25)
returns table (id uuid, payment_id uuid, invoice_id uuid, amount_cents int, payment_external_ref text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.payment_id, r.invoice_id, r.amount_cents, p.external_ref, r.created_at
    from public.refunds r join public.payments p on p.id = r.payment_id
   where r.org_id = p_org_id and r.status = 'pending_provider'
   order by r.created_at
   limit least(greatest(coalesce(p_limit, 25), 1), 100)
$$;

-- The provider's outcome: done (recorded, with its reference) or failed (a code).
create function public.finish_refund_for_service(p_org_id uuid, p_refund_id uuid, p_ok boolean, p_provider_ref text, p_error_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ok is null or (not p_ok and (p_error_code is null or p_error_code !~ '^[a-z_]{1,60}$'))
     or (p_provider_ref is not null and pg_catalog.char_length(p_provider_ref) > 200) then
    raise exception 'Invalid outcome' using errcode = '22023';
  end if;
  update public.refunds r set provider_ref = p_provider_ref
   where r.org_id = p_org_id and r.id = p_refund_id and r.status = 'pending_provider';
  if not found then
    raise exception 'Unknown or settled refund' using errcode = '22023';
  end if;
  if p_ok then
    perform private.billing_refund_recorded(p_org_id, p_refund_id);
  else
    update public.refunds r set status = 'failed', error_code = p_error_code, processed_at = pg_catalog.now()
     where r.org_id = p_org_id and r.id = p_refund_id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- The reminder's email (the invoice's PDF attached)
-- -----------------------------------------------------------------------------
insert into public.email_template_defaults
  (key, module_key, label, description, why_line, subject, body, button_label, variables, view_permission,
   recipient_mode, allows_attachments)
select x.key, 'billing', x.label, x.description, x.why_line, x.subject, x.body, null,
       pg_catalog.jsonb_build_array(
         pg_catalog.jsonb_build_object('path', 'recipient.first_name', 'label', 'Prénom du payeur', 'sample', 'Camille', 'required', true, 'kind', 'text'),
         pg_catalog.jsonb_build_object('path', 'client.first_name', 'label', 'Prénom du client', 'sample', 'Léa', 'required', true, 'kind', 'text'),
         pg_catalog.jsonb_build_object('path', 'document.number', 'label', 'Numéro de la facture', 'sample', '2026-412', 'required', true, 'kind', 'text'),
         pg_catalog.jsonb_build_object('path', 'document.amount', 'label', 'Solde', 'sample', x.sample_amount, 'required', true, 'kind', 'text'),
         pg_catalog.jsonb_build_object('path', 'document.days', 'label', 'Jours depuis l''échéance', 'sample', '5', 'required', true, 'kind', 'text'),
         pg_catalog.jsonb_build_object('path', 'clinic.name', 'label', 'Nom de la clinique', 'sample', 'Clinique MANA', 'required', true, 'kind', 'text')),
       'billing.view', 'subject', true
  from (values
    ('billing.reminder', 'Rappel de paiement', 'Envoyé au payeur aux jours de relance choisis tant qu''une facture reste impayée, la facture en pièce jointe.',
     'Vous recevez ce courriel parce qu''une facture qui vous a été envoyée est impayée.',
     'Rappel : facture {{document.number}} — {{clinic.name}}',
     E'Bonjour {{recipient.first_name}},\n\n'
     'La facture {{document.number}} pour les services rendus à {{client.first_name}} est impayée depuis {{document.days}} jours : '
     'le solde est de {{document.amount}}. Vous la trouverez en pièce jointe.\n\n'
     'Si vous avez déjà payé, ne tenez pas compte de ce rappel. Pour toute question, répondez simplement à ce courriel.',
     '130,00 $'),
    ('billing.reminder_en', 'Rappel de paiement (anglais)', 'Le rappel de paiement, en anglais.',
     'You receive this email because an invoice sent to you is unpaid.',
     'Reminder: invoice {{document.number}} — {{clinic.name}}',
     E'Hello {{recipient.first_name}},\n\n'
     'Invoice {{document.number}} for the services provided to {{client.first_name}} has been unpaid for {{document.days}} days: '
     'the balance is {{document.amount}}. It is attached to this email.\n\n'
     'If you have already paid, please disregard this reminder. If you have any questions, simply reply to this email.',
     '$130.00')
  ) as x(key, label, description, why_line, subject, body, sample_amount)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function private.billing_fee_quote(uuid, uuid), private.billing_apply_fee(uuid, uuid, uuid, text, text),
  private.billing_collect_fees(uuid, date), private.billing_run_dunning(uuid, date), private.job_billing_follow_up(),
  private.billing_refund_recorded(uuid, uuid), private.billing_paid_fees(uuid, timestamptz), private.client_has_balance(uuid, uuid),
  private.billing_reassign_client(uuid, uuid), private.billing_anonymize_client(uuid)
  from public, anon, authenticated, service_role;

revoke all on function
  public.set_billing_dunning(date, int[], int),
  public.decide_cancellation_fee(uuid, boolean, text),
  public.list_fee_decisions(text),
  public.list_overdue_invoices(),
  public.refund_payment(uuid, int, text)
from public, anon;
grant execute on function
  public.set_billing_dunning(date, int[], int),
  public.decide_cancellation_fee(uuid, boolean, text),
  public.list_fee_decisions(text),
  public.list_overdue_invoices(),
  public.refund_payment(uuid, int, text)
to authenticated;

revoke all on function public.refunds_for_service(uuid, int), public.finish_refund_for_service(uuid, uuid, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.refunds_for_service(uuid, int), public.finish_refund_for_service(uuid, uuid, boolean, text, text)
  to service_role;

select pg_catalog.set_config('app.audit_source', '', true);

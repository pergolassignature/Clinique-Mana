-- =============================================================================
-- FP fixes from the parity audit (P10–P12, decisions FP-12 … FP-14)
-- =============================================================================
-- - P10 (FP-12): `save_client_payer` with no id refuses when the client already has an active
--   payer of that kind (it used to update that one silently: a second IVAC file replaced the first).
-- - P11 (FP-13): a PAE needs its file number to be complete: « Payeurs à compléter », the morning
--   queue's hold (`billing_payer_incomplete`) and a payer invoice by hand; a provider's file number
--   once among the active payers (a check in the RPC and a unique index).
-- - P12 (FP-14): `payments.note` (optional, 500 characters, audited redacted), `record_payment(…,
--   p_note)`, shown on the invoice page.
-- Additive: a column, an index (no active payer in production yet), `create or replace` of the
-- functions below; `record_payment` gains a parameter, so it is dropped and made again.

select pg_catalog.set_config('app.audit_source', 'migration:billing_payer_guards', true);

-- -----------------------------------------------------------------------------
-- Clients: a provider's file number once among the active PAE payers (P11)
-- -----------------------------------------------------------------------------
create unique index client_payers_pae_file_key on public.client_payers (org_id, pg_catalog.lower(organisation_name), pg_catalog.lower(file_number))
  where kind = 'pae' and is_active and file_number is not null;

-- -----------------------------------------------------------------------------
-- Facturation: a payment's note (P12)
-- -----------------------------------------------------------------------------
alter table public.payments
  add column note text,
  add constraint payments_note_check check (note is null or pg_catalog.char_length(note) between 1 and 500);
drop trigger payments_audit on public.payments;
create trigger payments_audit after insert or update or delete on public.payments
  for each row execute function private.audit_trigger('reference', 'note');

-- P10, P11: a new payer never replaces the active one; a PAE's file number once per provider (FP-12, FP-13).
create or replace function public.save_client_payer(p_client_id uuid, p_id uuid, p_kind text, p_organisation_name text, p_file_number text,
                                         p_session_amount_cents int, p_max_sessions int, p_max_amount_cents int,
                                         p_starts_on date, p_expires_on date, p_note text,
                                         p_coverage_percent int default null, p_renewal_month int default null,
                                         p_renewal_day int default null, p_prior_used_cents int default null,
                                         p_prior_used_sessions int default null, p_prior_used_on date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_org_name text := private.clients_text(p_organisation_name);
  v_file text := private.clients_text(p_file_number);
  v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  v_id uuid := p_id;
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  perform private.clients_lock(v_org, p_client_id);
  if p_kind is null or p_kind not in ('ivac', 'pae') then
    raise exception 'Le payeur est l''IVAC ou un PAE.' using errcode = 'P0001', hint = 'kind';
  end if;
  if p_kind = 'pae' and v_org_name is null then
    raise exception 'Indiquez le fournisseur du PAE.' using errcode = 'P0001', hint = 'organisation_name';
  end if;
  if v_org_name is not null and (pg_catalog.length(v_org_name) > 120 or not private.is_tidy_text(v_org_name)) then
    raise exception 'Le nom de l''organisme compte 120 caractères au plus.' using errcode = 'P0001', hint = 'organisation_name';
  end if;
  if p_kind = 'ivac' and v_file is null then
    raise exception 'Indiquez le numéro de dossier IVAC.' using errcode = 'P0001', hint = 'file_number';
  end if;
  if v_file is not null and (pg_catalog.length(v_file) > 60 or not private.is_tidy_text(v_file)) then
    raise exception 'Le numéro de dossier compte 60 caractères au plus.' using errcode = 'P0001', hint = 'file_number';
  end if;
  if p_kind = 'ivac' and exists (
       select 1 from public.client_payers x
        where x.org_id = v_org and x.kind = 'ivac' and x.is_active and pg_catalog.lower(x.file_number) = pg_catalog.lower(v_file)
          and x.client_id <> p_client_id) then
    raise exception 'Ce numéro de dossier IVAC est déjà au dossier d''un autre client.' using errcode = 'P0001', hint = 'file_number';
  end if;
  -- P11 (FP-13): a provider's file number once among the active PAE payers.
  if p_kind = 'pae' and v_file is not null and exists (
       select 1 from public.client_payers x
        where x.org_id = v_org and x.kind = 'pae' and x.is_active and pg_catalog.lower(x.organisation_name) = pg_catalog.lower(v_org_name)
          and pg_catalog.lower(x.file_number) = pg_catalog.lower(v_file) and x.client_id <> p_client_id) then
    raise exception 'Ce numéro de dossier du PAE est déjà au dossier d''un autre client.' using errcode = 'P0001', hint = 'file_number';
  end if;
  if p_session_amount_cents is not null and p_session_amount_cents not between 0 and 1000000 then
    raise exception 'Le montant par séance est compris entre 0 $ et 10 000 $.' using errcode = 'P0001', hint = 'session_amount_cents';
  end if;
  if p_coverage_percent is not null and p_coverage_percent not between 1 and 100 then
    raise exception 'La part couverte va de 1 %% à 100 %%.' using errcode = 'P0001', hint = 'coverage_percent';
  end if;
  if p_coverage_percent is not null and p_session_amount_cents is not null then
    raise exception 'Le PAE couvre un montant par séance ou une part de la séance, pas les deux.' using errcode = 'P0001', hint = 'coverage_percent';
  end if;
  if p_max_sessions is not null and p_max_sessions not between 1 and 999 then
    raise exception 'Le nombre maximal de séances est compris entre 1 et 999.' using errcode = 'P0001', hint = 'max_sessions';
  end if;
  if p_max_amount_cents is not null and p_max_amount_cents not between 1 and 100000000 then
    raise exception 'Le montant maximal est compris entre 0,01 $ et 1 000 000 $.' using errcode = 'P0001', hint = 'max_amount_cents';
  end if;
  if p_starts_on is not null and p_expires_on is not null and p_expires_on < p_starts_on then
    raise exception 'L''échéance doit suivre le début.' using errcode = 'P0001', hint = 'expires_on';
  end if;
  if (p_renewal_month is null) <> (p_renewal_day is null)
     or (p_renewal_month is not null and (p_renewal_month not between 1 and 12 or p_renewal_day not between 1 and
         case when p_renewal_month = 2 then 28 when p_renewal_month in (4, 6, 9, 11) then 30 else 31 end)) then
    raise exception 'La date de renouvellement est un jour de l''année (par exemple le 31 mars).' using errcode = 'P0001', hint = 'renewal';
  end if;
  if (p_prior_used_on is null) <> (p_prior_used_cents is null and p_prior_used_sessions is null)
     or (p_prior_used_cents is not null and p_prior_used_cents not between 0 and 100000000)
     or (p_prior_used_sessions is not null and p_prior_used_sessions not between 0 and 999) then
    raise exception 'Le déjà utilisé avant l''application est un montant ou un nombre de séances, à une date.' using errcode = 'P0001', hint = 'prior_used';
  end if;
  if v_note is not null and pg_catalog.length(v_note) > 1000 then
    raise exception 'La note compte 1 000 caractères au plus.' using errcode = 'P0001', hint = 'note';
  end if;

  if v_id is null then
    -- P10 (FP-12): a new payer never replaces the active one of its kind.
    if exists (select 1 from public.client_payers x where x.client_id = p_client_id and x.kind = p_kind and x.is_active) then
      raise exception 'Ce client a déjà un payeur % actif : modifiez-le, ou terminez-le avant d''en ajouter un autre.',
        case p_kind when 'ivac' then 'IVAC' else 'PAE' end using errcode = 'P0001', hint = 'kind';
    end if;
  elsif not exists (select 1 from public.client_payers x where x.client_id = p_client_id and x.id = v_id and x.is_active) then
    raise exception 'Payeur introuvable.' using errcode = 'P0001', hint = 'id';
  elsif exists (select 1 from public.client_payers x where x.id = v_id and x.kind <> p_kind) then
    raise exception 'Le type d''un payeur ne change pas : terminez-le et ajoutez-en un autre.' using errcode = 'P0001', hint = 'kind';
  end if;
  if v_id is null then
    insert into public.client_payers (client_id, org_id, kind, organisation_name, file_number, session_amount_cents, max_sessions,
                                      max_amount_cents, starts_on, expires_on, note, coverage_percent, renewal_month, renewal_day,
                                      prior_used_cents, prior_used_sessions, prior_used_on, created_by)
    values (p_client_id, v_org, p_kind, v_org_name, v_file, p_session_amount_cents, p_max_sessions, p_max_amount_cents,
            p_starts_on, p_expires_on, v_note, p_coverage_percent, p_renewal_month, p_renewal_day,
            p_prior_used_cents, p_prior_used_sessions::smallint, p_prior_used_on, auth.uid())
    returning id into v_id;
  else
    update public.client_payers x
       set kind = p_kind, organisation_name = v_org_name, file_number = v_file, session_amount_cents = p_session_amount_cents,
           max_sessions = p_max_sessions, max_amount_cents = p_max_amount_cents, starts_on = p_starts_on,
           expires_on = p_expires_on, note = v_note, coverage_percent = p_coverage_percent,
           renewal_month = p_renewal_month, renewal_day = p_renewal_day, prior_used_cents = p_prior_used_cents,
           prior_used_sessions = p_prior_used_sessions, prior_used_on = p_prior_used_on, is_stub = false
     where x.id = v_id;
  end if;
  return v_id;
end;
$$;
-- P11: a PAE without its file number is still to complete (FP-13).
create or replace function public.list_client_payers_to_complete()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('clients.view') then
    raise exception 'Permission refusée : clients.view' using errcode = '42501';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'client_payer_id', x.id, 'client_id', c.id, 'client_name', c.first_name || ' ' || c.last_name,
             'client_number', c.client_number, 'kind', x.kind, 'is_stub', x.is_stub,
             'missing', pg_catalog.array_remove(array[
               case when x.file_number is null then 'file_number' end,
               case when x.kind = 'pae' and x.organisation_name is null then 'organisation_name' end,
               case when x.kind = 'pae' and x.session_amount_cents is null and x.coverage_percent is null then 'coverage' end], null))
             order by c.last_name, c.first_name)
      from public.client_payers x
      join public.clients c on c.org_id = x.org_id and c.id = x.client_id
     where x.org_id = v_org and x.is_active and c.archived_at is null and c.merged_into_id is null and c.anonymized_at is null
       and (x.is_stub
            or x.file_number is null
            or (x.kind = 'pae' and (x.organisation_name is null or (x.session_amount_cents is null and x.coverage_percent is null))))),
    '[]'::jsonb);
end;
$$;
-- P11: the morning queue holds a session whose PAE has no file number (FP-13).
create or replace function private.billing_payer_incomplete(p_invoice public.invoices)
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
            or (t.kind = 'pae' and t.session_amount_cents is null and t.coverage_percent is null)
            or (t.kind = 'pae' and t.file_number is null)))
$$;
-- P11: no payer invoice by hand for a PAE without its file number (FP-13).
create or replace function public.create_payer_invoice(p_client_payer_id uuid)
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
  if t.kind = 'pae' and t.file_number is null then
    raise exception 'Indiquez d''abord le numéro de dossier du PAE dans le dossier du client.' using errcode = 'P0001', hint = 'file_number';
  end if;
  v_organisation := private.billing_payer_organisation(v_org, t.client_payer_id, t.kind, t.organisation_name);
  if v_organisation is null then
    raise exception 'Choisissez l''organisme payeur de ce PAE.' using errcode = 'P0001', hint = 'organisation_id';
  end if;
  return private.billing_payer_draft(v_org, t.client_payer_id, v_organisation, auth.uid());
end;
$$;
-- P12: the invoice page shows a payment's note (FP-14).
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
                  'reference', p.reference, 'note', p.note, 'receipt_id', r.id, 'receipt_number', r.number, 'receipt_file_id', r.pdf_file_id,
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
-- P12: « Enregistrer un paiement » takes an optional note (FP-14); the parameter is new, so the
-- function is dropped and made again with its grants.
drop function public.record_payment(uuid, text, int, date, text);
create function public.record_payment(
  p_invoice_id uuid, p_mode_code text, p_amount_cents int, p_paid_on date default null, p_reference text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  v_receipt uuid;
begin
  if v_note is not null and pg_catalog.char_length(v_note) > 500 then
    raise exception 'La note du paiement compte 500 caractères au plus.' using errcode = 'P0001', hint = 'note';
  end if;
  v_receipt := private.billing_record_payment(v_org, p_invoice_id, p_mode_code, p_amount_cents, p_paid_on, p_reference, null, auth.uid());
  if v_note is not null then
    update public.payments x set note = v_note
     where x.org_id = v_org and x.id = (select r.payment_id from public.receipts r where r.id = v_receipt);
  end if;
  return v_receipt;
end;
$$;
revoke all on function public.record_payment(uuid, text, int, date, text, text) from public, anon;
grant execute on function public.record_payment(uuid, text, int, date, text, text) to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);

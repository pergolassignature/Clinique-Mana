-- =============================================================================
-- Facturation: the pre-cutover security review's fixes (2026-10-14; BI-23 … BI-26)
-- =============================================================================
-- 1. `store_qbo_connection`: a new QuickBooks company (another realm or environment, after
--    « Déconnecter ») also drops the old company's vendors, organisation links, items, tax codes
--    and pushes, and forgets the professionals' bills' ids (BI-23).
-- 2. Payroll: a professional's invoice QuickBooks has (its Bill id, or its push pending or done)
--    is never replaced (`payroll_record_invoice`) nor detached (`reopen_payout_period`): one Bill
--    per invoice (BI-23).
-- 3. Audit redaction: `invoices` also redacts `hold_note` and `payer_reference`; `interac_notices`
--    the sender, the message, the reference and the reason ignored; `stripe_customers` the
--    Stripe ids and the card's facts; `payer_organisations` the contact and the billing address.
-- 4. `private.billing_anonymize_client` also clears the payments' notes (and references through
--    the dossier's invoices), the invoices' payer reference, the credit notes' and refunds'
--    reasons (through the dossier's invoices too) and the matched Interac notices' sender,
--    message and reference.
-- 5. `decide_cancellation_fee`: the permission before the row's lock.
-- 6. `private.billing_apply_payer_shares`: one finalisation at a time per payer (an advisory
--    lock) so two never pass the maximum together.
-- 7. `record_interac_notice_for_service`: recorded by itself only on the payer's first and last
--    names (score 2); a last name alone is suggested only (BI-25).
-- 8. An imported invoice is never in the payroll (`private.payroll_build`) nor charged the next
--    day (`stripe_charges_due_for_service`) (BI-24).
-- 10. `begin_stripe_charge_for_service`: a pending charge resumes only under a new charge's checks
--    (and within the balance).
-- (9, the online payment's Checkout session reused per invoice and balance, is in the function
-- `billing-stripe-checkout`: BI-26.)
-- Additive: `create or replace` of the latest bodies (same signatures), one private helper, four
-- audit triggers recreated (drop then create, same events).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:billing_security_fixes', true);

-- 1. A new QuickBooks company keeps none of the old one's ids.
create or replace function public.store_qbo_connection(
  p_actor uuid, p_org_id uuid, p_realm_id text, p_environment text, p_company_name text,
  p_access_token text, p_refresh_token text, p_access_token_expires_at timestamptz,
  p_refresh_token_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
  v_row public.qbo_connections;
  v_id uuid;
  v_version integer;
begin
  perform private.qbo_assert_manager(p_actor, p_org_id);
  if p_realm_id is null or p_realm_id !~ '^[0-9]{1,32}$' or p_environment not in ('production', 'sandbox') then
    raise exception 'A realm and an environment are required' using errcode = '22023';
  end if;
  if coalesce(p_access_token, '') = '' or coalesce(p_refresh_token, '') = '' or p_access_token_expires_at is null then
    raise exception 'Tokens are required' using errcode = '22023';
  end if;
  if not public.module_enabled_for_org(p_org_id, 'billing') then
    raise exception 'Le module Facturation n''est pas activé.' using errcode = 'P0001';
  end if;
  perform 1 from public.organizations o where o.id = p_org_id for no key update;
  perform pg_catalog.set_config('app.audit_source', 'rpc:store_qbo_connection', true);
  perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);

  select * into v_row from public.qbo_connections c where c.org_id = p_org_id for no key update;
  if v_row.id is null then
    insert into public.qbo_connections (org_id, realm_id, environment, company_name, status, connected_by, refresh_token_expires_at)
    values (p_org_id, p_realm_id, p_environment, nullif(pg_catalog.btrim(p_company_name), ''), 'connected', p_actor,
            p_refresh_token_expires_at)
    returning id into v_id;
  else
    if v_row.status <> 'disconnected' and (v_row.realm_id <> p_realm_id or v_row.environment <> p_environment) then
      raise exception 'La clinique est déjà reliée à une autre entreprise QuickBooks. Déconnectez-la d''abord.'
        using errcode = 'P0001';
    end if;
    v_id := v_row.id;
    -- A new company after « Déconnecter »: the old one's mirrors, matches and links go.
    if v_row.realm_id <> p_realm_id or v_row.environment <> p_environment then
      delete from public.qbo_links l where l.connection_id = v_id;
      delete from public.qbo_customers x where x.connection_id = v_id;
      delete from public.qbo_accounts a where a.connection_id = v_id;
      update public.qbo_account_map m set qbo_account_id = null, suggested = false where m.org_id = p_org_id;
      -- Security review 2026-10-14 (BI-23): nothing of the old company's stays (its vendors,
      -- organisations, items, tax codes, pushes, bills): the new one starts clean.
      delete from public.qbo_vendor_links v where v.connection_id = v_id;
      delete from public.qbo_organisation_links o where o.connection_id = v_id;
      delete from public.qbo_items x where x.connection_id = v_id;
      delete from public.qbo_tax_codes x where x.connection_id = v_id;
      delete from public.qbo_pushes q where q.org_id = p_org_id;
      update public.professional_invoices i set qbo_bill_id = null, exported_at = null
       where i.org_id = p_org_id and (i.qbo_bill_id is not null or i.exported_at is not null);
    end if;
    update public.qbo_connections c
       set realm_id = p_realm_id, environment = p_environment,
           company_name = coalesce(nullif(pg_catalog.btrim(p_company_name), ''), c.company_name),
           status = 'connected', status_reason = null,
           connected_by = p_actor, connected_at = pg_catalog.now(),
           disconnected_at = null, disconnected_by = null,
           refresh_token_expires_at = p_refresh_token_expires_at,
           last_error_code = null, last_error_at = null
     where c.id = v_id;
  end if;

  v_version := private.pii_current_key_version();
  insert into public.qbo_connection_tokens as t (connection_id, org_id, access_token, refresh_token, access_token_expires_at, key_version)
  values (v_id, p_org_id, private.encrypt_pii(p_access_token, v_version), private.encrypt_pii(p_refresh_token, v_version),
          p_access_token_expires_at, v_version)
  on conflict (connection_id) do update
    set access_token = excluded.access_token, refresh_token = excluded.refresh_token,
        access_token_expires_at = excluded.access_token_expires_at, key_version = excluded.key_version;

  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return v_id;
end;
$$;

-- 2. A period's invoice is in QuickBooks: its Bill id, or its push pending (being tried) or done.
create function private.payroll_invoice_in_qbo(p_period uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.professional_invoices i
     where i.period_id = p_period
       and (i.qbo_bill_id is not null
            or exists (select 1 from public.qbo_pushes q
                        where q.org_id = i.org_id and q.kind = 'bill' and q.entity_id = i.id
                          and q.status in ('pending', 'pushed'))))
$$;
revoke all on function private.payroll_invoice_in_qbo(uuid) from public, anon, authenticated, service_role;

create or replace function private.payroll_record_invoice(p_period public.payout_periods, p_source text, p_file_id uuid,
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
  if private.payroll_invoice_in_qbo(p_period.id) then
    raise exception 'La facture de cette période est déjà envoyée à QuickBooks : elle ne se remplace plus. Annulez d''abord la facture fournisseur dans QuickBooks, puis corrigez l''écart par un ajustement sur la paie du mois suivant.'
      using errcode = 'P0001', hint = 'qbo_bill';
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

create or replace function public.reopen_payout_period(p_id uuid, p_reason text)
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
  if private.payroll_invoice_in_qbo(v.id) then
    raise exception 'La facture de cette période est déjà envoyée à QuickBooks : la période ne se rouvre plus. Annulez d''abord la facture fournisseur dans QuickBooks, puis corrigez l''écart par un ajustement sur la paie du mois suivant.'
      using errcode = 'P0001', hint = 'qbo_bill';
  end if;
  perform private.soft_delete_stored_file(i.file_id, auth.uid()) from public.professional_invoices i where i.period_id = v.id;
  delete from public.professional_invoices i where i.period_id = v.id;
  update public.payout_periods p
     set state = 'to_validate', validated_at = null, validated_by = null, reopen_reason = v_reason
   where p.id = v.id;
  perform private.payroll_notify_professional(v, 'billing.payout_reopened', 'Sommaire de paie rouvert',
    'Votre sommaire de ' || private.payroll_month_label(v.month) || ' a été rouvert par l''administration : '
    || v_reason);
end;
$$;

-- 8. The payroll never pays on an imported invoice (GOrendezvous paid it already).
create or replace function private.payroll_build(p_org uuid, p_month date, p_actor uuid, p_professional uuid default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tz text := private.payroll_tz(p_org);
  v_first date;
  v_low date;
  v_to timestamptz;
  v_low_ts timestamptz;
  v_created int;
  v_removed int;
  v_locked int;
  v_rebuilt int;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('billing.payroll:' || p_org::text, 0));
  v_to := (p_month + interval '1 month')::timestamp at time zone v_tz;
  -- Months already run, three back at most, never before the clinic's first period sent (a
  -- draft, which « Supprimer les brouillons » may discard, anchors nothing).
  select min(p.month) into v_first from public.payout_periods p where p.org_id = p_org and p.sent_at is not null;
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
    join private.payroll_rules(p_org) r on r.service_id = f.service_id and r.rule = 'late_cancellation'
    left join lateral (
      select (x.starts_at at time zone v_tz)::date as on_date, x.client_ids[1] as client_id
        from private.appointment_billing_facts(p_org, array[f.appointment_id]) x) b on true
    cross join lateral (
      select private.professional_compensation_rate(p_org, 'late_cancellation', (f.paid_at at time zone v_tz)::date) as pct) k
   where (p_professional is null or f.professional_id = p_professional)
     and f.paid_at >= v_low_ts
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
     and i.source_type <> 'import'
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

-- 3. Audit redaction: the free texts and the payment facts never in the audit log.
drop trigger invoices_audit on public.invoices;
create trigger invoices_audit after insert or update or delete on public.invoices
  for each row execute function private.audit_trigger('notes_client', 'notes_internal', 'hold_note', 'payer_reference');
drop trigger interac_notices_audit on public.interac_notices;
create trigger interac_notices_audit after insert or update or delete on public.interac_notices
  for each row execute function private.audit_trigger('message', 'sender_name', 'reference', 'ignored_reason');
drop trigger stripe_customers_audit on public.stripe_customers;
create trigger stripe_customers_audit after insert or update or delete on public.stripe_customers
  for each row execute function private.audit_trigger('stripe_customer_id', 'payment_method_id', 'card_brand', 'card_last4',
                                                      'card_exp_month', 'card_exp_year');
drop trigger payer_organisations_audit on public.payer_organisations;
create trigger payer_organisations_audit after insert or update or delete on public.payer_organisations
  for each row execute function private.audit_trigger('note', 'contact_name', 'billing_email');

-- 4. A person's anonymisation clears every free text Facturation keeps about her: the dossier's
-- invoices (as client or payer) and what hangs from them.
create or replace function private.billing_anonymize_client(p_id uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_total int := 0;
  v_count int;
begin
  update public.invoices i set notes_client = null, notes_internal = null, hold_note = null, payer_reference = null
   where (i.client_id = p_id or i.payer_client_id = p_id)
     and (i.notes_client is not null or i.notes_internal is not null or i.hold_note is not null or i.payer_reference is not null);
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  delete from public.billing_payer_defaults d where d.client_id = p_id or d.payer_client_id = p_id;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  -- F2: the payments' references and notes (hers as payer, or on her dossier's invoices), the agreements.
  update public.payments p set reference = null, note = null
   where (p.payer_client_id = p_id
          or exists (select 1 from public.invoices i where i.id = p.invoice_id and i.client_id = p_id))
     and (p.reference is not null or p.note is not null);
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  delete from public.special_agreements a where a.client_id = p_id;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  -- The credit notes' reasons.
  update public.credit_notes n set reason = 'Anonymisé'
   where n.reason <> 'Anonymisé'
     and exists (select 1 from public.invoices i where i.id = n.invoice_id and (i.client_id = p_id or i.payer_client_id = p_id));
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  -- F3: the decisions' notes, the refunds' reasons (her payments, or her dossier's invoices).
  update public.cancellation_fee_decisions c set note = null where c.client_id = p_id and c.note is not null;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.refunds f set reason = 'Anonymisé'
   where f.reason <> 'Anonymisé'
     and (exists (select 1 from public.payments p where p.id = f.payment_id and p.payer_client_id = p_id)
          or exists (select 1 from public.invoices i where i.id = f.invoice_id and (i.client_id = p_id or i.payer_client_id = p_id)));
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  -- FS: the Interac notices matched to her invoices or her payments (the sender is her, or names her).
  update public.interac_notices n set sender_name = 'Anonymisé', message = null, reference = null
   where (n.sender_name <> 'Anonymisé' or n.message is not null or n.reference is not null)
     and (exists (select 1 from public.invoices i where i.id = n.invoice_id and (i.client_id = p_id or i.payer_client_id = p_id))
          or exists (select 1 from public.payments p where p.id = n.payment_id and p.payer_client_id = p_id));
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

-- 5. A fee decision checks the permission before it locks the row.
create or replace function public.decide_cancellation_fee(p_appointment_id uuid, p_apply boolean, p_note text default null)
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
  -- Security review 2026-10-14: the permission first, then the lock (no row locked for a caller
  -- who may not decide).
  if not (private.has_permission('billing.manage') or private.has_permission('billing.self')) then
    raise exception 'Permission refusée : billing.manage' using errcode = '42501';
  end if;
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

-- 6. Two finalisations never pass a third-party payer's maximum together.
create or replace function private.billing_apply_payer_shares(p_org uuid, p_invoice_id uuid)
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
    -- Security review 2026-10-14: one invoice at a time per payer, so that two finalisations
    -- never both read the same consumption and pass the maximum together (held to commit).
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('billing.payer:' || t.client_payer_id::text, 0));
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

-- 7. A Gmail transfer is recorded by itself only when the sender carries the payer's first and last
-- names (BI-25); a last name alone is only suggested in « À rapprocher ».
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
             pg_catalog.btrim(pg_catalog.substr(pf.display_name, pg_catalog.length(pf.first_name) + 1))) = 2
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

-- 8. The next-day charge never takes an imported invoice (BI-24).
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
     and i.source_type <> 'import'
     and coalesce(i.finalized_at, i.issued_on::timestamptz) >= s.consent_at
     and i.issued_on >= private.billing_today(p_org_id) - 14
     and public.module_open_to_all_for_org(p_org_id, 'billing')
     and private.billing_stripe_configured(p_org_id)
     and not exists (select 1 from public.stripe_charges c where c.invoice_id = i.id and (c.kind = 'auto' or c.status = 'pending'))
   order by i.issued_on, i.number
   limit least(greatest(coalesce(p_limit, 100), 1), 500)
$$;

-- 10. A pending charge resumes only when the invoice could be charged now.
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
  -- Security review 2026-10-14: a pending charge resumes only under the checks of a new one (the
  -- invoice issued with a balance at least the charge's, the card, Stripe, P3-40, the consent).
  if v.id is null or v.status <> 'issued' or v.total_cents - v.paid_cents <= 0 or s.payer_client_id is null
     or v.payer_kind = 'organisation'
     or not private.billing_stripe_configured(p_org_id)
     or not public.module_open_to_all_for_org(p_org_id, 'billing')
     or coalesce(v.finalized_at, v.issued_on::timestamptz) < s.consent_at
     or (c.id is not null and c.amount_cents > v.total_cents - v.paid_cents)
     or (c.id is null and p_kind = 'auto' and exists (select 1 from public.stripe_charges x where x.invoice_id = v.id and x.kind = 'auto')) then
    if p_kind = 'manual' then
      raise exception 'Cette facture ne peut pas être prélevée : elle est payée, émise avant l''autorisation de la carte, sans carte au dossier, ou Facturation est réservé aux testeurs.'
        using errcode = 'P0001', hint = 'charge';
    end if;
    return null;
  end if;
  if c.id is not null then
    return pg_catalog.jsonb_build_object(
      'charge_id', c.id, 'amount_cents', c.amount_cents, 'invoice_number', v.number, 'resume', true,
      'customer_id', s.stripe_customer_id, 'payment_method_id', s.payment_method_id,
      'clinic_name', (select coalesce(o.legal_name, o.name) from public.organizations o where o.id = p_org_id));
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

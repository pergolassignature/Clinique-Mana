-- =============================================================================
-- Facturation: « Bill annulé dans QuickBooks » (BI-28, déléguée — révisable)
-- =============================================================================
-- Since BI-23 (`*_billing_security_fixes.sql`), a professional's invoice QuickBooks has (its Bill
-- id, or its push pending or done) is never replaced nor detached by a reopening: one Bill per
-- invoice. The administration is told to delete the Bill in QuickBooks first, but nothing let the
-- app learn it was: a pushed period could never be reopened. Two ways now, both audited:
-- * verified (`billing.payroll`, who may reopen a period): the function `qbo-bill-check` asks
--   QuickBooks for the Bill (`qbo_bill_to_check_for_service`), and only when QuickBooks says it
--   is gone (deleted, or voided to zero) does `clear_qbo_bill_for_service` forget it;
-- * override (`billing.payroll` and `billing.settings`, who manages the QuickBooks connection):
--   `force_clear_qbo_bill` with a reason of 10 to 500 characters, when QuickBooks cannot be
--   reached (not connected, the application's secrets missing); the screen warns that the pay is
--   paid twice if the Bill still exists.
-- Forgetting a Bill: the invoice's `qbo_bill_id` and `exported_at` cleared (audited on
-- `professional_invoices`), its push row set to `failed` with the code `bill_voided` (no new Bill
-- is pushed by itself: the period is to be reopened, or « Réessayer » pushes the same invoice
-- again) and its `generation` raised, so a re-push carries a NEW `requestid` (Intuit answers a
-- repeated requestid with the first, deleted, Bill); a row in `qbo_bill_clearances` (who, when,
-- how, the reason; audited, the reason redacted as the module's other reasons).
-- Additive: one column (constant default), one table, three RPCs, one private helper;
-- `qbo_bills_to_push_for_service` dropped and created again with the generation (its return
-- type changes; service role only), `get_payout_period` gains the Bill id for the administration
-- (same signature).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:billing_qbo_bill_voided', true);

-- -----------------------------------------------------------------------------
-- qbo_pushes.generation: how many times this document's QuickBooks copy was forgotten
-- -----------------------------------------------------------------------------
alter table public.qbo_pushes add column generation int not null default 0;
alter table public.qbo_pushes add constraint qbo_pushes_generation_check check (generation between 0 and 1000);

-- -----------------------------------------------------------------------------
-- qbo_bill_clearances: each Bill the app forgot (append-only through the RPCs; audited)
-- -----------------------------------------------------------------------------
-- professional_invoice_id: no FK, the invoice is detached when the period is reopened afterwards.
create table public.qbo_bill_clearances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  period_id uuid not null,
  professional_invoice_id uuid not null,
  qbo_bill_id text not null,
  method text not null,
  reason text,
  cleared_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  constraint qbo_bill_clearances_period_fkey foreign key (org_id, period_id)
    references public.payout_periods (org_id, id) on delete cascade,
  constraint qbo_bill_clearances_method_check check (method in ('verified', 'override')),
  constraint qbo_bill_clearances_reason_check check (
    (method = 'override') = (reason is not null) and (reason is null or char_length(reason) between 10 and 500)),
  constraint qbo_bill_clearances_bill_check check (char_length(qbo_bill_id) between 1 and 64)
);
create index qbo_bill_clearances_org_period_idx on public.qbo_bill_clearances (org_id, period_id);
create index qbo_bill_clearances_cleared_by_idx on public.qbo_bill_clearances (cleared_by);
revoke all on public.qbo_bill_clearances from anon, authenticated;
grant select on public.qbo_bill_clearances to authenticated;
alter table public.qbo_bill_clearances enable row level security;
create policy qbo_bill_clearances_select on public.qbo_bill_clearances
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.payroll')));
create trigger qbo_bill_clearances_audit after insert or update or delete on public.qbo_bill_clearances
  for each row execute function private.audit_trigger('reason');

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
-- The Bill QuickBooks holds for a period's invoice: its id on the invoice, else its pushed row's.
create function private.payroll_qbo_bill(p_period public.payout_periods)
returns table (invoice_id uuid, qbo_bill_id text)
language sql
stable
set search_path = ''
as $$
  select i.id, coalesce(i.qbo_bill_id,
                        (select q.qbo_id from public.qbo_pushes q
                          where q.org_id = i.org_id and q.kind = 'bill' and q.entity_id = i.id and q.status = 'pushed'))
    from public.professional_invoices i
   where i.org_id = p_period.org_id and i.period_id = p_period.id
$$;
revoke all on function private.payroll_qbo_bill(public.payout_periods) from public, anon, authenticated, service_role;

-- A period whose Bill may be forgotten: validated (not paid), with a Bill. Returns the invoice and
-- the Bill; p_bill (the verified path) must still be the period's Bill.
create function private.payroll_qbo_bill_checked(p_period public.payout_periods, p_bill text)
returns table (invoice_id uuid, qbo_bill_id text)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_invoice uuid;
  v_bill text;
begin
  if p_period.state <> 'validated' then
    raise exception 'Seule la facture d''une période validée et non versée se détache de QuickBooks.'
      using errcode = 'P0001', hint = 'state';
  end if;
  select b.invoice_id, b.qbo_bill_id into v_invoice, v_bill from private.payroll_qbo_bill(p_period) b;
  if v_bill is null then
    raise exception 'La facture de cette période n''a pas de Bill dans QuickBooks.' using errcode = 'P0001', hint = 'qbo_bill';
  end if;
  if p_bill is not null and p_bill <> v_bill then
    raise exception 'Le Bill de cette période a changé entre-temps : vérifiez de nouveau.' using errcode = 'P0001', hint = 'qbo_bill';
  end if;
  return query select v_invoice, v_bill;
end;
$$;
revoke all on function private.payroll_qbo_bill_checked(public.payout_periods, text) from public, anon, authenticated, service_role;

-- Forgets the period's Bill (the caller checked the permission and holds the period's lock).
create function private.payroll_clear_qbo_bill(p_period public.payout_periods, p_actor uuid, p_bill text, p_method text,
                                               p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
  v_invoice uuid;
  v_bill text;
begin
  select c.invoice_id, c.qbo_bill_id into v_invoice, v_bill from private.payroll_qbo_bill_checked(p_period, p_bill) c;
  perform pg_catalog.set_config('app.audit_source',
    case p_method when 'verified' then 'fn:qbo-bill-check' else 'rpc:force_clear_qbo_bill' end, true);
  perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);
  update public.professional_invoices i
     set qbo_bill_id = null, exported_at = null
   where i.org_id = p_period.org_id and i.id = v_invoice;
  -- Never pushed again by itself; a re-push (« Réessayer ») carries a new requestid.
  insert into public.qbo_pushes as q (org_id, kind, entity_id, status, last_error_code, generation)
  values (p_period.org_id, 'bill', v_invoice, 'failed', 'bill_voided', 1)
  on conflict (org_id, kind, entity_id) do update
    set status = 'failed', qbo_id = null, qbo_customer_id = null, pushed_at = null, amount_mismatch = false,
        last_error_code = 'bill_voided', attempts = 0, next_attempt_at = pg_catalog.now(),
        generation = q.generation + 1;
  insert into public.qbo_bill_clearances (org_id, period_id, professional_invoice_id, qbo_bill_id, method, reason, cleared_by)
  values (p_period.org_id, p_period.id, v_invoice, v_bill, p_method, p_reason, p_actor);
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
end;
$$;
revoke all on function private.payroll_clear_qbo_bill(public.payout_periods, uuid, text, text, text)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The verified path (service role: the function `qbo-bill-check`, the caller as p_actor)
-- -----------------------------------------------------------------------------
-- The Bill to ask QuickBooks about: the caller holds `billing.payroll` (first), the period is of
-- her org (p_org_id: the caller's, from verifyAuth), validated, with a Bill. Answers { bill_id }.
create function public.qbo_bill_to_check_for_service(p_actor uuid, p_org_id uuid, p_period_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.payout_periods;
  v_bill text;
begin
  if not ('billing.payroll' = any (private.permission_keys_for(p_actor)))
     or p_org_id is distinct from (select p.org_id from public.profiles p where p.user_id = p_actor) then
    raise exception 'Permission refusée : billing.payroll' using errcode = '42501';
  end if;
  select x.* into v from public.payout_periods x where x.org_id = p_org_id and x.id = p_period_id;
  if v.id is null then
    raise exception 'Période de paie introuvable.' using errcode = 'P0001', hint = 'period_id';
  end if;
  select c.qbo_bill_id into v_bill from private.payroll_qbo_bill_checked(v, null) c;
  return pg_catalog.jsonb_build_object('bill_id', v_bill);
end;
$$;
revoke all on function public.qbo_bill_to_check_for_service(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.qbo_bill_to_check_for_service(uuid, uuid, uuid) to service_role;

-- QuickBooks said the Bill p_bill_id is gone: forgets it (the same checks, under the period's
-- lock, and the period's Bill must still be p_bill_id).
create function public.clear_qbo_bill_for_service(p_actor uuid, p_org_id uuid, p_period_id uuid, p_bill_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payout_periods;
begin
  if not ('billing.payroll' = any (private.permission_keys_for(p_actor)))
     or p_org_id is distinct from (select p.org_id from public.profiles p where p.user_id = p_actor) then
    raise exception 'Permission refusée : billing.payroll' using errcode = '42501';
  end if;
  if p_bill_id is null or p_bill_id !~ '^[0-9]{1,32}$' then
    raise exception 'A Bill id' using errcode = '22023';
  end if;
  v := private.payroll_period_for(p_period_id, p_actor, true);
  perform private.payroll_clear_qbo_bill(v, p_actor, p_bill_id, 'verified', null);
end;
$$;
revoke all on function public.clear_qbo_bill_for_service(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.clear_qbo_bill_for_service(uuid, uuid, uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- The override (a user RPC): `billing.payroll` and `billing.settings`, a reason
-- -----------------------------------------------------------------------------
create function public.force_clear_qbo_bill(p_period_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payout_periods;
  v_reason text := pg_catalog.btrim(p_reason);
begin
  if not private.has_permission('billing.settings') then
    raise exception 'Permission refusée : billing.settings' using errcode = '42501';
  end if;
  v := private.payroll_period_for(p_period_id, auth.uid(), true);
  if v_reason is null or char_length(v_reason) < 10 or char_length(v_reason) > 500 then
    raise exception 'Indiquez la raison (10 à 500 caractères).' using errcode = 'P0001', hint = 'reason';
  end if;
  perform private.payroll_clear_qbo_bill(v, auth.uid(), null, 'override', v_reason);
end;
$$;
revoke all on function public.force_clear_qbo_bill(uuid, text) from public, anon, authenticated;
grant execute on function public.force_clear_qbo_bill(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- The push reads the generation (a re-push after a forgotten Bill: a new requestid)
-- -----------------------------------------------------------------------------
drop function public.qbo_bills_to_push_for_service(uuid, int);
create function public.qbo_bills_to_push_for_service(p_org_id uuid, p_limit int default 20)
returns table (invoice_id uuid, professional_id uuid, professional_name text, number text, issued_on date,
               amount_cents int, vendor_id text, expense_account_id text, title_name text, attempts int,
               generation int)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, p.professional_id, n.display_name, i.number, i.issued_on, i.amount_cents,
         (select v.qbo_vendor_id from public.qbo_vendor_links v
           join public.qbo_connections c on c.id = v.connection_id
          where c.org_id = p_org_id and v.professional_id = p.professional_id),
         (select m.qbo_account_id from public.qbo_account_map m
           join public.profession_titles_catalog t on t.id = m.profession_title_id
          where m.org_id = p_org_id and m.map_key = 'expense'
            and p.title_name is not null and p.title_name in (t.name, t.name_feminine, t.name_masculine)
          limit 1),
         p.title_name,
         coalesce(q.attempts, 0),
         coalesce(q.generation, 0)
    from public.professional_invoices i
    join public.payout_periods p on p.org_id = i.org_id and p.id = i.period_id
    left join public.qbo_pushes q on q.org_id = i.org_id and q.kind = 'bill' and q.entity_id = i.id
    left join private.professional_display_names(p_org_id,
           (select coalesce(pg_catalog.array_agg(x.professional_id), '{}') from public.payout_periods x where x.org_id = p_org_id)) n
      on n.professional_id = p.professional_id
   where i.org_id = p_org_id and p.state in ('validated', 'paid') and i.qbo_bill_id is null
     and (q.id is null or (q.status = 'pending' and q.next_attempt_at <= pg_catalog.now()))
   order by i.issued_on, i.id
   limit least(greatest(coalesce(p_limit, 20), 1), 100)
$$;
revoke all on function public.qbo_bills_to_push_for_service(uuid, int) from public, anon, authenticated;
grant execute on function public.qbo_bills_to_push_for_service(uuid, int) to service_role;

-- -----------------------------------------------------------------------------
-- The period's read: the administration sees the invoice's Bill id (same signature)
-- -----------------------------------------------------------------------------
create or replace function public.get_payout_period(p_id uuid)
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
                                                       'amount_cents', i.amount_cents, 'created_at', i.created_at,
                                                       'qbo_bill_id', case when v_staff then b.qbo_bill_id end)
                    from public.professional_invoices i
                    left join private.payroll_qbo_bill(v) b on b.invoice_id = i.id
                   where i.period_id = v.id)
    )
  );
end;
$$;

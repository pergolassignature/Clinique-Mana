-- =============================================================================
-- Demandes: « Facturer l'inscription » (the waiting list's fee through Facturation)
-- =============================================================================
-- Asked:     coordinator, 2026-10-13; reviewed by lane B (owner of `waitlist_entries`)
-- Needs:     *_billing_source_hooks.sql (Facturation's published invoice and hook catalogue)
-- Decisions: BI-19 (decisions log)
--
-- * `invoice_waitlist_fee(entry)` (`demandes.waitlist`, the permission first; Facturation must be
--   enabled): an entry with its client's dossier and a fee « À facturer » is invoiced by
--   Facturation (the registration service, sent to the dossier's payer); the entry holds the
--   invoice (`fee_status = 'invoiced'`, `fee_invoice_id`). The entry is locked first: two clicks
--   never make two invoices. Returns the invoice's number.
-- * The entry follows its invoice (`private.demandes_waitlist_billing_changed`, Facturation's hook
--   for the source `waitlist_fee`): paid → `paid`, then promoted when its consent is in force
--   (`waitlist_promote`, idempotent: only an `incomplete` entry moves); taken back to unpaid (a
--   refund) → `invoiced`, a promotion already made stays (a person decides); credited → back to
--   « À facturer » (invoiced again, or waived). « Exonéré » with its reason stays manual.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:demandes_waitlist_fee_invoice', true);

create function public.invoice_waitlist_fee(p_entry_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.waitlist_entries;
  r record;
begin
  perform private.demandes_require('demandes.waitlist');
  if not public.module_enabled_for_org(private.current_user_org_id(), 'billing') then
    raise exception 'La Facturation n''est pas activée : notez les frais à la main (payés ou exonérés).' using errcode = 'P0001', hint = 'billing';
  end if;
  v := private.waitlist_lock(p_entry_id);
  if v.client_id is null then
    raise exception 'Liez d''abord l''inscription au dossier du client.' using errcode = 'P0001', hint = 'client_id';
  end if;
  if v.fee_status <> 'to_invoice' then
    raise exception 'Les frais de cette inscription ne sont pas « À facturer ».' using errcode = 'P0001', hint = 'fee_status';
  end if;
  select x.* into r from private.billing_create_waitlist_fee_invoice(v.org_id, v.client_id, v.id, auth.uid()) x;
  perform pg_catalog.set_config('app.audit_source', 'rpc:invoice_waitlist_fee', true);
  update public.waitlist_entries e set fee_status = 'invoiced', fee_invoice_id = r.invoice_id, fee_waived_reason = null
   where e.id = v.id;
  return r.number;
end;
$$;
revoke all on function public.invoice_waitlist_fee(uuid) from public, anon;
grant execute on function public.invoice_waitlist_fee(uuid) to authenticated;

-- Facturation's hook (source `waitlist_fee`): the entry follows the invoice it holds.
create function private.demandes_waitlist_billing_changed(p_org uuid, p_entry_id uuid, p_invoice_id uuid, p_state text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_prev text := pg_catalog.current_setting('app.audit_source', true);
begin
  perform pg_catalog.set_config('app.audit_source', 'billing:waitlist_fee', true);
  update public.waitlist_entries e
     set fee_status = case p_state when 'paid' then 'paid' when 'credited' then 'to_invoice' else 'invoiced' end,
         fee_invoice_id = case when p_state = 'credited' then null else e.fee_invoice_id end
   where e.org_id = p_org and e.id = p_entry_id and e.fee_invoice_id = p_invoice_id
     and e.fee_status in ('invoiced', 'paid');
  -- Only an entry holding this invoice moves.
  if found and p_state = 'paid' then
    perform private.waitlist_promote(p_org, p_entry_id);
  end if;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev, ''), true);
end;
$$;
revoke all on function private.demandes_waitlist_billing_changed(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;

insert into public.billing_source_hooks (source_type, module_key, function_name)
values ('waitlist_fee', 'demandes', 'private.demandes_waitlist_billing_changed')
on conflict do nothing;

select pg_catalog.set_config('app.audit_source', '', true);

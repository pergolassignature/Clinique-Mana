-- =============================================================================
-- Facturation: invoices for another module's source, and the hooks that tell it (waitlist fee)
-- =============================================================================
-- Asked:     coordinator, 2026-10-13 (the waiting list's registration fee, a gap F3 left)
-- Decisions: BI-19 (decisions log)
--
-- * `invoices.source_type` gains `waitlist_fee` (Demandes' registration fee; `source_id` = the
--   waiting-list entry).
-- * `private.billing_create_waitlist_fee_invoice(org, client, entry, actor)` (granted to no role;
--   Demandes' definer RPC calls it after its own check): one invoice of the clinic's
--   `waitlist_registration` service (50100, priced and taxed by Services et tarifs on the day), to
--   the dossier's default payer (the client, or a relation holding « recevoir reçus et factures »),
--   finalised (`AAAA-N`) and sent at once through the deliveries (its PDF; the email held while
--   Facturation is reserved for its testers, P3-40). Never twice for an entry while one stands.
-- * `billing_source_hooks` (a catalogue, like Clients' `client_merge_handlers`, ADR 0003): a
--   module names `private.<name>_billing_changed(org, source_id, invoice_id, state)` for its
--   source type; an invoice of that source moving between `issued`, `paid` and `credited` calls it
--   (trigger `invoices_source_hooks`), when the hook's module is enabled. A refund that takes a
--   paid invoice back calls it with `issued`.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:billing_source_hooks', true);

alter table public.invoices drop constraint invoices_source_check;
alter table public.invoices
  add constraint invoices_source_check check (source_type in ('appointment', 'manual', 'service', 'import', 'waitlist_fee'));
create index invoices_org_source_idx on public.invoices (org_id, source_type, source_id) where source_id is not null;

create table public.billing_source_hooks (
  source_type text primary key,
  module_key text not null references public.modules(key),
  function_name text not null,
  constraint billing_source_hooks_source_check check (source_type ~ '^[a-z][a-z0-9_]{1,40}$'),
  constraint billing_source_hooks_function_check check (function_name ~ '^private\.[a-z][a-z0-9_]{2,62}_billing_changed$')
);
create index billing_source_hooks_module_idx on public.billing_source_hooks (module_key);
alter table public.billing_source_hooks enable row level security;
revoke all on public.billing_source_hooks from anon, authenticated;

-- Calls the source's hook when an invoice's state changes: `issued` (unpaid or in part), `paid`,
-- `credited`. Skipped without a hook, without a source id, or with the hook's module disabled.
create function private.billing_source_hook_trigger()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  h public.billing_source_hooks;
  v_proc regprocedure;
  v_state text;
  v_old_state text;
begin
  if new.source_id is null then
    return null;
  end if;
  select x.* into h from public.billing_source_hooks x where x.source_type = new.source_type;
  if h.source_type is null or not public.module_enabled_for_org(new.org_id, h.module_key) then
    return null;
  end if;
  v_state := case when new.status = 'credited' then 'credited'
                  when new.status = 'issued' and new.payment_status = 'paid' then 'paid'
                  when new.status = 'issued' then 'issued' end;
  v_old_state := case when old.status = 'credited' then 'credited'
                      when old.status = 'issued' and old.payment_status = 'paid' then 'paid'
                      when old.status = 'issued' then 'issued' end;
  if v_state is null or v_state is not distinct from v_old_state then
    return null;
  end if;
  v_proc := pg_catalog.to_regprocedure(h.function_name || '(uuid, uuid, uuid, text)');
  if v_proc is null then
    raise exception 'Unknown billing hook %', h.function_name using errcode = '22023';
  end if;
  -- The name is checked by the catalogue (`private.<name>_billing_changed`) and resolved above.
  execute pg_catalog.format('select %s($1, $2, $3, $4)', h.function_name) using new.org_id, new.source_id, new.id, v_state;
  return null;
end;
$$;
revoke all on function private.billing_source_hook_trigger() from public, anon, authenticated, service_role;
create trigger invoices_source_hooks after update of status, payment_status on public.invoices
  for each row execute function private.billing_source_hook_trigger();

-- The waiting list's registration fee: one issued invoice, sent to the dossier's default payer.
create function private.billing_create_waitlist_fee_invoice(p_org uuid, p_client_id uuid, p_entry_id uuid, p_actor uuid,
                                                            out invoice_id uuid, out number text)
language plpgsql
set search_path = ''
as $$
declare
  v_service uuid := private.service_id_by_key(p_org, 'waitlist_registration');
  v_today date := private.billing_today(p_org);
begin
  if v_service is null then
    raise exception 'Le service « Inscription à la liste d''attente » n''existe pas dans Services et tarifs.' using errcode = 'P0001', hint = 'service';
  end if;
  -- One entry at a time: two clicks never make two invoices.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('billing.waitlist_fee:' || p_entry_id::text, 0));
  if exists (select 1 from public.invoices i
              where i.org_id = p_org and i.source_type = 'waitlist_fee' and i.source_id = p_entry_id and i.status <> 'credited') then
    raise exception 'Les frais de cette inscription sont déjà facturés.' using errcode = 'P0001', hint = 'fee_status';
  end if;
  invoice_id := private.billing_new_invoice(p_org, p_client_id, null, 'waitlist_fee', p_entry_id, p_actor);
  perform private.billing_add_service_line(p_org, invoice_id, 'service', v_service, null, v_today, null);
  perform private.billing_recompute(invoice_id, v_today);
  number := private.billing_finalize(p_org, invoice_id, p_actor);
  perform private.billing_queue_delivery(p_org, 'invoice', invoice_id, true, false, p_actor);
end;
$$;
revoke all on function private.billing_create_waitlist_fee_invoice(uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;

select pg_catalog.set_config('app.audit_source', '', true);

-- =============================================================================
-- Facturation: the GOrendezvous import of « Payé par » (I2 prep, the default payers)
-- =============================================================================
-- Asked:   coordinator, 2026-10-13 (lane A, I2 prep: « Payé par » from the revenue export);
--          decision I-17. `import_invoice` (I3) bills the client and leaves « Payé par » out.
-- Needs:   *_billing_module.sql (billing_payer_defaults, billing_payer_allowed), Clients'
--          private.clients_import_match.
--
-- `import_default_payer(row, dry_run)` (billing.manage; the terminal script signs in as the
-- person running it): a client's default payer as GOrendezvous's invoices show it (the tool keeps,
-- per client, the payer of her latest invoice).
-- * The client and the payer by `client_ref` / `payer_ref` or name (`unmatched`: not found or
--   several, with which one).
-- * The payer herself, or the same payer already the default on that date: `skipped`.
-- * A payer who may not receive her invoices (no relation with « recevoir reçus et factures »):
--   `unmatched`, reason `payer_not_allowed` (the tool lists them: add the relation, then re-run).
-- * From `effective_from` (a date, else today): the dated default, as « Payeur par défaut ».
-- Returns {status: ok | skipped | unmatched | error, dry_run, id, reason, errors}.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:billing_payer_import', true);

create function public.import_default_payer(p_row jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  v_dry boolean := coalesce(p_dry_run, true);
  v_client record;
  v_payer record;
  v_from date;
  v_id uuid;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  if p_row is null or pg_catalog.jsonb_typeof(p_row) <> 'object' then
    raise exception 'Une ligne d''import est un objet JSON.' using errcode = '22023';
  end if;
  begin
    v_from := coalesce(nullif(p_row ->> 'effective_from', '')::date, private.billing_today(v_org));
  exception when others then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'id', null,
      'errors', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'effective_from',
        'message', 'La date est illisible (AAAA-MM-JJ).')));
  end;
  select m.* into v_client from private.clients_import_match(v_org, p_row ->> 'client_ref', p_row ->> 'client_name') m;
  if v_client.status <> 'ok' then
    return pg_catalog.jsonb_build_object('status', 'unmatched', 'dry_run', v_dry, 'id', null,
                                         'reason', case v_client.status when 'ambiguous' then 'client_ambiguous' else 'client_not_found' end);
  end if;
  select m.* into v_payer from private.clients_import_match(v_org, p_row ->> 'payer_ref', p_row ->> 'payer_name') m;
  if v_payer.status <> 'ok' then
    return pg_catalog.jsonb_build_object('status', 'unmatched', 'dry_run', v_dry, 'id', null,
                                         'reason', case v_payer.status when 'ambiguous' then 'payer_ambiguous' else 'payer_not_found' end);
  end if;
  if v_payer.client_id = v_client.client_id then
    return pg_catalog.jsonb_build_object('status', 'skipped', 'dry_run', v_dry, 'id', null, 'reason', 'Le client paie lui-même');
  end if;
  if private.billing_default_payer(v_org, v_client.client_id, v_from) = v_payer.client_id then
    return pg_catalog.jsonb_build_object('status', 'skipped', 'dry_run', v_dry, 'id', null, 'reason', 'Déjà le payeur par défaut');
  end if;
  if not private.billing_payer_allowed(v_org, v_client.client_id, v_payer.client_id) then
    return pg_catalog.jsonb_build_object('status', 'unmatched', 'dry_run', v_dry, 'id', null, 'reason', 'payer_not_allowed');
  end if;
  if v_dry then
    return pg_catalog.jsonb_build_object('status', 'ok', 'dry_run', true, 'id', null);
  end if;
  perform pg_catalog.set_config('app.audit_source', 'import', true);
  insert into public.billing_payer_defaults (org_id, client_id, payer_client_id, effective_from, created_by)
  values (v_org, v_client.client_id, v_payer.client_id, v_from, auth.uid())
  on conflict (org_id, client_id, effective_from) do update
    set payer_client_id = excluded.payer_client_id, created_by = excluded.created_by
  returning id into v_id;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  return pg_catalog.jsonb_build_object('status', 'ok', 'dry_run', false, 'id', v_id);
end;
$$;
revoke all on function public.import_default_payer(jsonb, boolean) from public, anon, authenticated, service_role;
grant execute on function public.import_default_payer(jsonb, boolean) to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);

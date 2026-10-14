-- =============================================================================
-- Clients: the GOrendezvous import of signed consents (I2 prep)
-- =============================================================================
-- Asked:   coordinator, 2026-10-13 (lane A, I2 prep: « the call to
--          import_client_consent_fact_for_service »); decision I-18.
-- Needs:   *_clients_consents.sql (import_client_consent_fact_for_service), *_clients_import.sql
--          (clients_import_assert), *_clients_import_match.sql.
--
-- `import_client_consent(row, dry_run)` (clients.manage and clients.merge, as `import_client`;
-- the terminal script signs in as the person running it): one consent GOrendezvous holds as
-- signed, as a fact (source `import`, no PDF: « Signé dans GOrendezvous le … »), through C5a's
-- `import_client_consent_fact_for_service`, which stays the only writer.
-- * The client by `client_ref` or name (`unmatched` when not found or several); `consent_key`
--   one of the clinic's consents; `signed_at` (not in the future); `version_label` (else
--   « GOrendezvous ») and `signer_name` (a parent, for a minor) as exported.
-- * A consent already in force for that client: `skipped` (never a second one; a re-run resumes).
-- Returns {status: ok | skipped | unmatched | error, dry_run, reason, errors}.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:clients_consent_import', true);

create function public.import_client_consent(p_row jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_dry boolean := coalesce(p_dry_run, true);
  v_match record;
  v_signed timestamptz;
  v_key text;
  v_added boolean;
  v_errors jsonb := '[]';
  v_message text;
  v_hint text;
begin
  perform private.clients_import_assert();
  if p_row is null or pg_catalog.jsonb_typeof(p_row) <> 'object' then
    raise exception 'Une ligne d''import est un objet JSON.' using errcode = '22023';
  end if;
  begin
    v_signed := (p_row ->> 'signed_at')::timestamptz;
  exception when others then
    v_signed := null;
  end;
  if v_signed is null or v_signed > pg_catalog.now() + interval '5 minutes' then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry,
      'errors', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'signed_at',
        'message', 'La date de signature est requise et ne peut pas être dans le futur.')));
  end if;
  v_key := pg_catalog.btrim(coalesce(p_row ->> 'consent_key', ''));
  select m.* into v_match from private.clients_import_match(v_org, p_row ->> 'client_ref', p_row ->> 'client_name') m;
  if v_match.status <> 'ok' then
    return pg_catalog.jsonb_build_object('status', 'unmatched', 'dry_run', v_dry,
                                         'reason', case v_match.status when 'ambiguous' then 'client_ambiguous' else 'client_not_found' end);
  end if;

  begin
    v_added := public.import_client_consent_fact_for_service(v_org, v_match.client_id, v_key,
                 pg_catalog.left(p_row ->> 'version_label', 60), v_signed, pg_catalog.left(p_row ->> 'signer_name', 200));
    if v_dry then
      raise exception 'import_client_consent: rollback' using errcode = 'IMPRB';
    end if;
  exception
    when sqlstate 'IMPRB' then
      null;  -- a dry run: rolled back
    when check_violation then
      v_errors := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', null,
        'message', 'Une valeur de la ligne ne respecte pas les règles de son champ (longueur, caractères).'));
    when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text, v_hint = pg_exception_hint;
      v_errors := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', nullif(v_hint, ''), 'message', v_message));
  end;
  if v_errors <> '[]' then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'errors', v_errors);
  end if;
  if not v_added then
    return pg_catalog.jsonb_build_object('status', 'skipped', 'dry_run', v_dry, 'reason', 'Déjà en vigueur');
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'dry_run', v_dry);
end;
$$;
revoke all on function public.import_client_consent(jsonb, boolean) from public, anon, authenticated, service_role;
grant execute on function public.import_client_consent(jsonb, boolean) to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);

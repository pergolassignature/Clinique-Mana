-- =============================================================================
-- Demandes: the GOrendezvous import of the waiting list (I2, prepared before support's export)
-- =============================================================================
-- Asked:   coordinator, 2026-10-13 (lane A, I2 prep); plan §9 I2; decision I-16.
-- Needs:   *_demandes_waitlist.sql, *_demandes_parity.sql, Clients' private.clients_import_match.
--
-- `import_waitlist_entry(row, dry_run)` (demandes.manage, demandes.waitlist, clients.manage and clients.merge; the terminal
-- script signs in as the person running it): one person on one GOrendezvous waiting list.
-- * `external_ref` « gorendezvous:… » (already imported → `skipped`); the client by `client_ref`
--   or name (`unmatched` when not found or several); the list: `profession_key` (a profession of
--   the catalogue) or `professional_id` (an active professional), exactly one.
-- * Each client's imported entries share one request (`demandes.external_ref`
--   « gorendezvous:waitlist:<client id> », received on her first imported registration (a request's
--   date never changes: the tool sends a client's rows oldest first), channel « Autre »), moved to
--   « Liste d'attente ». A request matched or closed since: `skipped`.
-- * The entry keeps its GOrendezvous date (`registered_at`: its rank in the list), `fee_paid`
--   → the fee « payée » (else « à facturer »), a priority only with its reason; it becomes
--   « active » as any entry (`waitlist_promote`: the « liste d'attente » consent in force, which
--   the consents' import brings, and the fee paid or waived).
-- * The same client already on that list (an open entry of her request): `skipped`.
-- Returns {status: ok | skipped | unmatched | error, dry_run, id, demande_id, reason, errors}.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:demandes_waitlist_import', true);

create function public.import_waitlist_entry(p_row jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_dry boolean := coalesce(p_dry_run, true);
  v_ref text;
  v_dref text;
  v_match record;
  v_demande public.demandes;
  v_title uuid;
  v_pro uuid;
  v_key text;
  v_registered timestamptz;
  v_priority text;
  v_reason text;
  v_fee text;
  v_id uuid;
  v_created boolean := false;
  v_errors jsonb := '[]';
  v_skip text;
  v_message text;
  v_hint text;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  perform private.demandes_require('demandes.manage');
  perform private.demandes_require('demandes.waitlist');
  perform private.clients_import_assert();  -- clients.manage and clients.merge: whoever imports, as I1
  if p_row is null or pg_catalog.jsonb_typeof(p_row) <> 'object' then
    raise exception 'Une ligne d''import est un objet JSON.' using errcode = '22023';
  end if;
  v_ref := pg_catalog.btrim(coalesce(p_row ->> 'external_ref', ''));
  if v_ref !~ '^gorendezvous:[A-Za-z0-9:_-]{1,50}$' then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'id', null,
      'errors', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'external_ref',
        'message', 'La référence GOrendezvous de l''inscription est requise.')));
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('demandes.waitlist_import:' || v_org::text, 0));
  select e.id into v_id from public.waitlist_entries e where e.org_id = v_org and e.external_ref = v_ref;
  if v_id is not null then
    return pg_catalog.jsonb_build_object('status', 'skipped', 'dry_run', v_dry, 'id', v_id, 'reason', 'Déjà importée');
  end if;
  select m.* into v_match from private.clients_import_match(v_org, p_row ->> 'client_ref', p_row ->> 'client_name') m;
  if v_match.status <> 'ok' then
    return pg_catalog.jsonb_build_object('status', 'unmatched', 'dry_run', v_dry, 'id', null,
                                         'reason', case v_match.status when 'ambiguous' then 'client_ambiguous' else 'client_not_found' end);
  end if;
  v_dref := 'gorendezvous:waitlist:' || v_match.client_id::text;

  perform pg_catalog.set_config('app.audit_source', 'import', true);
  begin
    begin
      v_registered := coalesce(nullif(p_row ->> 'registered_at', '')::timestamptz, pg_catalog.now());
      v_pro := nullif(p_row ->> 'professional_id', '')::uuid;
    exception when others then
      raise exception 'Une date d''inscription ou un professionnel est illisible.' using errcode = 'P0001', hint = 'registered_at';
    end;
    if v_registered > pg_catalog.now() + interval '5 minutes' then
      raise exception 'La date d''inscription ne peut pas être dans le futur.' using errcode = 'P0001', hint = 'registered_at';
    end if;
    v_key := nullif(pg_catalog.btrim(coalesce(p_row ->> 'profession_key', '')), '');
    if num_nonnulls(v_key, v_pro) <> 1 then
      raise exception 'Une liste : une profession ou un professionnel (un seul des deux).' using errcode = 'P0001', hint = 'target';
    end if;
    if v_key is not null then
      select t.id into v_title from public.profession_titles_catalog t where t.org_id = v_org and t.key = v_key;
      if v_title is null then
        raise exception 'Cette profession n''est pas au catalogue de la clinique.' using errcode = 'P0001', hint = 'profession_key';
      end if;
    elsif not exists (select 1 from public.professionals_directory p where p.id = v_pro and p.org_id = v_org and p.status = 'active') then
      raise exception 'Le professionnel de la liste est introuvable ou inactif.' using errcode = 'P0001', hint = 'professional_id';
    end if;
    v_reason := nullif(pg_catalog.btrim(coalesce(p_row ->> 'priority_reason', '')), '');
    v_priority := case when v_reason is not null then 'priority' else 'normal' end;
    if v_reason is not null and char_length(v_reason) > 300 then
      v_reason := pg_catalog.left(v_reason, 300);
    end if;
    v_fee := case when pg_catalog.lower(coalesce(p_row ->> 'fee_paid', '')) in ('true', 't', '1') then 'paid' else 'to_invoice' end;

    -- The client's request for her imported entries (the first one creates it).
    select d.* into v_demande from public.demandes d where d.org_id = v_org and d.external_ref = v_dref for update;
    if v_demande.id is null then
      v_id := private.demandes_insert(v_org,
                pg_catalog.jsonb_build_object('client_id', v_match.client_id::text, 'channel', 'other',
                                              'received_at', v_registered::text),
                auth.uid());
      update public.demandes d set external_ref = v_dref, state = 'waitlist' where d.id = v_id returning d.* into v_demande;
      insert into public.demande_events (demande_id, org_id, kind, from_state, to_state, by_user)
      values (v_id, v_org, 'state_changed', 'new', 'waitlist', auth.uid());
      v_created := true;
    elsif v_demande.state in ('matched', 'closed') then
      v_skip := 'Demande jumelée ou fermée depuis';
    end if;
    if v_skip is null and exists (select 1 from public.waitlist_entries e
                                   where e.demande_id = v_demande.id and e.state <> 'closed'
                                     and (e.target_profession_title_id = v_title or e.target_professional_id = v_pro)) then
      v_skip := 'Déjà sur cette liste';
    end if;
    if v_skip is null then
      if v_demande.state <> 'waitlist' then
        update public.demandes d set state = 'waitlist' where d.id = v_demande.id;
        insert into public.demande_events (demande_id, org_id, kind, from_state, to_state, by_user)
        values (v_demande.id, v_org, 'state_changed', v_demande.state, 'waitlist', auth.uid());
      end if;
      insert into public.waitlist_entries
        (org_id, demande_id, client_id, target_profession_title_id, target_professional_id, priority, priority_reason,
         registered_at, registered_by, availability_periods, availability_days, modality, language, preferred_pro_gender,
         clientele_id, payer_kind, fee_status, external_ref)
      values
        (v_org, v_demande.id, v_match.client_id, v_title, v_pro, v_priority, v_reason,
         v_registered, auth.uid(), v_demande.availability_periods, v_demande.availability_days, v_demande.modality,
         v_demande.language, v_demande.preferred_pro_gender, v_demande.clientele_id, v_demande.payer_kind, v_fee, v_ref)
      returning id into v_id;
      perform private.waitlist_promote(v_org, v_id);
    end if;

    if v_dry then
      raise exception 'import_waitlist_entry: rollback' using errcode = 'IMPRB';
    end if;
  exception
    when sqlstate 'IMPRB' then
      null;  -- a dry run: everything above is rolled back
    when check_violation then
      v_errors := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', null,
        'message', 'Une valeur de la ligne ne respecte pas les règles de son champ (longueur, caractères).'));
    when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text, v_hint = pg_exception_hint;
      v_errors := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', nullif(v_hint, ''), 'message', v_message));
  end;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);

  if v_errors <> '[]' then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'id', null, 'errors', v_errors);
  end if;
  if v_skip is not null then
    return pg_catalog.jsonb_build_object('status', 'skipped', 'dry_run', v_dry, 'id', null,
                                         'demande_id', case when not v_dry then v_demande.id end, 'reason', v_skip);
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'dry_run', v_dry,
                                       'id', case when not v_dry then v_id end,
                                       'demande_id', case when not v_dry then v_demande.id end,
                                       'new_demande', v_created);
end;
$$;
revoke all on function public.import_waitlist_entry(jsonb, boolean) from public, anon, authenticated, service_role;
grant execute on function public.import_waitlist_entry(jsonb, boolean) to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);

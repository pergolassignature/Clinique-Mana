-- =============================================================================
-- Communications: fixes of the pre-cutover security review (2026-10-14)
-- =============================================================================
-- Module doc: docs/modules/communications.md « Security review (2026-10-14) »; decisions CM-8,
-- CM-19, SM-6, SM-7, SM-10 (amended). Each function below is its latest body (*_communications_ai_draft,
-- *_communications_sms, *_communications_gmail) with the minimal change; same signatures, so the
-- grants stay.
--
-- 1. `ai_draft_context_for_service`: the actor also needs `communications.inbox`; a thread named
--    must be one she may read (a shared mailbox, or her own); the context returns the display names
--    of the thread's correspondents (from, to, cc, bcc of its messages) so that the function masks
--    them too, whether or not the thread is linked to a file or she holds clients.view.
-- 2. `set_sms_settings`: the PBX address, the application's client id and the clinic's number
--    (`sms_base_url`, `sms_client_id`, `sms_did`) change only with `settings.integrations_manage`
--    (they decide where the client secret is sent); a new PBX address deletes the stored PBX session
--    (its tokens leave Vault through the row's trigger).
-- 3. `queue_sms_for_service`: a test text to a number whose consent is withdrawn is refused. (No
--    staff phone number exists in the data, so a test is not limited to staff numbers.)
-- 4. `claim_sms_batch_for_service`: while Communications is reserved for its testers (P3-40), the
--    queued texts to clients (every kind but `opt_out_ack` and `test`) fail `module_reserved`
--    instead of leaving; a queued test to a withdrawn number fails `consent_withdrawn`.
-- 5. `private.sms_keyword`: the stop words also count as the first word of a text (« STOP merci »,
--    « Arrêt svp »), and « arrête », « arrêter », « arrêtez », « désabonner », « désabonnez »
--    join them. « CANCEL », « END », « QUIT » still count only alone (« Cancel mon rendez-vous »
--    is not a withdrawal), as do « OUI » / « YES ».
-- 6. `private.job_mail_bodies_purge`: the threads of purged messages get their snippet recomputed
--    (it was a copy of the purged one); the same job deletes the drafts untouched for 24 months and
--    the AI call log older than 13 months. The threads already left with a purged snippet are fixed
--    here once.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:communications_security_fixes', true);

-- -----------------------------------------------------------------------------
-- 1. The AI draft's context
-- -----------------------------------------------------------------------------
create or replace function public.ai_draft_context_for_service(p_org_id uuid, p_actor uuid, p_client_id uuid, p_thread_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_keys text[] := private.permission_keys_for(p_actor);
  s public.ai_settings;
  v_client uuid := p_client_id;
  v_first text;
  v_last text;
  v_sender text;
  v_clinic text;
  v_names jsonb := '[]'::jsonb;
begin
  if not ('communications.ai_draft' = any (v_keys))
     or not exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = p_org_id and p.status = 'active') then
    raise exception 'Permission refusée : communications.ai_draft' using errcode = '42501';
  end if;
  if not ('communications.inbox' = any (v_keys)) then
    raise exception 'Permission refusée : communications.inbox' using errcode = '42501';
  end if;
  -- A thread named is one of a mailbox she reads (the clinic's shared ones, or her own).
  if p_thread_id is not null and not exists (
       select 1 from public.mail_threads t
         join public.mail_connections c on c.id = t.connection_id and c.org_id = t.org_id
        where t.id = p_thread_id and t.org_id = p_org_id
          and (c.kind = 'shared' or c.owner_profile_id = p_actor)) then
    raise exception 'Permission refusée : fil de courriels' using errcode = '42501';
  end if;
  select x.* into s from public.ai_settings x where x.org_id = p_org_id;
  if v_client is null and p_thread_id is not null and 'clients.view' = any (v_keys) then
    select l.client_id into v_client
      from public.mail_thread_links l
      join public.mail_threads t on t.id = l.thread_id
     where l.thread_id = p_thread_id and t.org_id = p_org_id and l.status = 'linked';
  end if;
  if v_client is not null and 'clients.view' = any (v_keys) and public.module_enabled_for_org(p_org_id, 'clients') then
    select x.first_name, x.last_name into v_first, v_last
      from private.client_contacts_for(p_org_id, v_client, 'communications') x where x.is_self;
  end if;
  -- Every display name of the thread's correspondents (at most 50, 200 characters each).
  if p_thread_id is not null then
    select coalesce(pg_catalog.jsonb_agg(n.name order by n.name), '[]'::jsonb) into v_names
      from (select distinct pg_catalog.left(pg_catalog.btrim(x.name), 200) as name
              from public.mail_messages m
             cross join lateral (
               select m.from_name as name
               union all
               select e ->> 'name'
                 from pg_catalog.jsonb_array_elements(m.to_addresses || m.cc_addresses || m.bcc_addresses) e
                where pg_catalog.jsonb_typeof(e) = 'object') x
             where m.thread_id = p_thread_id and m.org_id = p_org_id
               and x.name is not null and pg_catalog.btrim(x.name) <> ''
             limit 50) n;
  end if;
  select p.display_name into v_sender from public.profiles p where p.user_id = p_actor;
  select o.name into v_clinic from public.organizations o where o.id = p_org_id;
  return pg_catalog.jsonb_build_object(
    'enabled', coalesce(s.enabled, false),
    'model', coalesce(s.model, 'gpt-5.4'),
    'monthly_cap_cents', coalesce(s.monthly_cap_cents, 5000),
    'input_cents_per_mtok', coalesce(s.input_cents_per_mtok, 125),
    'output_cents_per_mtok', coalesce(s.output_cents_per_mtok, 1000),
    'month_spent_cents', private.ai_month_spent_cents(p_org_id),
    'person', case when v_first is not null or v_last is not null
                   then pg_catalog.jsonb_build_object('first_name', v_first, 'last_name', v_last) end,
    'sender_name', v_sender,
    'clinic_name', v_clinic,
    'correspondent_names', v_names);
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. The PBX settings need settings.integrations_manage
-- -----------------------------------------------------------------------------
create or replace function public.set_sms_settings(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_patch jsonb := p_patch;
  v_current jsonb;
  v_key text;
  r record;
begin
  if not private.has_permission('communications.sms_manage') then
    raise exception 'Permission refusée : communications.sms_manage' using errcode = '42501';
  end if;
  if v_patch is null or pg_catalog.jsonb_typeof(v_patch) <> 'object' then
    raise exception 'Réglages invalides : objet JSON attendu' using errcode = '22023';
  end if;
  for r in select e.key, e.value from pg_catalog.jsonb_each(v_patch) e loop
    perform private.validate_sms_setting(r.key, r.value);
  end loop;
  if v_patch ? 'sms_did' and pg_catalog.jsonb_typeof(v_patch -> 'sms_did') = 'string' then
    v_patch := v_patch || pg_catalog.jsonb_build_object('sms_did', private.sms_normalize_e164(v_patch ->> 'sms_did'));
  end if;
  if v_patch ? 'sms_base_url' and pg_catalog.jsonb_typeof(v_patch -> 'sms_base_url') = 'string' then
    v_patch := v_patch || pg_catalog.jsonb_build_object('sms_base_url', pg_catalog.rtrim(pg_catalog.btrim(v_patch ->> 'sms_base_url'), '/'));
  end if;

  -- Where the client secret goes (the PBX, its application, the clinic's number): an integration.
  v_current := private.sms_settings(v_org);
  foreach v_key in array array['sms_base_url', 'sms_client_id', 'sms_did'] loop
    if v_patch ? v_key and (v_patch -> v_key) is distinct from (v_current -> v_key)
       and not private.has_permission('settings.integrations_manage') then
      raise exception 'Seul un administrateur des intégrations peut changer l''adresse de la centrale, l''identifiant de l''application ou le numéro de la clinique.'
        using errcode = 'P0001';
    end if;
  end loop;

  if v_patch <> '{}'::jsonb then
    perform pg_catalog.set_config('app.audit_source', 'rpc:set_sms_settings', true);
    insert into public.org_module_settings as s (org_id, module_key, settings, updated_by)
    values (v_org, 'communications', v_patch, auth.uid())
    on conflict (org_id, module_key) do update
      set settings = s.settings || excluded.settings,
          updated_by = excluded.updated_by;
    perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  end if;
  -- Another PBX: the session of the previous one is forgotten (its tokens leave Vault).
  if v_patch ? 'sms_base_url' and (v_patch -> 'sms_base_url') is distinct from (v_current -> 'sms_base_url') then
    delete from public.sms_provider_sessions ps where ps.org_id = v_org;
  end if;
  return private.sms_settings(v_org);
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. A test text: never to a withdrawn number
-- -----------------------------------------------------------------------------
create or replace function public.queue_sms_for_service(
  p_org_id uuid,
  p_actor uuid,
  p_to text,
  p_body text,
  p_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keys text[];
  v_id uuid;
  v_row public.sms_messages%rowtype;
begin
  if p_org_id is null or p_actor is null or p_kind is null or p_kind not in ('reply', 'test') then
    raise exception 'Arguments invalides.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = p_org_id and p.status = 'active') then
    raise exception 'Permission refusée : communications.sms' using errcode = '42501';
  end if;
  v_keys := private.permission_keys_for(p_actor);
  if not (case when p_kind = 'test' then 'communications.sms_manage' else 'communications.sms' end = any (v_keys)) then
    raise exception 'Permission refusée : %', case when p_kind = 'test' then 'communications.sms_manage' else 'communications.sms' end
      using errcode = '42501';
  end if;
  if p_kind = 'test' and private.sms_consent_status(p_org_id, private.sms_normalize_e164(p_to)) = 'opted_out' then
    raise exception 'Aucun texto ne peut être envoyé à ce numéro : la personne a retiré son consentement.'
      using errcode = 'P0001', hint = 'opted_out';
  end if;
  v_id := private.send_sms(p_org_id, p_to, p_body, p_kind, null, null, true, p_actor);
  update public.sms_messages m
     set status = 'sending', claimed_at = pg_catalog.now(), attempts = 1,
         request_id = 'mana-' || v_id::text
   where m.id = v_id
  returning * into v_row;
  return pg_catalog.jsonb_build_object('id', v_row.id, 'to_e164', v_row.peer_e164, 'body', v_row.body, 'request_id', v_row.request_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. The dispatch: P3-40 at the last step
-- -----------------------------------------------------------------------------
create or replace function public.claim_sms_batch_for_service(p_org_id uuid, p_limit int default 20)
returns table (id uuid, to_e164 text, body text, kind text, request_id text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  -- A text held for the business hours (`send_after` set) leaves only while they are open: a
  -- backlog never runs into the evening (SM-5).
  v_open boolean;
begin
  if p_org_id is null or p_limit is null or p_limit not between 1 and 200 then
    raise exception 'Arguments invalides.' using errcode = '22023';
  end if;
  v_open := private.sms_business_send_after(p_org_id, pg_catalog.now()) = pg_catalog.now();
  update public.sms_messages m
     set status = 'failed', error_code = 'provider_unavailable'
   where m.org_id = p_org_id and m.status = 'sending' and m.claimed_at < pg_catalog.now() - interval '15 minutes';

  -- P3-40: while Communications is reserved for its testers, nothing queued for a client leaves
  -- (a text queued before the module was reserved included); the test and the « ARRÊT »
  -- acknowledgement still go, as in private.send_sms.
  if not public.module_open_to_all_for_org(p_org_id, 'communications') then
    update public.sms_messages m
       set status = 'failed', error_code = 'module_reserved'
     where m.org_id = p_org_id and m.status = 'queued'
       and m.kind not in ('opt_out_ack', 'test');
  end if;

  update public.sms_messages m
     set status = 'failed', error_code = 'consent_withdrawn'
   where m.org_id = p_org_id and m.status = 'queued'
     and ((m.kind not in ('opt_out_ack', 'test')
           and private.sms_consent_status(p_org_id, m.peer_e164) is distinct from 'opted_in')
          or (m.kind = 'test' and private.sms_consent_status(p_org_id, m.peer_e164) = 'opted_out'));

  return query
    with due as (
      select m.id
        from public.sms_messages m
       where m.org_id = p_org_id and m.status = 'queued'
         and (m.send_after is null or (v_open and m.send_after <= pg_catalog.now()))
       order by m.created_at
       limit p_limit
         for update skip locked
    )
    update public.sms_messages m
       set status = 'sending', claimed_at = pg_catalog.now(), attempts = m.attempts + 1,
           request_id = coalesce(m.request_id, 'mana-' || m.id::text)
      from due
     where m.id = due.id
    returning m.id, m.peer_e164, m.body, m.kind, m.request_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Stop words
-- -----------------------------------------------------------------------------
-- The keyword an inbound text is, if it is one (SM-7): 'stop' for a stop word (« ARRÊT », « ARRET »,
-- « ARRÊTE », « ARRÊTER », « ARRÊTEZ », « STOP », « DÉSABONNER », « DÉSABONNEZ », « UNSUBSCRIBE »)
-- alone or as the text's first word (« STOP merci », « Arrêt svp »), or for « CANCEL », « END »,
-- « QUIT » alone; 'yes' for « OUI » / « YES » alone; null otherwise. Case, accents and the spaces or
-- punctuation around the words do not matter.
create or replace function private.sms_keyword(p_body text)
returns text
language sql
stable
set search_path = ''
as $$
  with w as (
    select pg_catalog.btrim(
             pg_catalog.lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_body, ''))),
             E' \t\r\n.!,;:')
           as word
  ),
  f as (
    select w.word,
           pg_catalog.split_part(pg_catalog.btrim(pg_catalog.regexp_replace(w.word, '[^a-z0-9]+', ' ', 'g')), ' ', 1) as first
      from w
  )
  select case
           when f.first in ('stop', 'arret', 'arrete', 'arreter', 'arretez', 'desabonner', 'desabonnez', 'unsubscribe') then 'stop'
           when f.word in ('cancel', 'end', 'quit') then 'stop'
           when f.word in ('oui', 'yes') then 'yes'
         end
    from f
$$;

-- -----------------------------------------------------------------------------
-- 6. The purge: thread snippets, old drafts, the AI call log
-- -----------------------------------------------------------------------------
-- Bodies older than 24 months: snippet and bodies nulled, the attachments' files soft-deleted
-- (status `purged`), the threads' summaries recomputed (their snippet was the last message's), in
-- batches of 1 000 messages; the rows and headers stay (CM-8). Then the drafts untouched for 24
-- months and the AI calls (a usage log, no text) older than 13 months are deleted.
create or replace function private.job_mail_bodies_purge()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_batch bigint;
  v_total bigint := 0;
  v_files bigint := 0;
  v_threads bigint := 0;
  v_drafts bigint;
  v_ai bigint;
  r record;
begin
  loop
    create temp table if not exists tmp_mail_purge (id uuid) on commit drop;
    truncate tmp_mail_purge;
    insert into tmp_mail_purge
    select m.id from public.mail_messages m
     where m.body_purged_at is null and m.sent_at < pg_catalog.now() - interval '24 months'
     order by m.sent_at
     limit 1000;
    for r in select a.id, a.stored_file_id from public.mail_attachments a
              where a.message_id in (select p.id from tmp_mail_purge p) and a.status <> 'purged'
    loop
      if r.stored_file_id is not null then
        perform private.soft_delete_stored_file(r.stored_file_id, null);
        v_files := v_files + 1;
      end if;
      update public.mail_attachments a set status = 'purged' where a.id = r.id;
    end loop;
    update public.mail_messages m
       set body_html = null, body_text = null, snippet = null, body_purged_at = pg_catalog.now()
     where m.id in (select p.id from tmp_mail_purge p);
    get diagnostics v_batch = row_count;
    v_total := v_total + v_batch;
    for r in select m.org_id, pg_catalog.array_agg(distinct m.thread_id) as thread_ids
               from public.mail_messages m
              where m.id in (select p.id from tmp_mail_purge p)
              group by m.org_id
    loop
      perform private.refresh_mail_threads(r.org_id, r.thread_ids);
      v_threads := v_threads + pg_catalog.cardinality(r.thread_ids);
    end loop;
    exit when v_batch < 1000;
  end loop;
  delete from public.mail_drafts d where d.updated_at < pg_catalog.now() - interval '24 months';
  get diagnostics v_drafts = row_count;
  delete from public.ai_requests a where a.created_at < pg_catalog.now() - interval '13 months';
  get diagnostics v_ai = row_count;
  return 'purged=' || v_total || ' files=' || v_files || ' threads=' || v_threads
         || ' drafts=' || v_drafts || ' ai_requests=' || v_ai;
end;
$$;

update public.scheduled_jobs
   set description = 'Efface le contenu et les pièces jointes des courriels synchronisés il y a plus de 24 mois (les en-têtes restent), les brouillons non modifiés depuis 24 mois et le journal des appels à l''IA de plus de 13 mois.'
 where key = 'communications.mail_bodies_purge';

-- Once: the threads whose last message was purged before this fix still show its snippet.
update public.mail_threads t
   set snippet = null
 where t.snippet is not null
   and (select m.body_purged_at from public.mail_messages m
         where m.thread_id = t.id
         order by m.sent_at desc, m.id desc
         limit 1) is not null;

select pg_catalog.set_config('app.audit_source', '', true);

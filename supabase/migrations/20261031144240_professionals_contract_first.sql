-- =============================================================================
-- Professionnels: « L'entente d'abord » — the contract's sections first (P4-565)
-- =============================================================================
-- Jonathan, « Suivi - application » of 22 October 2026, item 1 « Accès à l'application VS création
-- du profil »: « je me demandais si on ne pourrait pas avoir une première étape pour la cueillette
-- des informations afin de pouvoir générer l'entente en premier. Car avant de prendre le temps de
-- compléter le dossier complet, le professionnel doit avoir le temps de lire et accepter
-- l'entente. Ensuite la création du profil… Clientèle, approche, photo, la preuve d'assurance… ».
-- Needs:   *_professionals_onboarding.sql, *_professionals_fiche.sql (the settings),
--          *_professionals_core_helpers_wording.sql (the latest invitation), the service contract.
-- Rules:   docs/standards/database-conventions.md; CLAUDE.md §6.
--
-- Key choices
-- * **What the entente needs, and nothing else, comes first.** The service contract's
--   professional-side required variables are the name and the login email (on the file since its
--   creation), the address (« Renseignements personnels ») and the profession (« Profil
--   professionnel », which also prices Annexe A). So with « L'entente d'abord » on, an invitation's
--   questionnaire asks those two sections only; staff apply them and prepare the contract as today.
-- * **Then the rest, once the entente is in force**, through the existing update request
--   (« Demander une mise à jour »): the record offers « Demander le reste du profil » with the
--   sections never asked yet already ticked. No new email, no new submission kind: phase two is an
--   update like any other, and the review applies it the same way.
-- * **A clinic setting, off by default** (Paramètres → Invitations), so nothing changes for an
--   invitation already out, nor for a clinic that keeps the single questionnaire. A draft
--   onboarding already open keeps its sections.
-- * Readiness is untouched: until the rest is answered the file still misses its languages,
--   clientèles, motifs and documents, so it cannot be activated by mistake.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_contract_first', true);

-- The sections the service contract needs, in questionnaire order.
create function private.contract_submission_sections()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['personal', 'professional']
$$;
revoke all on function private.contract_submission_sections() from public, anon, authenticated, service_role;

-- Latest body: 20261008211740_professionals_fiche.sql. One more key, off by default.
create or replace function private.professionals_settings_defaults()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{"collect_sin": false, "invitation_expiry_days": 7, "invitation_reminder_after_days": 3,
           "fiche_show_pro_contact": true, "fiche_show_clinic_footer": true, "fiche_show_closing": true,
           "invitation_contract_first": false}'::jsonb
$$;

-- Latest body: 20261008211740_professionals_fiche.sql. One more boolean key.
create or replace function private.validate_professionals_setting(p_key text, p_value jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb := coalesce(p_value, 'null'::jsonb);
begin
  case p_key
    -- booleans, never null: SIN collection (P4-7) and the fiche's render options (P4-353)
    -- P4-565: the entente first (only the sections the contract needs are asked first).
    when 'collect_sin', 'fiche_show_pro_contact', 'fiche_show_clinic_footer', 'fiche_show_closing',
         'invitation_contract_first' then
      if pg_catalog.jsonb_typeof(v) <> 'boolean' then
        raise exception 'Réglage % invalide : true ou false attendu.', p_key using errcode = '22023';
      end if;
    when 'invitation_expiry_days' then   -- whole days, 1 to 30 (the purpose's max_ttl), never null
      if pg_catalog.jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 1 and 30
         or (v #>> '{}')::numeric <> pg_catalog.trunc((v #>> '{}')::numeric) then
        raise exception 'Réglage invitation_expiry_days invalide : un nombre entier de 1 à 30 attendu.' using errcode = '22023';
      end if;
    when 'invitation_reminder_after_days' then   -- whole days, 1 to 29, or null (no reminder)
      if pg_catalog.jsonb_typeof(v) <> 'null'
         and (pg_catalog.jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 1 and 29
              or (v #>> '{}')::numeric <> pg_catalog.trunc((v #>> '{}')::numeric)) then
        raise exception 'Réglage invitation_reminder_after_days invalide : un nombre entier de 1 à 29, ou null, attendu.'
          using errcode = '22023';
      end if;
    else
      raise exception 'Réglage inconnu : %', coalesce(p_key, '(null)') using errcode = '22023';
  end case;
end;
$$;

-- Latest body: 20261011162525_professionals_core_helpers_wording.sql. Only the sections of a new
-- onboarding change; a draft already open keeps its own.
create or replace function private.create_professional_invitation(
  p_actor uuid, p_id uuid, p_token_hash bytea, p_method text, p_source text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
  v_keys text[];
  v_row public.professionals;
  v_link uuid;
  v_sub uuid;
  v_expires timestamptz;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  if p_actor is null or p_id is null or p_token_hash is null or pg_catalog.length(p_token_hash) <> 32 then
    raise exception 'Arguments invalides : acteur, professionnel et empreinte de 32 octets attendus.' using errcode = '22023';
  end if;
  -- The actor's org unlocked, the professional's lock, then the actor's permissions: a change
  -- committed while this waited for the lock is seen (lock before checks, as Task 3.18).
  select p.org_id into v_org from public.profiles p where p.user_id = p_actor;
  select * into v_row from public.professionals p where p.id = p_id and p.org_id = v_org for no key update;
  v_keys := private.permission_keys_for(p_actor);
  if not ('professionals.invite' = any (v_keys))
     or not exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = v_org and p.status = 'active') then
    raise exception 'Permission refusée : professionals.invite' using errcode = '42501';
  end if;
  if v_row.id is null then
    raise exception 'Professionnel introuvable.' using errcode = 'P0001';
  end if;
  if v_row.profile_id is not null then
    raise exception 'Ce professionnel a déjà un compte.' using errcode = 'P0001', hint = 'account';
  end if;
  if v_row.status = 'inactive' then
    raise exception 'Un dossier inactif ne peut pas recevoir d''invitation.' using errcode = 'P0001', hint = 'status';
  end if;

  perform pg_catalog.set_config('app.audit_source', p_source, true);
  perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);

  v_link := private.issue_professional_invitation_link(v_org, p_id, p_token_hash, p_actor);
  insert into public.professional_invitation_deliveries (org_id, professional_id, link_id, method, created_by)
  values (v_org, p_id, v_link, p_method, p_actor);
  if v_row.status = 'draft' then
    update public.professionals p
       set status = 'invited', status_changed_at = pg_catalog.now(), status_changed_by = p_actor
     where p.id = p_id and p.org_id = v_org;
  end if;

  select s.id into v_sub from public.professional_submissions s
   where s.professional_id = p_id and s.org_id = v_org and s.kind = 'onboarding' and s.status = 'draft'
     for update;
  if found then
    update public.professional_submissions s set secure_link_id = v_link where s.id = v_sub;
  elsif exists (select 1 from public.professional_submissions s
                 where s.professional_id = p_id and s.org_id = v_org and s.status in ('draft', 'submitted')) then
    -- An account-less file cannot hold another open submission; refuse rather than guess.
    raise exception 'Un questionnaire est déjà en cours ou attend une révision.' using errcode = 'P0001', hint = 'submission';
  else
    -- P4-565: « L'entente d'abord » asks first only what the service contract needs (the
    -- address and the profession); the rest is asked once the entente is in force.
    v_sub := private.create_professional_submission(v_org, p_id, 'onboarding',
      case when coalesce((private.professionals_setting(v_org, 'invitation_contract_first'))::boolean, false)
           then private.contract_submission_sections()
           else private.submission_sections() end,
      v_link, p_actor);
  end if;

  select l.expires_at into v_expires from public.secure_links l where l.id = v_link;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return pg_catalog.jsonb_build_object('link_id', v_link, 'submission_id', v_sub, 'email', v_row.email,
                                       'first_name', v_row.first_name, 'expires_at', v_expires);
end;
$$;

select pg_catalog.set_config('app.audit_source', '', true);

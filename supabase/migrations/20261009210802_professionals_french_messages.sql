-- =============================================================================
-- Professionnels: the last P0001 messages written in English, in French
-- =============================================================================
-- The 4b review noted « trois messages SQL internes en anglais » (status doc). A scan of the
-- latest definition of every function (raise exception … P0001, explicit or by default, and the
-- HINT texts) finds only these three, all in public.link_professional_account:
--   'Inviter without professionals.invite'  → « L'invitation vient d'une personne qui ne peut plus
--                                               inviter de professionnels. »
--   'Invitation sent to another address'    → « L'invitation a été envoyée à une autre adresse que
--                                               celle du dossier. »
--   'Inactive file'                         → « Ce dossier est inactif. »
-- The function raises them inside its own block and answers {"status": "link_invalid"}: nobody
-- reads them today, but a P0001 is the module's user-facing refusal (conventions §2), so a future
-- caller would show them as written.
--
-- `create or replace` of the latest definition (20261008191219_professionals_onboarding.sql),
-- character for character except the three messages: same signature, so the grants (service role
-- only) are kept. Test: 079_professionals_french_messages.
-- =============================================================================

-- accept-invite's accept_rpc, after it created p_user_id with the address resolve returned. One
-- transaction: lock the professional, consume the link, re-check the inviter (P3-31) and the
-- address, create the profile (active, role provider) and link it. Answers
--   {"status": "accepted", "org_id": …, "redirect": "/mon-profil/questionnaire"}
--   {"status": "link_used" | "link_expired" | "link_invalid"}   the function deletes the user
-- link_invalid also when the inviter no longer holds professionals.invite in the clinic, when the
-- file's address is no longer the one the link was sent to (P4-300) and when the file is inactive
-- (P4-303): the consumption is rolled back; staff re-send it. A file that has meanwhile got an account answers
-- link_used (its link is spent). 22023 (all rolled back) when p_user_id is not an auth user with the
-- professional's address; 23505 when it already has a profile. p_payload is unused.
create or replace function public.link_professional_account(p_token_hash bytea, p_user_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_pid uuid;
  v_row public.professionals;
  v_link public.secure_links%rowtype;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  if p_user_id is null then
    raise exception 'Compte manquant' using errcode = '22023';
  end if;
  -- The link's professional unlocked, then the professional's lock, then the consumption: the
  -- order of every writer of these links (professional, then link).
  select l.org_id, l.subject_id into v_org, v_pid from public.secure_links l
   where l.token_hash = p_token_hash and l.purpose = 'professional_invite' and l.subject_type = 'professional';
  if not found then
    return '{"status": "link_invalid"}'::jsonb;
  end if;
  select * into v_row from public.professionals p where p.id = v_pid and p.org_id = v_org for no key update;
  if not found then
    return '{"status": "link_invalid"}'::jsonb;
  end if;

  -- A block, so that a failed inviter re-check rolls the consumption back.
  begin
    v_link := private.consume_secure_link(p_token_hash, 'professional_invite');
    if v_link.id is null then
      -- Expired, used or revoked since the function's peek: answer what peek would now.
      return pg_catalog.jsonb_build_object('status',
        case public.peek_secure_link(p_token_hash, false) ->> 'state'
          when 'used' then 'link_used' when 'expired' then 'link_expired' else 'link_invalid' end);
    end if;
    if not ('professionals.invite' = any (private.permission_keys_for(v_link.created_by)))
       or not exists (select 1 from public.profiles p where p.user_id = v_link.created_by and p.org_id = v_org) then
      raise exception 'L''invitation vient d''une personne qui ne peut plus inviter de professionnels.' using errcode = 'P0001';
    end if;
    -- The address the link was sent to must still be the file's (read under the lock above).
    if (v_link.scope ->> 'email') is distinct from pg_catalog.lower(v_row.email) then
      raise exception 'L''invitation a été envoyée à une autre adresse que celle du dossier.' using errcode = 'P0001';
    end if;
    if v_row.status = 'inactive' then
      raise exception 'Ce dossier est inactif.' using errcode = 'P0001';
    end if;
  exception
    when raise_exception then
      return '{"status": "link_invalid"}'::jsonb;
  end;

  if v_row.profile_id is not null then
    return '{"status": "link_used"}'::jsonb;
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id and pg_catalog.lower(u.email) = v_row.email) then
    raise exception 'Le compte ne correspond pas à l''invitation' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('app.audit_source', 'rpc:link_professional_account', true);
  perform pg_catalog.set_config('app.audit_actor', p_user_id::text, true);
  -- profiles.email is copied from auth.users by profiles_email_from_auth.
  insert into public.profiles (user_id, org_id, display_name, email, status)
  values (p_user_id, v_org, pg_catalog.rtrim(pg_catalog.left(v_row.first_name || ' ' || v_row.last_name, 80)), v_row.email, 'active');
  insert into public.user_roles (user_id, org_id, role) values (p_user_id, v_org, 'provider');
  update public.professionals p set profile_id = p_user_id where p.id = v_pid and p.org_id = v_org;
  -- The orphan marker has done its job (as accept_staff_invitation).
  begin
    update auth.users u set raw_app_meta_data = u.raw_app_meta_data - 'invite_link_id'
     where u.id = p_user_id and u.raw_app_meta_data ? 'invite_link_id';
  exception
    when insufficient_privilege then
      null;
  end;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);

  return pg_catalog.jsonb_build_object('status', 'accepted', 'org_id', v_org, 'redirect', '/mon-profil/questionnaire');
end;
$$;

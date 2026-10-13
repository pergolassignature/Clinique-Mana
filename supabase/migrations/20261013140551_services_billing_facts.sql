-- =============================================================================
-- Services et tarifs for Facturation F3: the policy and the fee services, for code with no user
-- =============================================================================
-- `billing_policy_on(date)` reads the caller's clinic (`current_user_org_id()`): a job has no
-- user, so the morning queue's drafts (F2) found no policy and no file-opening fee. These two
-- facts name the clinic explicitly (granted to no role; definer callers after their own check):
--   * `private.billing_policy_for(org, day)`: the policy in force (late notice, the first and next
--     fee percents, the file-opening service, the fee mode);
--   * `private.service_id_by_key(org, key)`: a service by its key (the late-cancellation fees
--     `late_cancellation_individual` and `late_cancellation_couple_family`).
-- =============================================================================

create function private.billing_policy_for(p_org uuid, p_on date)
returns setof public.billing_policies
language sql
stable
set search_path = ''
as $$
  select b.*
    from public.billing_policies b
   where b.org_id = p_org and b.effective_from <= p_on and (b.effective_to is null or p_on < b.effective_to)
$$;

create function private.service_id_by_key(p_org uuid, p_key text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select s.id from public.services s where s.org_id = p_org and s.key = p_key
$$;

revoke all on function private.billing_policy_for(uuid, date), private.service_id_by_key(uuid, text)
  from public, anon, authenticated, service_role;

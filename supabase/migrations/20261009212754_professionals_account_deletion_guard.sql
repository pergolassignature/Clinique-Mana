-- =============================================================================
-- Professionnels: the account-deletion guard
-- =============================================================================
-- Rules:   docs/standards/database-conventions.md §8b
-- Needs:   *_core_delete_staff_account.sql (account_deletion_guards, delete_staff_account)
--
-- Key choices
-- * « Supprimer le compte » (core) refuses an account linked to a professional file while the
--   collaboration lasts (any status but `inactive`): the file names the account in
--   `professionals.profile_id`, and no RPC unlinks an account, so deleting it would silently
--   take the professional's sign-in away. The refusal names the file and says what to do.
-- * Once the file is inactive (collaboration ended), the deletion goes ahead: the foreign key
--   sets `profile_id` to null (audited as the file's change), the open submission is already
--   closed by the deactivation, and a reactivation needs a new invitation, as for any file
--   without an account.
-- * The guard is invoker and granted to no role: it runs only inside delete_staff_account
--   (definer), which passes the caller's org.
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:professionals_account_deletion_guard', true);

create function private.professionals_account_deletion_guard(p_org uuid, p_user_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select pg_catalog.format(
           'Ce compte est lié au dossier professionnel de %s. Désactivez d''abord ce dossier dans Professionnels (fin de la collaboration).',
           p.first_name || ' ' || p.last_name)
    from public.professionals p
   where p.org_id = p_org and p.profile_id = p_user_id and p.status <> 'inactive'
$$;

revoke all on function private.professionals_account_deletion_guard(uuid, uuid) from public, anon, authenticated, service_role;

insert into public.account_deletion_guards (module_key, guard_function)
values ('professionals', 'private.professionals_account_deletion_guard')
on conflict do nothing;

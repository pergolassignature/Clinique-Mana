-- =============================================================================
-- profiles.display_name: 1 to 80 characters
-- =============================================================================
-- « Mon compte » lets every user rename themselves (column grant + profiles_update_self).
-- The client trims and allows 1 to 80 characters; this check is its database twin, so a
-- bypassed form cannot store an unbounded name the shell and the audit journal show. The 80 is
-- on the stored value itself, so padding cannot get past it; non-blank is tested on the btrim'd
-- value (spaces, tabs and line breaks stripped). Every writer trims first: the client
-- (updateDisplayName), scripts/bootstrap-admin.sql, and the seed's literals; no RPC writes it.
-- It replaces the unnamed inline check of 20261007140517_core_access.sql (Postgres named it
-- profiles_display_name_check), which used trim() and so let a name of tabs or line breaks
-- through.
-- Existing data: the seed's names are 9 to 18 characters; staging has one profile
-- (« Jonathan Harvey »).
-- =============================================================================

alter table public.profiles
  drop constraint profiles_display_name_check,
  add constraint profiles_display_name_check check (
    length(display_name) <= 80 and length(btrim(display_name, E' \t\r\n')) >= 1
  );

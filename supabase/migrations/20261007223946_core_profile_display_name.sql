-- =============================================================================
-- profiles.display_name: 1 to 80 characters
-- =============================================================================
-- « Mon compte » lets every user rename themselves (column grant + profiles_update_self).
-- The Zod schema there allows 1 to 80 characters once trimmed; this check is its database
-- twin, so a bypassed form cannot store an unbounded name the shell and the audit journal show.
-- It replaces the unnamed inline check of 20261007140517_core_access.sql (Postgres named it
-- profiles_display_name_check), which used trim() and so let a name of tabs or line breaks
-- through. btrim strips spaces, tabs and line breaks, as on organizations.
-- Existing data: the seed's names are 9 to 18 characters; staging has one profile
-- (« Jonathan Harvey »).
-- =============================================================================

alter table public.profiles
  drop constraint profiles_display_name_check,
  add constraint profiles_display_name_check check (length(btrim(display_name, E' \t\r\n')) between 1 and 80);

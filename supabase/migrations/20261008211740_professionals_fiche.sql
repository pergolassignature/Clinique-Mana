-- =============================================================================
-- Professionnels: the fiche PDF, download (« Fiche PDF » → « Télécharger »)
-- =============================================================================
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md Task 4c.5 (pulled forward; P4-58,
--          P4-200–P4-209). The email is the next migration, *_professionals_fiche_email.sql.
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * The fiche is rendered in the browser (@react-pdf/renderer, P4-58), from data the caller
--   already reads (get_professional_record, the catalogue, organizations). Nothing here renders,
--   and no copy of a downloaded fiche is kept (P4-19).
-- * professionals.fiche_generated_at: the last time anyone downloaded or emailed the fiche
--   (design A2.10). No client grant: it moves only through mark_professional_fiche_generated,
--   with professionals.view (the conseillères send fiches after the discovery call), whatever the
--   status (a draft's fiche can be previewed). The audit row it writes is not shown in Historique
--   (P4-203); the stamp also moves updated_at, which no screen shows and no save compares for
--   this table.
-- * The fiche's render options (P4-353, Jonathan's v2 design handoff): three module settings, each a
--   boolean never null, true by default: fiche_show_pro_contact (the professional's public email and
--   phone), fiche_show_clinic_footer (the clinic's phone and website in the footer),
--   fiche_show_closing (« Prochaine étape »). Read by get_professionals_settings (every
--   professionals key, so the conseillère's fiche reads them), changed with professionals.settings.
--   4a.2's two functions are replaced here, as its comment plans for later batches, from 4b's
--   version (the last one): a 4a-only edit would be undone by 4b's `create or replace` (P4-356).
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:professionals_fiche', true);

alter table public.professionals add column fiche_generated_at timestamptz;

-- Stamps the fiche of one professional of the caller's clinic as generated now; returns the stamp.
create function public.mark_professional_fiche_generated(p_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  if not private.has_permission('professionals.view') then
    raise exception 'Permission refusée : professionals.view' using errcode = '42501';
  end if;
  update public.professionals p
     set fiche_generated_at = pg_catalog.now()
   where p.id = p_id and p.org_id = private.current_user_org_id()
  returning p.fiche_generated_at into v_at;
  if v_at is null then
    raise exception 'Professionnel introuvable.' using errcode = 'P0001';
  end if;
  return v_at;
end;
$$;
revoke all on function public.mark_professional_fiche_generated(uuid) from public, anon, authenticated, service_role;
grant execute on function public.mark_professional_fiche_generated(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Module settings: the fiche's render options (4b's two functions, kept in step)
-- -----------------------------------------------------------------------------
create or replace function private.professionals_settings_defaults()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{"collect_sin": false, "invitation_expiry_days": 7, "invitation_reminder_after_days": 3,
           "fiche_show_pro_contact": true, "fiche_show_clinic_footer": true, "fiche_show_closing": true}'::jsonb
$$;

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
    when 'collect_sin', 'fiche_show_pro_contact', 'fiche_show_clinic_footer', 'fiche_show_closing' then
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

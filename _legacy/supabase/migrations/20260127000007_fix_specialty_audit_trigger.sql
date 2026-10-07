-- Migration: Fix professional_specialties audit trigger
-- The proficiency_level column was removed in migration 20260125000002
-- but the audit trigger still references it. Update to use is_specialized instead.

-- =============================================================================
-- UPDATE AUDIT TRIGGER: PROFESSIONAL_SPECIALTIES
-- Replace proficiency_level with is_specialized
-- =============================================================================

create or replace function public.audit_professional_specialty_changes()
returns trigger
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_specialty_name text;
begin
  -- Determine actor
  select id into v_actor_id
  from public.profiles
  where user_id = auth.uid();

  if tg_op = 'INSERT' then
    -- Get specialty name for context
    select name_fr into v_specialty_name
    from public.specialties
    where id = new.specialty_id;

    insert into public.professional_audit_log (professional_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (
      new.professional_id,
      v_actor_id,
      'specialty_added',
      'specialty',
      new.id,
      null,
      jsonb_build_object(
        'specialty_id', new.specialty_id,
        'specialty_name', v_specialty_name,
        'is_specialized', new.is_specialized
      )
    );
    return new;

  elsif tg_op = 'DELETE' then
    -- Get specialty name for context
    select name_fr into v_specialty_name
    from public.specialties
    where id = old.specialty_id;

    insert into public.professional_audit_log (professional_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (
      old.professional_id,
      v_actor_id,
      'specialty_removed',
      'specialty',
      old.id,
      jsonb_build_object(
        'specialty_id', old.specialty_id,
        'specialty_name', v_specialty_name,
        'is_specialized', old.is_specialized
      ),
      null
    );
    return old;
  end if;

  return null;
end;
$$ language plpgsql;

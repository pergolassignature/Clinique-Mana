-- Migration: clients_audit_all_fields
-- Module: clients
-- Purpose: Expand audit trigger to log all field changes, not just name/email
-- Created: 2026-01-21

-- =============================================================================
-- REPLACE AUDIT TRIGGER FUNCTION
-- Now logs all field changes with detailed old/new values
-- =============================================================================

create or replace function public.audit_client_changes()
returns trigger
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_old_data jsonb;
  v_new_data jsonb;
  v_changed_fields jsonb;
begin
  -- Get actor (current user's profile)
  select id into v_actor_id
  from public.profiles
  where user_id = auth.uid();

  if tg_op = 'INSERT' then
    insert into public.client_audit_log (client_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (
      new.id,
      v_actor_id,
      'created',
      'client',
      new.id,
      null,
      jsonb_build_object(
        'client_id', new.client_id,
        'first_name', new.first_name,
        'last_name', new.last_name,
        'email', new.email
      )
    );
    return new;

  elsif tg_op = 'UPDATE' then
    -- Log archive/unarchive as separate action
    if old.is_archived is distinct from new.is_archived then
      insert into public.client_audit_log (client_id, actor_id, action, entity_type, entity_id, old_value, new_value)
      values (
        new.id,
        v_actor_id,
        case when new.is_archived then 'archived' else 'unarchived' end,
        'client',
        new.id,
        jsonb_build_object('is_archived', old.is_archived),
        jsonb_build_object('is_archived', new.is_archived)
      );
    end if;

    -- Build changed fields object for all other changes
    v_changed_fields := '{}'::jsonb;

    -- Identity fields
    if old.first_name is distinct from new.first_name then
      v_changed_fields := v_changed_fields || jsonb_build_object('first_name', jsonb_build_object('old', old.first_name, 'new', new.first_name));
    end if;
    if old.last_name is distinct from new.last_name then
      v_changed_fields := v_changed_fields || jsonb_build_object('last_name', jsonb_build_object('old', old.last_name, 'new', new.last_name));
    end if;
    if old.sex is distinct from new.sex then
      v_changed_fields := v_changed_fields || jsonb_build_object('sex', jsonb_build_object('old', old.sex, 'new', new.sex));
    end if;
    if old.language is distinct from new.language then
      v_changed_fields := v_changed_fields || jsonb_build_object('language', jsonb_build_object('old', old.language, 'new', new.language));
    end if;
    if old.birthday is distinct from new.birthday then
      v_changed_fields := v_changed_fields || jsonb_build_object('birthday', jsonb_build_object('old', old.birthday, 'new', new.birthday));
    end if;

    -- Contact fields
    if old.email is distinct from new.email then
      v_changed_fields := v_changed_fields || jsonb_build_object('email', jsonb_build_object('old', old.email, 'new', new.email));
    end if;
    if old.cell_phone is distinct from new.cell_phone then
      v_changed_fields := v_changed_fields || jsonb_build_object('cell_phone', jsonb_build_object('old', old.cell_phone, 'new', new.cell_phone));
    end if;
    if old.home_phone is distinct from new.home_phone then
      v_changed_fields := v_changed_fields || jsonb_build_object('home_phone', jsonb_build_object('old', old.home_phone, 'new', new.home_phone));
    end if;
    if old.work_phone is distinct from new.work_phone then
      v_changed_fields := v_changed_fields || jsonb_build_object('work_phone', jsonb_build_object('old', old.work_phone, 'new', new.work_phone));
    end if;

    -- Address fields
    if old.street_number is distinct from new.street_number then
      v_changed_fields := v_changed_fields || jsonb_build_object('street_number', jsonb_build_object('old', old.street_number, 'new', new.street_number));
    end if;
    if old.street_name is distinct from new.street_name then
      v_changed_fields := v_changed_fields || jsonb_build_object('street_name', jsonb_build_object('old', old.street_name, 'new', new.street_name));
    end if;
    if old.apartment is distinct from new.apartment then
      v_changed_fields := v_changed_fields || jsonb_build_object('apartment', jsonb_build_object('old', old.apartment, 'new', new.apartment));
    end if;
    if old.city is distinct from new.city then
      v_changed_fields := v_changed_fields || jsonb_build_object('city', jsonb_build_object('old', old.city, 'new', new.city));
    end if;
    if old.province is distinct from new.province then
      v_changed_fields := v_changed_fields || jsonb_build_object('province', jsonb_build_object('old', old.province, 'new', new.province));
    end if;
    if old.country is distinct from new.country then
      v_changed_fields := v_changed_fields || jsonb_build_object('country', jsonb_build_object('old', old.country, 'new', new.country));
    end if;
    if old.postal_code is distinct from new.postal_code then
      v_changed_fields := v_changed_fields || jsonb_build_object('postal_code', jsonb_build_object('old', old.postal_code, 'new', new.postal_code));
    end if;

    -- Admin fields
    if old.primary_professional_id is distinct from new.primary_professional_id then
      v_changed_fields := v_changed_fields || jsonb_build_object('primary_professional_id', jsonb_build_object('old', old.primary_professional_id, 'new', new.primary_professional_id));
    end if;
    if old.tags is distinct from new.tags then
      v_changed_fields := v_changed_fields || jsonb_build_object('tags', jsonb_build_object('old', old.tags, 'new', new.tags));
    end if;
    if old.referred_by is distinct from new.referred_by then
      v_changed_fields := v_changed_fields || jsonb_build_object('referred_by', jsonb_build_object('old', old.referred_by, 'new', new.referred_by));
    end if;

    -- Only log if there are actual changes (excluding is_archived which is logged separately)
    if v_changed_fields != '{}'::jsonb then
      -- Build old and new value objects directly
      select
        jsonb_object_agg(key, value->'old'),
        jsonb_object_agg(key, value->'new')
      into v_old_data, v_new_data
      from jsonb_each(v_changed_fields);

      insert into public.client_audit_log (client_id, actor_id, action, entity_type, entity_id, old_value, new_value)
      values (
        new.id,
        v_actor_id,
        'updated',
        'client',
        new.id,
        v_old_data,
        v_new_data
      );
    end if;

    return new;

  elsif tg_op = 'DELETE' then
    insert into public.client_audit_log (client_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (
      old.id,
      v_actor_id,
      'deleted',
      'client',
      old.id,
      jsonb_build_object('client_id', old.client_id, 'first_name', old.first_name, 'last_name', old.last_name),
      null
    );
    return old;
  end if;

  return null;
end;
$$ language plpgsql;

-- Note: The trigger already exists, so we just need to replace the function
-- The trigger will automatically use the new function definition

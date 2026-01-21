-- Migration: client_relations_audit
-- Module: clients
-- Purpose: Add audit logging for client relations changes
-- Created: 2026-01-22
--
-- Logs relation changes to client_audit_log for both clients involved.
-- Actions: relation_added, relation_removed

-- =============================================================================
-- AUDIT TRIGGER FUNCTION FOR CLIENT RELATIONS
-- =============================================================================

create or replace function public.audit_client_relation_changes()
returns trigger
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_client_a_name text;
  v_client_b_name text;
begin
  -- Get the actor (current user)
  select id into v_actor_id
  from public.profiles
  where user_id = auth.uid();

  if tg_op = 'INSERT' then
    -- Get client names for the audit log
    select first_name || ' ' || last_name into v_client_a_name
    from public.clients where id = new.client_a_id;

    select first_name || ' ' || last_name into v_client_b_name
    from public.clients where id = new.client_b_id;

    -- Log for client A
    insert into public.client_audit_log (client_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (
      new.client_a_id,
      v_actor_id,
      'relation_added',
      'relation',
      new.id,
      null,
      jsonb_build_object(
        'related_client_id', new.client_b_id,
        'related_client_name', v_client_b_name,
        'relation_type', new.relation_type_b_to_a,
        'notes', new.notes
      )
    );

    -- Log for client B
    insert into public.client_audit_log (client_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (
      new.client_b_id,
      v_actor_id,
      'relation_added',
      'relation',
      new.id,
      null,
      jsonb_build_object(
        'related_client_id', new.client_a_id,
        'related_client_name', v_client_a_name,
        'relation_type', new.relation_type_a_to_b,
        'notes', new.notes
      )
    );

    return new;

  elsif tg_op = 'UPDATE' then
    -- Get client names for the audit log
    select first_name || ' ' || last_name into v_client_a_name
    from public.clients where id = new.client_a_id;

    select first_name || ' ' || last_name into v_client_b_name
    from public.clients where id = new.client_b_id;

    -- Log for client A if relation type changed
    if old.relation_type_a_to_b is distinct from new.relation_type_a_to_b
       or old.relation_type_b_to_a is distinct from new.relation_type_b_to_a
       or old.notes is distinct from new.notes then

      insert into public.client_audit_log (client_id, actor_id, action, entity_type, entity_id, old_value, new_value)
      values (
        new.client_a_id,
        v_actor_id,
        'relation_updated',
        'relation',
        new.id,
        jsonb_build_object(
          'related_client_id', old.client_b_id,
          'related_client_name', v_client_b_name,
          'relation_type', old.relation_type_b_to_a,
          'notes', old.notes
        ),
        jsonb_build_object(
          'related_client_id', new.client_b_id,
          'related_client_name', v_client_b_name,
          'relation_type', new.relation_type_b_to_a,
          'notes', new.notes
        )
      );

      -- Log for client B
      insert into public.client_audit_log (client_id, actor_id, action, entity_type, entity_id, old_value, new_value)
      values (
        new.client_b_id,
        v_actor_id,
        'relation_updated',
        'relation',
        new.id,
        jsonb_build_object(
          'related_client_id', old.client_a_id,
          'related_client_name', v_client_a_name,
          'relation_type', old.relation_type_a_to_b,
          'notes', old.notes
        ),
        jsonb_build_object(
          'related_client_id', new.client_a_id,
          'related_client_name', v_client_a_name,
          'relation_type', new.relation_type_a_to_b,
          'notes', new.notes
        )
      );
    end if;

    return new;

  elsif tg_op = 'DELETE' then
    -- Get client names for the audit log
    select first_name || ' ' || last_name into v_client_a_name
    from public.clients where id = old.client_a_id;

    select first_name || ' ' || last_name into v_client_b_name
    from public.clients where id = old.client_b_id;

    -- Log for client A
    insert into public.client_audit_log (client_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (
      old.client_a_id,
      v_actor_id,
      'relation_removed',
      'relation',
      old.id,
      jsonb_build_object(
        'related_client_id', old.client_b_id,
        'related_client_name', v_client_b_name,
        'relation_type', old.relation_type_b_to_a,
        'notes', old.notes
      ),
      null
    );

    -- Log for client B
    insert into public.client_audit_log (client_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (
      old.client_b_id,
      v_actor_id,
      'relation_removed',
      'relation',
      old.id,
      jsonb_build_object(
        'related_client_id', old.client_a_id,
        'related_client_name', v_client_a_name,
        'relation_type', old.relation_type_a_to_b,
        'notes', old.notes
      ),
      null
    );

    return old;
  end if;

  return null;
end;
$$ language plpgsql;

-- =============================================================================
-- CREATE TRIGGER
-- =============================================================================

create trigger client_relations_audit_trigger
  after insert or update or delete on public.client_relations
  for each row
  execute function public.audit_client_relation_changes();

-- =============================================================================
-- COMMENTS
-- =============================================================================

comment on function public.audit_client_relation_changes() is
  'Audit trigger for client_relations. Logs changes to client_audit_log for both clients involved.';

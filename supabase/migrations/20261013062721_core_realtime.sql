-- =============================================================================
-- Core: realtime between staff (roadmap §3.1; plan §10 D2: built with Demandes)
-- =============================================================================
-- One private broadcast channel per clinic and module, `org:<org id>:<module key>`, fed by
-- triggers that send **identifiers only**: `{ module, table, record_id, op }` (PS Hub pushed whole
-- rows through 43 `postgres_changes` subscriptions). The browser invalidates its React Query keys
-- and reads again through its RPCs, so with its own rights; nothing of the row travels.
--
-- * Who may listen: `private.realtime_topic_allowed(topic)`, the RLS policy on
--   `realtime.messages` (Supabase's authorization of private channels): the caller's own clinic
--   and the module's `<module>.view` (the module gate and a disabled or reserved module follow
--   `private.permission_keys_for`).
-- * Who may send: nobody from the browser (no insert policy); the database only, through
--   `realtime.send` (a failure of the broadcast is a warning, never a failed write).
-- * The payload's key is `record_id`, never `id` (`realtime.send` would take an `id` as the
--   message's own id, and two changes of one row in a transaction would collide).
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:core_realtime', true);

-- The topic a module's changes go to.
create function private.realtime_topic(p_org_id uuid, p_module text)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'org:' || p_org_id::text || ':' || p_module
$$;
revoke all on function private.realtime_topic(uuid, text) from public, anon, authenticated, service_role;

-- Whether the caller may listen to `p_topic`: `org:<her clinic>:<module>` and the module's staff
-- permission `<module>.view` (a professional's `.self` alone does not see the clinic's flow).
-- Definer: the policy below calls it for every join.
create function private.realtime_topic_allowed(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[];
  v_org uuid := private.current_user_org_id();
begin
  if v_org is null or p_topic is null or p_topic !~ '^org:[0-9a-f-]{36}:[a-z][a-z0-9_]{0,40}$' then
    return false;
  end if;
  v_parts := pg_catalog.string_to_array(p_topic, ':');
  if v_parts[2] <> v_org::text then
    return false;
  end if;
  return (v_parts[3] || '.view') = any (private.current_permission_keys());
end;
$$;
revoke all on function private.realtime_topic_allowed(text) from public, anon, service_role;
grant execute on function private.realtime_topic_allowed(text) to authenticated;

-- Private channels are authorized by RLS on realtime.messages: reading (joining, receiving) only.
create policy org_module_broadcast_receive on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select private.realtime_topic_allowed((select realtime.topic())))
  );

-- The trigger a module puts on its tables: TG_ARGV[0] the module key, TG_ARGV[1] the column naming
-- the record the screens show (`id`, or `demande_id` for a request's tasks), TG_ARGV[2] (optional)
-- the table name to announce (a child table announces its parent's).
create function private.broadcast_record_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_org uuid := (v_row->>'org_id')::uuid;
begin
  if v_org is null then
    return null;
  end if;
  perform realtime.send(
    jsonb_build_object(
      'module', tg_argv[0],
      'table', coalesce(tg_argv[2], tg_table_name),
      'record_id', v_row->>tg_argv[1],
      'op', pg_catalog.lower(tg_op)
    ),
    'change',
    private.realtime_topic(v_org, tg_argv[0]),
    true
  );
  return null;
end;
$$;
revoke all on function private.broadcast_record_change() from public, anon, authenticated, service_role;

-- Catalog invariants: rules every current AND future table, function and view
-- must satisfy. A new module that breaks a convention fails here, not in review.
-- See docs/standards/database-conventions.md §12.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select is_empty($$
  select c.relname from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity
$$, 'every public table has RLS');

-- pg_policies deparses `(select f())` as `( SELECT f() AS f)`: any call not
-- preceded by SELECT is evaluated per row instead of once per statement.
select is_empty($$
  select tablename || '.' || policyname from pg_policies
   where schemaname = 'public'
     and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ '(?<!SELECT )\m(private|auth)\.[a-z_]+\('
$$, 'policies call private.*/auth.* only wrapped in (select …)');

-- has_*_privilege also sees column-level grants, which information_schema.table_privileges omits.
select is_empty($$
  select c.relname from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f')
     and (has_any_column_privilege('authenticated', c.oid, 'INSERT, REFERENCES')
          or has_table_privilege('authenticated', c.oid, 'DELETE, TRUNCATE, TRIGGER'))
$$, 'no client INSERT/DELETE/TRUNCATE/REFERENCES/TRIGGER, including column grants');

select is_empty($$
  select c.relname from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f')
     and (has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
          or has_table_privilege('anon', c.oid, 'DELETE, TRUNCATE, TRIGGER'))
$$, 'anon has no privilege on any public relation, including column grants');

select is_empty($$
  select p.oid::regprocedure::text from pg_proc p
   where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('public', p.oid, 'EXECUTE'))
$$, 'no public/private function is executable by anon or PUBLIC');

select is_empty($$
  select p.oid::regprocedure::text from pg_proc p
   where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
     and not coalesce('search_path=""' = any(p.proconfig), false)
$$, 'every function pins search_path');

select is_empty($$
  select c.conrelid::regclass || '.' || a.attname from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
   where c.contype = 'f' and c.connamespace = 'public'::regnamespace
     and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])
$$, 'every FK has a leading index');

select is_empty($$
  select c.relname from pg_class c
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     -- Operational logs, exempt on purpose (conventions §7): auditing them would copy recipient
     -- addresses and payloads into the append-only audit_log forever (Loi 25). Phase 3 design §2.5.
     -- scheduled_job_dispatches: one row per pg_net post, purged after 7 days; no business data.
     -- user_preferences: UI state (remembered list filters), private to its user, rewritten on
     -- every filter change; the search text may hold a client's name (Loi 25).
     -- signature_request_syncs: the signing reconcile's per-request state (codes and times),
     -- rewritten every hour for every open request; deleted once the request closes.
     -- mail_threads, mail_messages, mail_attachments, mail_labels, mail_sync_state (CM-2): the
     -- Gmail mirror, written by the sync from what Gmail holds; client correspondence (Loi 25),
     -- purged after 24 months: auditing it would copy every subject, address and snippet into
     -- audit_log forever. What a person does (connect, disconnect, link) is audited.
     -- sms_messages: every text in and out (numbers and bodies, purged after 12 and 24 months);
     -- auditing it would keep them in audit_log forever (Loi 25), like email_log.
     -- sms_provider_sessions: the PBX session's Vault ids, expiries and refresh lease, rewritten
     -- at every token refresh; no business data.
     -- appointment_messages: the delivery log of Rendez-vous' emails and texts (ids, statuses,
     -- no text), one row per recipient and channel, rewritten at each try; like email_log.
     -- qbo_accounts, qbo_customers (FQ-3): the QuickBooks company's chart of accounts and
     -- customers as last read, replaced at each sync; the customers are names, emails and phones
     -- QuickBooks holds (Loi 25). What a person decides (the account map, a match) is audited.
     -- billing_sync_events (F2, agreed with FQ): the QuickBooks outbox, ids and codes only, one row
     -- per issued invoice, credit note and payment, rewritten as the push tries; no business data.
     -- qbo_items, qbo_tax_codes (FQ part 2): the company's items and tax codes as last read, like
     -- qbo_accounts. qbo_pushes: each document's push (state, tries, QuickBooks id, error code),
     -- rewritten at every try; ids and codes only. What a person decides is audited (the map, the
     -- links, the vendors, the switch in org_module_settings).
     -- mail_drafts (CM-14): each person's unsent drafts, autosaved every few seconds and deleted
     -- once sent; auditing them would keep every version of a text that may never leave (and a
     -- client's words quoted in a reply) in audit_log forever. The send itself is audited (mail_sends).
     -- capacity_snapshots (Demandes D5): figures the nightly job computes from audited facts (the
     -- places declared, the matches); the day's row is rewritten when the job runs again.
     -- ai_requests (CM-19): one row per « Rédiger avec l'IA » call, ids, tokens and cost only, never
     -- the text; a usage log like email_log. The settings a person changes (ai_settings) are audited.
     and c.relname not in ('audit_log', 'webhook_events', 'email_log', 'scheduled_job_runs',
                           'scheduled_job_dispatches', 'notifications', 'notification_reads',
                           'user_preferences', 'signature_request_syncs', 'sms_messages',
                           'sms_provider_sessions', 'appointment_messages',
                           'mail_threads', 'mail_messages', 'mail_attachments', 'mail_labels', 'mail_sync_state',
                           'qbo_accounts', 'qbo_customers', 'billing_sync_events',
                           'qbo_items', 'qbo_tax_codes', 'qbo_pushes', 'mail_drafts', 'capacity_snapshots',
                           'ai_requests')
     and not exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                      where t.tgrelid = c.oid and p.proname = 'audit_trigger')
$$, 'every org-scoped table is audited');

select is_empty($$
  select c.relname from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
     and not coalesce('security_invoker=true' = any(c.reloptions), false)
$$, 'views are security_invoker');

-- A data invariant, kept here because every future module must respect it: admin holds
-- every permission in every org (a module migration grants its new permissions to admin in
-- the template, which propagates; the admin rows cannot be deleted except by cascade).
select is_empty($$
  select o.id, pm.key from public.organizations o cross join public.permissions pm
  except
  select x.org_id, x.permission_key from public.org_role_permissions x where x.role = 'admin'
$$, 'admin holds every permission in every org');

-- PostgREST's role loads pg-safeupdate: a DELETE or an UPDATE without WHERE fails (« DELETE
-- requires a WHERE clause ») in any function an RPC reaches, though it passes here as postgres.
-- Clear a temp table with `truncate`; an UPDATE of every row says `where true`.
select is_empty($$
  select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and (p.prosrc ~* '\mdelete\s+from\s+[a-z0-9_."]+\s*;'
          or p.prosrc ~* '\mupdate\s+[a-z0-9_."]+(\s+(as\s+)?[a-z_]+)?\s+set\s((?!\mwhere\M)[^;])*;')
$$, 'no function deletes or updates without a WHERE clause (pg-safeupdate)');

select * from finish();
rollback;

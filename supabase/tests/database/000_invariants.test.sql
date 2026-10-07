-- Catalog invariants: rules every current AND future table, function and view
-- must satisfy. A new module that breaks a convention fails here, not in review.
-- See docs/standards/database-conventions.md §12.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

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
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname <> 'audit_log'
     and not exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                      where t.tgrelid = c.oid and p.proname = 'audit_trigger')
$$, 'every org-scoped table is audited');

select is_empty($$
  select c.relname from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
     and not coalesce('security_invoker=true' = any(c.reloptions), false)
$$, 'views are security_invoker');

select * from finish();
rollback;

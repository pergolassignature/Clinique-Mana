-- Demandes: the index on the date received, every state (migration *_demandes_received_index).
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

select has_index('public', 'demandes', 'demandes_org_received_idx', array['org_id', 'received_at'],
  'demandes: (org_id, received_at) for the report and the closed or all views');
select is((select pg_catalog.pg_get_expr(i.indpred, i.indrelid) from pg_catalog.pg_index i
            where i.indexrelid = 'public.demandes_org_received_idx'::regclass), null, '… every state (not partial)');

select * from finish();
rollback;

-- The matched professional sees the whole request (migration *_demandes_my_demandes_whole.sql,
-- decision R-80). Covers: `my_demandes` now carries « Autre motif », « Autres disponibilités »,
-- the follow-up answers (Enjeux, Consultations antérieures, Contexte légal) and their comments,
-- and « Urgente »; still never the contact, the source, the counselor or the internal note; still
-- only her own matched requests (another professional's, one not matched, another clinic's: none);
-- the same privileges (definer function, the view read-only); a counselor and the module off read
-- nothing.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- =============================================================================
-- Shape and privileges
-- =============================================================================
select columns_are('public', 'my_demandes', array[
  'id', 'org_id', 'reference', 'received_at', 'matched_at', 'client_id', 'beneficiary', 'previous_therapy', 'language', 'modality',
  'availability_periods', 'availability_days', 'preferred_pro_gender', 'profession_title_id', 'clientele_id', 'concerns', 'payer_kind',
  'insurer', 'motif_ids', 'participants',
  'is_urgent', 'motif_other', 'availability_other', 'has_issues', 'issues', 'issues_comment', 'previous_professionals',
  'previous_comment', 'has_legal_context', 'legal_context', 'legal_detail'],
  'my_demandes: the former columns, then the whole intake (R-80)');
select is_empty($$ select 1 from information_schema.columns where table_schema = 'public' and table_name = 'my_demandes'
                    and column_name in ('contact_name', 'contact_email', 'contact_phone_e164', 'source_utm', 'source_referrer',
                                        'source_campaign', 'referral_source_id', 'assigned_to', 'received_by', 'handled_by',
                                        'internal_note', 'closed_reason', 'external_ref') $$,
  'never the contact, the source, the counselor or the note');
select table_privs_are('public', 'my_demandes', 'anon', array[]::text[], 'anon: nothing');
select table_privs_are('public', 'my_demandes', 'authenticated', array['SELECT'], 'authenticated: read only');
select ok((select p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
             from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname = 'my_demandes_rows'),
  'the read model: a definer function for authenticated (it checks demandes.self first)');

-- =============================================================================
-- Fixtures (as postgres): org A (provider P1 with an account, P2 without, a counselor); org B.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@mdw.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 2) n;
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Provider A', 'u1@mdw.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u2@mdw.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'counselor');
insert into public.org_modules (org_id, module_key, enabled)
select o.id, m.key, true
  from (values ('b0000000-0000-0000-0000-00000000000a'::uuid), ('b0000000-0000-0000-0000-00000000000b'::uuid)) o(id)
 cross join (values ('professionals'), ('clients'), ('demandes')) m(key);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001', 'Pro', 'Un', 'u1@mdw.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null, 'Pro', 'Deux', 'p2@mdw.test', 'active'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', null, 'Pro', 'B', 'p3@mdw.test', 'active');

-- D1 matched to P1, the whole intake filled; D2 matched to P2; D3 accepted (not matched); X1 in B.
insert into public.demandes (id, org_id, received_at, contact_name, contact_phone_e164, concerns, state, matched_professional_id, is_urgent,
                             previous_therapy, has_issues, issues, issues_comment, previous_professionals, previous_comment,
                             has_legal_context, legal_context, legal_detail, motif_other, availability_other) values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', '2026-10-12 14:00+00', 'Alice Tremblay', '+15145550101',
   'Difficultés de couple', 'matched', 'c0000000-0000-0000-0000-000000000001', true,
   true, true, '{coparenting}', 'Garde partagée depuis un an', '{psychologist,physician}', 'Suivi il y a deux ans',
   true, '{dpj}', 'Signalement fermé', 'Deuil d''un animal', 'Le vendredi midi');
insert into public.demandes (id, org_id, received_at, contact_name, state, matched_professional_id) values
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', '2026-10-12 15:00+00', 'Bob', 'matched', 'c0000000-0000-0000-0000-000000000002');
insert into public.demandes (id, org_id, received_at, contact_name, state, motif_other) values
  ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', '2026-10-12 16:00+00', 'Chloé', 'accepted', 'Autre chose'),
  ('e0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', '2026-10-12 15:00+00', 'Xavier', 'new', null);
insert into public.demande_notes (demande_id, org_id, internal_note) values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Préfère être appelée le soir.');

-- =============================================================================
-- The professional reads her matched request, whole
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select id from public.my_demandes $$, $$ values ('e0000000-0000-0000-0000-000000000001'::uuid) $$,
  'only her own matched request (never another professional''s, one not matched, another clinic''s)');
select results_eq($$ select motif_other, availability_other, is_urgent, concerns from public.my_demandes $$,
  $$ values ('Deuil d''un animal'::text, 'Le vendredi midi'::text, true, 'Difficultés de couple'::text) $$,
  '« Autre motif », « Autres disponibilités », « Urgente »');
select results_eq($$ select has_issues, issues, issues_comment from public.my_demandes $$,
  $$ values (true, '{coparenting}'::text[], 'Garde partagée depuis un an'::text) $$, 'Enjeux, with their comment');
select results_eq($$ select previous_therapy, previous_professionals, previous_comment from public.my_demandes $$,
  $$ values (true, '{psychologist,physician}'::text[], 'Suivi il y a deux ans'::text) $$, 'Consultations antérieures, with their comment');
select results_eq($$ select has_legal_context, legal_context, legal_detail from public.my_demandes $$,
  $$ values (true, '{dpj}'::text[], 'Signalement fermé'::text) $$, 'Contexte légal, with its comment');

-- =============================================================================
-- Nobody else
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.my_demandes), 0, 'a counselor (no demandes.self, no professional file) reads nothing there');
reset role;
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'demandes';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.my_demandes), 0, 'module off: nothing');
reset role;

select * from finish();
rollback;

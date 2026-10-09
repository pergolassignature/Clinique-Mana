-- Professionnels: sign_my_consent is gone (migration *_professionals_drop_sign_my_consent.sql); the
-- consent is signed through Documenso (prepare_my_image_consent), which remains.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

select hasnt_function('public', 'sign_my_consent', array['uuid', 'text'], 'sign_my_consent(uuid, text) is dropped');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'sign_my_consent'), 0, 'no overload of it is left');
select has_function('public', 'prepare_my_image_consent', 'the Documenso consent remains');

select * from finish();
rollback;

-- Core: functions nothing calls are gone (migration *_core_drop_unused_functions.sql), and the
-- versioned PII helpers that replace the one-argument forms remain.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select hasnt_function('public', 'count_org_emails_today', array['uuid'], 'count_org_emails_today is dropped');
select hasnt_function('private', 'pii_key', array[]::text[], 'the one-argument pii_key() is dropped');
select hasnt_function('private', 'encrypt_pii', array['text'], 'the one-argument encrypt_pii(text) is dropped');
select hasnt_function('private', 'decrypt_pii', array['bytea'], 'the one-argument decrypt_pii(bytea) is dropped');

select has_function('private', 'pii_key', array['integer'], 'pii_key(int) remains');
select has_function('private', 'encrypt_pii', array['text', 'integer'], 'encrypt_pii(text, int) remains');
select has_function('private', 'decrypt_pii', array['bytea', 'integer'], 'decrypt_pii(bytea, int) remains');

select * from finish();
rollback;

-- Seed: auth-foundation
-- Module: auth-foundation
-- Gate: 5 — Local Dev Validation
-- Created: 2026-01-18
--
-- This seed creates test users for local development.
-- Uses fake/anonymized data only.
-- NEVER run this against production.

-- =============================================================================
-- CREATE TEST AUTH USERS
-- These are local Supabase auth users for development/testing
-- =============================================================================

-- Admin user
insert into auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  role,
  aud,
  confirmation_token
) values (
  '11111111-1111-1111-1111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'admin@test.cliniquemana.local',
  crypt('testpassword123', gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}',
  '{"display_name": "Marie-Claire Tremblay"}',
  now(),
  now(),
  'authenticated',
  'authenticated',
  ''
) on conflict (id) do nothing;

-- Staff user
insert into auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  role,
  aud,
  confirmation_token
) values (
  '22222222-2222-2222-2222-222222222222',
  '00000000-0000-0000-0000-000000000000',
  'staff@test.cliniquemana.local',
  crypt('testpassword123', gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}',
  '{"display_name": "Sophie Gagnon"}',
  now(),
  now(),
  'authenticated',
  'authenticated',
  ''
) on conflict (id) do nothing;

-- Provider user 1
insert into auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  role,
  aud,
  confirmation_token
) values (
  '33333333-3333-3333-3333-333333333333',
  '00000000-0000-0000-0000-000000000000',
  'provider1@test.cliniquemana.local',
  crypt('testpassword123', gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}',
  '{"display_name": "Dr. François Lavoie"}',
  now(),
  now(),
  'authenticated',
  'authenticated',
  ''
) on conflict (id) do nothing;

-- Provider user 2
insert into auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  role,
  aud,
  confirmation_token
) values (
  '44444444-4444-4444-4444-444444444444',
  '00000000-0000-0000-0000-000000000000',
  'provider2@test.cliniquemana.local',
  crypt('testpassword123', gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}',
  '{"display_name": "Dr. Anne Bergeron"}',
  now(),
  now(),
  'authenticated',
  'authenticated',
  ''
) on conflict (id) do nothing;

-- =============================================================================
-- CREATE IDENTITIES (required for Supabase Auth)
-- =============================================================================

insert into auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
) values (
  '11111111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111111',
  'admin@test.cliniquemana.local',
  '{"sub": "11111111-1111-1111-1111-111111111111", "email": "admin@test.cliniquemana.local"}',
  'email',
  now(),
  now(),
  now()
) on conflict (id, provider) do nothing;

insert into auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
) values (
  '22222222-2222-2222-2222-222222222222',
  '22222222-2222-2222-2222-222222222222',
  'staff@test.cliniquemana.local',
  '{"sub": "22222222-2222-2222-2222-222222222222", "email": "staff@test.cliniquemana.local"}',
  'email',
  now(),
  now(),
  now()
) on conflict (id, provider) do nothing;

insert into auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
) values (
  '33333333-3333-3333-3333-333333333333',
  '33333333-3333-3333-3333-333333333333',
  'provider1@test.cliniquemana.local',
  '{"sub": "33333333-3333-3333-3333-333333333333", "email": "provider1@test.cliniquemana.local"}',
  'email',
  now(),
  now(),
  now()
) on conflict (id, provider) do nothing;

insert into auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
) values (
  '44444444-4444-4444-4444-444444444444',
  '44444444-4444-4444-4444-444444444444',
  'provider2@test.cliniquemana.local',
  '{"sub": "44444444-4444-4444-4444-444444444444", "email": "provider2@test.cliniquemana.local"}',
  'email',
  now(),
  now(),
  now()
) on conflict (id, provider) do nothing;

-- =============================================================================
-- CREATE PROFILES (linked to auth.users)
-- =============================================================================

-- Admin profile
insert into public.profiles (
  id,
  user_id,
  role,
  display_name,
  email,
  status
) values (
  'aaaa1111-aaaa-1111-aaaa-111111111111',
  '11111111-1111-1111-1111-111111111111',
  'admin',
  'Marie-Claire Tremblay',
  'admin@test.cliniquemana.local',
  'active'
) on conflict (user_id) do nothing;

-- Staff profile
insert into public.profiles (
  id,
  user_id,
  role,
  display_name,
  email,
  status
) values (
  'bbbb2222-bbbb-2222-bbbb-222222222222',
  '22222222-2222-2222-2222-222222222222',
  'staff',
  'Sophie Gagnon',
  'staff@test.cliniquemana.local',
  'active'
) on conflict (user_id) do nothing;

-- Provider profile 1
insert into public.profiles (
  id,
  user_id,
  role,
  display_name,
  email,
  status
) values (
  'cccc3333-cccc-3333-cccc-333333333333',
  '33333333-3333-3333-3333-333333333333',
  'provider',
  'Dr. François Lavoie',
  'provider1@test.cliniquemana.local',
  'active'
) on conflict (user_id) do nothing;

-- Provider profile 2
insert into public.profiles (
  id,
  user_id,
  role,
  display_name,
  email,
  status
) values (
  'dddd4444-dddd-4444-dddd-444444444444',
  '44444444-4444-4444-4444-444444444444',
  'provider',
  'Dr. Anne Bergeron',
  'provider2@test.cliniquemana.local',
  'active'
) on conflict (user_id) do nothing;

-- =============================================================================
-- SUMMARY
-- =============================================================================
--
-- Test Users Created:
-- ┌──────────┬─────────────────────────────────────┬──────────┬────────────────────────────────────┐
-- │ Role     │ Email                               │ Password │ Profile ID                         │
-- ├──────────┼─────────────────────────────────────┼──────────┼────────────────────────────────────┤
-- │ admin    │ admin@test.cliniquemana.local       │ testpassword123 │ aaaa1111-aaaa-1111-aaaa-111111111111 │
-- │ staff    │ staff@test.cliniquemana.local       │ testpassword123 │ bbbb2222-bbbb-2222-bbbb-222222222222 │
-- │ provider │ provider1@test.cliniquemana.local   │ testpassword123 │ cccc3333-cccc-3333-cccc-333333333333 │
-- │ provider │ provider2@test.cliniquemana.local   │ testpassword123 │ dddd4444-dddd-4444-dddd-444444444444 │
-- └──────────┴─────────────────────────────────────┴──────────┴────────────────────────────────────┘
--

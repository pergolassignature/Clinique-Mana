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
-- PROFESSIONAL: ALEXANDRE BOISVERT (Travailleur social)
-- =============================================================================

-- Auth user for Alexandre Boisvert
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
  '55555555-5555-5555-5555-555555555555',
  '00000000-0000-0000-0000-000000000000',
  'boisvertalexts@hotmail.com',
  crypt('testpassword123', gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}',
  '{"display_name": "Alexandre Boisvert"}',
  now(),
  now(),
  'authenticated',
  'authenticated',
  ''
) on conflict (id) do nothing;

-- Identity for Alexandre Boisvert
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
  '55555555-5555-5555-5555-555555555555',
  '55555555-5555-5555-5555-555555555555',
  'boisvertalexts@hotmail.com',
  '{"sub": "55555555-5555-5555-5555-555555555555", "email": "boisvertalexts@hotmail.com"}',
  'email',
  now(),
  now(),
  now()
) on conflict (id, provider) do nothing;

-- Profile for Alexandre Boisvert
insert into public.profiles (
  id,
  user_id,
  role,
  display_name,
  email,
  status
) values (
  'eeee5555-eeee-5555-eeee-555555555555',
  '55555555-5555-5555-5555-555555555555',
  'provider',
  'Alexandre Boisvert',
  'boisvertalexts@hotmail.com',
  'active'
) on conflict (user_id) do nothing;

-- Professional record for Alexandre Boisvert
insert into public.professionals (
  id,
  profile_id,
  status,
  portrait_bio,
  portrait_approach,
  public_email,
  public_phone,
  license_number,
  years_experience,
  fiche_version
) values (
  'ffff5555-ffff-5555-ffff-555555555555',
  'eeee5555-eeee-5555-eeee-555555555555',
  'active',
  'Travailleur social passionné par l''accompagnement des individus et des familles dans leur parcours de vie. Formé à l''intervention psychosociale, je m''intéresse particulièrement aux enjeux relationnels et aux transitions de vie.',
  'Mon approche est centrée sur la personne et ses forces. Je crois en la capacité de chacun à trouver ses propres solutions avec un accompagnement adapté. J''utilise des techniques d''entrevue motivationnelle et d''intervention systémique.',
  'boisvertalexts@hotmail.com',
  '438-503-5751',
  'DESA2410230TS',
  2,
  1
) on conflict (id) do nothing;

-- =============================================================================
-- SPECIALTIES SEED DATA
-- =============================================================================

insert into public.specialties (id, code, name_fr, category, is_active, sort_order) values
  ('11111111-spec-1111-1111-111111111111', 'individual_therapy', 'Thérapie individuelle', 'therapy_type', true, 1),
  ('22222222-spec-2222-2222-222222222222', 'couple_therapy', 'Thérapie de couple', 'therapy_type', true, 2),
  ('33333333-spec-3333-3333-333333333333', 'family_therapy', 'Thérapie familiale', 'therapy_type', true, 3),
  ('44444444-spec-4444-4444-444444444444', 'group_therapy', 'Thérapie de groupe', 'therapy_type', true, 4),
  ('55555555-spec-5555-5555-555555555555', 'adults', 'Adultes', 'population', true, 1),
  ('66666666-spec-6666-6666-666666666666', 'adolescents', 'Adolescents', 'population', true, 2),
  ('77777777-spec-7777-7777-777777777777', 'children', 'Enfants', 'population', true, 3),
  ('88888888-spec-8888-8888-888888888888', 'seniors', 'Aînés', 'population', true, 4),
  ('99999999-spec-9999-9999-999999999999', 'anxiety', 'Anxiété', 'issue', true, 1),
  ('aaaaaaaa-spec-aaaa-aaaa-aaaaaaaaaaaa', 'depression', 'Dépression', 'issue', true, 2),
  ('bbbbbbbb-spec-bbbb-bbbb-bbbbbbbbbbbb', 'trauma', 'Trauma', 'issue', true, 3),
  ('cccccccc-spec-cccc-cccc-cccccccccccc', 'relationships', 'Relations', 'issue', true, 4),
  ('dddddddd-spec-dddd-dddd-dddddddddddd', 'grief', 'Deuil', 'issue', true, 5),
  ('eeeeeeee-spec-eeee-eeee-eeeeeeeeeeee', 'in_person', 'En personne', 'modality', true, 1),
  ('ffffffff-spec-ffff-ffff-ffffffffffff', 'video', 'Vidéoconférence', 'modality', true, 2),
  ('11112222-spec-1111-2222-111122221111', 'phone', 'Téléphone', 'modality', true, 3)
on conflict (id) do nothing;

-- Assign specialties to Alexandre Boisvert
insert into public.professional_specialties (professional_id, specialty_id, proficiency_level) values
  ('ffff5555-ffff-5555-ffff-555555555555', '11111111-spec-1111-1111-111111111111', 'primary'),    -- Thérapie individuelle
  ('ffff5555-ffff-5555-ffff-555555555555', '33333333-spec-3333-3333-333333333333', 'secondary'),  -- Thérapie familiale
  ('ffff5555-ffff-5555-ffff-555555555555', '55555555-spec-5555-5555-555555555555', 'primary'),    -- Adultes
  ('ffff5555-ffff-5555-ffff-555555555555', '66666666-spec-6666-6666-666666666666', 'secondary'),  -- Adolescents
  ('ffff5555-ffff-5555-ffff-555555555555', '99999999-spec-9999-9999-999999999999', 'primary'),    -- Anxiété
  ('ffff5555-ffff-5555-ffff-555555555555', 'cccccccc-spec-cccc-cccc-cccccccccccc', 'primary'),    -- Relations
  ('ffff5555-ffff-5555-ffff-555555555555', 'eeeeeeee-spec-eeee-eeee-eeeeeeeeeeee', 'primary'),    -- En personne
  ('ffff5555-ffff-5555-ffff-555555555555', 'ffffffff-spec-ffff-ffff-ffffffffffff', 'secondary')   -- Vidéoconférence
on conflict do nothing;

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
-- │ provider │ boisvertalexts@hotmail.com          │ testpassword123 │ eeee5555-eeee-5555-eeee-555555555555 │
-- └──────────┴─────────────────────────────────────┴──────────┴────────────────────────────────────┘
--
-- Professionals Created:
-- ┌─────────────────────┬────────────────────┬─────────────────┬────────────────────────────────────┐
-- │ Name                │ Title              │ License         │ Professional ID                    │
-- ├─────────────────────┼────────────────────┼─────────────────┼────────────────────────────────────┤
-- │ Alexandre Boisvert  │ Travailleur social │ DESA2410230TS   │ ffff5555-ffff-5555-ffff-555555555555 │
-- └─────────────────────┴────────────────────┴─────────────────┴────────────────────────────────────┘
--

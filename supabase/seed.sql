-- #############################################################################
-- ##                                                                         ##
-- ##   LOCAL DEVELOPMENT SEED ONLY — NEVER RUN AGAINST STAGING OR PRODUCTION ##
-- ##                                                                         ##
-- ##   Applied by `supabase db reset` on the local stack. Remote resets      ##
-- ##   always pass `--no-seed`. It creates users with a KNOWN PASSWORD.      ##
-- ##                                                                         ##
-- #############################################################################
--
-- Test logins (same password for all four: ManaLocal-2026)
--   admin@mana.test        role admin
--   conseillere@mana.test  role counselor
--   adjointe@mana.test     role admin_assistant
--   provider@mana.test     role provider
--
-- Organization: « Clinique MANA (local) », module `professionals` enabled.

select set_config('app.audit_source', 'seed', false);

-- Guard: refuse to run on a database that already holds real users.
do $$
begin
  if exists (select 1 from auth.users where email not like '%@mana.test') then
    raise exception 'seed.sql is LOCAL ONLY: auth.users already contains non-test accounts';
  end if;
end;
$$;

insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-000000000001', 'Clinique MANA (local)');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u.email,
  extensions.crypt('ManaLocal-2026', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(),
  '', '', '', ''
from (values
  ('11111111-1111-1111-1111-111111111111'::uuid, 'admin@mana.test'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'conseillere@mana.test'),
  ('33333333-3333-3333-3333-333333333333'::uuid, 'provider@mana.test'),
  ('44444444-4444-4444-4444-444444444444'::uuid, 'adjointe@mana.test')
) as u(id, email);

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select
  gen_random_uuid(), u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  now(), now(), now()
from auth.users u
where u.email like '%@mana.test';

insert into public.profiles (user_id, org_id, display_name, email) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'Admin Local',        'admin@mana.test'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001', 'Conseillère Locale', 'conseillere@mana.test'),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000001', 'Pro Local',          'provider@mana.test'),
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000001', 'Adjointe Locale',    'adjointe@mana.test');

insert into public.user_roles (user_id, org_id, role) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'admin'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001', 'counselor'),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000001', 'provider'),
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000001', 'admin_assistant');

insert into public.org_modules (org_id, module_key, enabled, updated_by) values
  ('00000000-0000-0000-0000-000000000001', 'professionals', true, '11111111-1111-1111-1111-111111111111');

-- Local Vault secrets for pg_net → edge functions (fake values; staging gets real ones, plan « Mise en service »).
select vault.create_secret('http://supabase_kong_clinique-mana:8000', 'project_url', 'Local: Kong as seen from the DB container');
select vault.create_secret('local-dev-internal-function-secret', 'internal_function_secret', 'Local: matches supabase/functions/.env');

-- Local Resend webhook secret for the seed org (fake: base64 of « local-dev-resend-webhook »;
-- scripts/send-test-webhook.mjs signs with it). Stored as set_org_secret stores it. No Resend API
-- key: locally EMAIL_TRANSPORT=mailpit needs none.
insert into public.org_secrets (org_id, key, vault_secret_id)
values ('00000000-0000-0000-0000-000000000001', 'resend_webhook_secret',
        vault.create_secret('whsec_bG9jYWwtZGV2LXJlc2VuZC13ZWJob29r',
                            'org:00000000-0000-0000-0000-000000000001:resend_webhook_secret'));

-- Local signing (plan Task 3.32): the fake Documenso (`npm run fake:documenso`, port 55390, seen
-- from the edge-runtime container) and its fake key and webhook secret, stored as set_org_secret
-- stores them.
update public.signing_settings set base_url = 'http://host.docker.internal:55390'
 where org_id = '00000000-0000-0000-0000-000000000001';
insert into public.org_secrets (org_id, key, vault_secret_id)
values
  ('00000000-0000-0000-0000-000000000001', 'documenso_api_key',
   vault.create_secret('local-dev-documenso-key', 'org:00000000-0000-0000-0000-000000000001:documenso_api_key')),
  ('00000000-0000-0000-0000-000000000001', 'documenso_webhook_secret',
   vault.create_secret('local-dev-documenso-webhook-secret',
                       'org:00000000-0000-0000-0000-000000000001:documenso_webhook_secret'));

-- =============================================================================
-- Local test professionals (plan Task 4a.20 « Seed »)
-- =============================================================================
-- Ten fictional professionals in the seed org, fixed ids 5eed0000-0000-0000-0000-0000000000NN so
-- links stay stable across resets. Written through the module's RPCs as « Admin Local »
-- (request.jwt.claims), the way the app writes them: guards, readiness and audit run as usual
-- (audit source `seed`). Two steps have no RPC yet and are plain writes: the record row itself
-- (create_professional draws a random id; the insert below mirrors it: 1:1 rows and French) and
-- the status `in_review` (4b sets it when a questionnaire is submitted). No `invited`: an
-- invitation needs its secure link (4b).
--
--   01 Geneviève Tremblay    active     Psychologue (OPQ)                          124 motifs (all), IVAC
--   02 Isabelle Gagnon       active     Travailleuse sociale (OTSTCFQ) + Psychothérapeute (OPQ)
--                                                                                  all motifs but 13
--   03 Camille Roy           active     Psychologue (OPQ), FR · EN · ES, women only, 14 and over
--                                                                                  25 motifs, 10 categories
--   04 Félix Gauthier        active     Sexologue (OPSQ), linked to provider@mana.test   3 motifs
--   05 Sophie Lavoie         active     Coach professionnelle (no order)           14 motifs (« écrans »)
--   06 Marc-André Pelletier  active     Psychothérapeute (OPQ), not accepting      12 motifs
--   07 Étienne Fortin        active     Travailleur social (OTSTCFQ)               15 motifs
--   08 Nadia Côté            draft      Naturopathe (no order), gaps: clientèle, motif   0 motifs
--   09 Olivier Bergeron      in_review  Psychologue (OPQ), complete, 8 and over    6 motifs
--   10 Julie Morin           inactive   Psychoéducatrice (OPPQ), « Congé » + note, 12 and over
--                                                                                  7 motifs
--
-- Motif and clientèle keys are the website catalogue's (P4-241, P4-244). « Idées suicidaires » and
-- « Trouble de personnalité limite (TPL) » are marked restricted here (P4-16; none is by default)
-- so the rule holds something: only titles from an order carry them. Only OPPQ has a
-- licence_pattern (NNNNN-AA, P4-248), so any other number passes; these follow the usual shapes
-- (OPQ 5 digits, OTSTCFQ « TS » + 5 digits, OPSQ « SX » + 4 digits). Emails and phones are
-- fake (@exemple.test, 555); 04's email is the provider's login, so the two match.
-- One `do` block: the CLI sends the seed as one batch, so no statement may call a function
-- created earlier in the file.
do $seed$
declare
  v_org constant uuid := '00000000-0000-0000-0000-000000000001';
  v_people constant jsonb := $json$[
    {"n": 1, "first": "Geneviève", "last": "Tremblay", "email": "genevieve.tremblay@exemple.test",
     "gender": "female", "years": 18, "city": "Québec", "status": "active",
     "titles": [{"key": "psychologue", "licence": "08417"}],
     "languages": ["fr", "en"],
     "clienteles": ["young_adults", "adults", "couples"], "clienteles_star": ["adults"],
     "motifs": "all",
     "accepting": true, "periods": ["am", "pm"], "availability_note": "Lundi au jeudi, de 9 h à 17 h.",
     "ivac": "IVAC-20417",
     "bio": "Psychologue depuis près de vingt ans, Geneviève accompagne les adultes et les couples dans les périodes où la vie pèse plus lourd : anxiété, deuil, transitions, relations. Elle offre un espace calme où l'on peut déposer ce qu'on vit, à son rythme.",
     "approach": "Approche cognitivo-comportementale et EMDR, intégrées avec souplesse selon vos besoins et vos objectifs.",
     "public_email": "g.tremblay@exemple.test", "public_phone": "+15145550101"},

    {"n": 2, "first": "Isabelle", "last": "Gagnon", "email": "isabelle.gagnon@exemple.test",
     "gender": "female", "years": 14, "city": "Lévis", "status": "active",
     "titles": [{"key": "travailleur_social", "licence": "TS04518"}, {"key": "psychotherapeute", "licence": "31562"}],
     "languages": ["fr", "en"],
     "clienteles": ["adults", "couples", "families", "parents"], "clienteles_star": ["couples", "families"],
     "motifs_except": ["ecrans_usage_excessif", "ecrans_saines_habitudes", "ecrans_conflits_familiaux", "ecrans_desaccord_parental",
                       "ecrans_limites", "ecrans_autoregulation", "ecrans_communication_parent_enfant", "ecrans_impacts_bien_etre",
                       "ecrans_reseaux_sociaux_jeux_ia", "ecrans_perte_controle", "psychologie_du_sport",
                       "defis_adaptation_sport_performance", "problematiques_agriculteurs"],
     "accepting": false, "periods": ["pm", "evening"], "availability_note": "Liste d'attente jusqu'en janvier.",
     "bio": "Travailleuse sociale et psychothérapeute, Isabelle travaille avec les couples et les familles qui traversent une séparation, une recomposition ou des tensions qui s'installent. Elle aide chacun à retrouver sa place et une façon de se parler.",
     "approach": "Approche systémique : on regarde ensemble les liens, les rôles et ce qui se répète, pour ouvrir d'autres possibles.",
     "public_email": "i.gagnon@exemple.test", "public_phone": "+14185550102"},

    {"n": 3, "first": "Camille", "last": "Roy", "email": "camille.roy@exemple.test",
     "gender": "female", "years": 7, "city": "Montréal", "status": "active",
     "titles": [{"key": "psychologue", "licence": "12873"}],
     "languages": ["fr", "en", "es"],
     "clienteles": ["adolescents", "young_adults", "adults"], "clienteles_star": ["adolescents"],
     "min_client_age": 14, "women_only": true,
     "motifs": ["anxiete", "depression", "estime_de_soi", "automutilation", "idees_suicidaires", "troubles_du_sommeil_insomnie",
                "trouble_obsessionnel_compulsif", "situations_crises", "trouble_personnalite_limite",
                "relations_interpersonnelles", "relations_amoureuses", "separation_divorce",
                "relations_familiales", "monoparentalite_famille_recomposee", "dependance_affective",
                "dependances_jeu_jeux_video_cyberdependance", "troubles_alimentaires",
                "deficit_attention_hyperactivite", "troubles_difficultes_apprentissage", "douance", "trouble_spectre_autisme",
                "identite_diversite_orientation_lgbtq", "intimidation",
                "violence_victime", "deuil"],
     "accepting": true, "periods": ["pm", "end_of_day", "evening"],
     "bio": "Camille accompagne les adolescentes et les jeunes femmes, en français, en anglais ou en espagnol. Elle prend le temps de comprendre ce que la personne vit à l'école, en famille ou avec ses amies.",
     "approach": "Thérapie comportementale dialectique (DBT) et TCC, avec des outils concrets pour mieux traverser les émotions intenses.",
     "public_email": "c.roy@exemple.test", "public_phone": "+15145550103"},

    {"n": 4, "first": "Félix", "last": "Gauthier", "email": "provider@mana.test",
     "profile": "33333333-3333-3333-3333-333333333333",
     "gender": "male", "years": 9, "city": "Sherbrooke", "status": "active",
     "titles": [{"key": "sexologue", "licence": "SX0731"}],
     "languages": ["fr"],
     "clienteles": ["adults", "couples"], "clienteles_star": ["couples"],
     "motifs": ["sexualite", "dysfonctions_sexuelles", "identite_diversite_orientation_lgbtq"],
     "accepting": true, "periods": ["evening"], "availability_note": "Soirs de semaine seulement.",
     "bio": "Sexologue, Félix reçoit les personnes et les couples qui souhaitent parler d'intimité, de désir ou d'identité, sans jugement et à leur rythme.",
     "approach": "Approche humaniste, centrée sur la personne et sur ce qu'elle souhaite changer.",
     "public_email": "f.gauthier@exemple.test", "public_phone": "+18195550104"},

    {"n": 5, "first": "Sophie", "last": "Lavoie", "email": "sophie.lavoie@exemple.test",
     "gender": "female", "years": 11, "city": "Gatineau", "status": "active",
     "titles": [{"key": "coach_professionnel"}],
     "languages": ["fr", "en"],
     "clienteles": ["adults", "parents"], "clienteles_star": ["parents"],
     "motifs": ["ecrans_usage_excessif", "ecrans_saines_habitudes", "ecrans_conflits_familiaux", "ecrans_desaccord_parental",
                "ecrans_limites", "ecrans_autoregulation", "ecrans_communication_parent_enfant", "ecrans_impacts_bien_etre",
                "ecrans_reseaux_sociaux_jeux_ia", "ecrans_perte_controle",
                "epuisement_professionnel", "difficultes_professionnelles", "gestion_de_carriere", "estime_de_soi"],
     "accepting": true, "periods": ["am", "weekend"],
     "bio": "Coach professionnelle certifiée, Sophie accompagne les parents qui cherchent de saines habitudes numériques à la maison, et les personnes en questionnement de carrière.",
     "approach": "Coaching orienté vers vos objectifs, inspiré de l'approche d'acceptation et d'engagement (ACT).",
     "public_email": "s.lavoie@exemple.test", "public_phone": "+18195550105"},

    {"n": 6, "first": "Marc-André", "last": "Pelletier", "email": "marc-andre.pelletier@exemple.test",
     "gender": "male", "years": 25, "city": "Trois-Rivières", "status": "active",
     "titles": [{"key": "psychotherapeute", "licence": "27349"}],
     "languages": ["fr"],
     "clienteles": ["adults"], "clienteles_star": ["adults"],
     "motifs": ["anxiete", "depression", "deuil", "maladies_degeneratives", "vieillissement", "proche_aidance",
                "separation_divorce", "relations_amoureuses", "infidelite", "trouble_stress_post_traumatique_tspt",
                "violence_victime", "estime_de_soi"],
     "accepting": false, "periods": ["pm"],
     "bio": "Psychothérapeute d'expérience, Marc-André accompagne les adultes et les aînés dans les deuils, la maladie et les grands changements de la vie.",
     "approach": "Approche psychodynamique et gestaltiste : comprendre son histoire pour mieux vivre le présent.",
     "public_email": "ma.pelletier@exemple.test", "public_phone": "+18195550106"},

    {"n": 7, "first": "Étienne", "last": "Fortin", "email": "etienne.fortin@exemple.test",
     "gender": "male", "years": 5, "city": "Saguenay", "status": "active",
     "titles": [{"key": "travailleur_social", "licence": "TS11273"}],
     "languages": ["fr"],
     "clienteles": ["adults", "families", "parents"], "clienteles_star": ["families"],
     "motifs": ["relations_familiales", "monoparentalite_famille_recomposee", "coparentalite", "violence_conjugale_familiale",
                "separation_divorce", "dependances_alcool_drogue_medicament", "dependance_affective", "garde_enfants",
                "situations_crises", "deuil", "intimidation", "adoption_internationale", "violence_victime",
                "relations_interpersonnelles", "communautes_culturelles_parcours_migratoire"],
     "accepting": true, "periods": ["am", "pm", "weekend"],
     "bio": "Travailleur social, Étienne soutient les familles et les adultes qui vivent une période de crise, une séparation ou des difficultés liées à la consommation.",
     "approach": "Approche systémique et concrète, en lien avec les ressources de votre milieu.",
     "public_email": "e.fortin@exemple.test", "public_phone": "+14185550107"},

    {"n": 8, "first": "Nadia", "last": "Côté", "email": "nadia.cote@exemple.test", "status": "draft",
     "titles": [{"key": "naturopathe"}],
     "languages": ["fr"],
     "accepting": true},

    {"n": 9, "first": "Olivier", "last": "Bergeron", "email": "olivier.bergeron@exemple.test",
     "gender": "male", "years": 3, "city": "Laval", "status": "in_review",
     "titles": [{"key": "psychologue", "licence": "15026"}],
     "languages": ["fr"],
     "clienteles": ["children", "adolescents", "parents"], "clienteles_star": ["children"],
     "min_client_age": 8,
     "motifs": ["deficit_attention_hyperactivite", "troubles_difficultes_apprentissage", "difficultes_comportement_enfant", "anxiete",
                "douance", "trouble_spectre_autisme"],
     "accepting": true, "periods": ["am", "pm"],
     "bio": "Olivier accompagne les enfants à partir de 8 ans et les adolescents, ainsi que leurs parents, dans les défis scolaires, l'attention et l'anxiété.",
     "approach": "Thérapie par le jeu pour les plus jeunes, TCC adaptée pour les adolescents.",
     "public_email": "o.bergeron@exemple.test", "public_phone": "+14505550109"},

    {"n": 10, "first": "Julie", "last": "Morin", "email": "julie.morin@exemple.test",
     "gender": "female", "years": 12, "city": "Longueuil", "status": "inactive",
     "deactivation_reason": "leave", "deactivation_note": "Congé parental, retour prévu en mars 2027.",
     "titles": [{"key": "psychoeducateur", "licence": "41270-15"}],
     "languages": ["fr", "en"],
     "clienteles": ["children", "adolescents", "families", "parents"], "clienteles_star": ["children", "adolescents"],
     "min_client_age": 12,
     "motifs": ["difficultes_comportement", "trouble_oppositionnel_provocation", "trouble_conduites",
                "deficit_attention_hyperactivite", "opposition_gestion_comportements", "discipline_encadrement",
                "relations_familiales"],
     "accepting": true, "periods": ["am"],
     "bio": "Psychoéducatrice, Julie accompagne les enfants, les adolescents et leurs familles dans les défis du quotidien, à la maison comme à l'école.",
     "approach": "Intervention psychoéducative axée sur le vécu partagé et les forces de l'enfant.",
     "public_email": "j.morin@exemple.test", "public_phone": "+14505550110"}
  ]$json$;
  p jsonb;
  v_id uuid;
  v_keys text[];
  v_ids uuid[];
  v_items jsonb;
  v_n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);

  perform public.save_motif(m.id, m.name, m.category_id, true)
     from public.motifs m
    where m.org_id = v_org and m.key in ('idees_suicidaires', 'trouble_personnalite_limite');

  for p in select x from jsonb_array_elements(v_people) as x loop
    v_id := ('5eed0000-0000-0000-0000-' || lpad(p ->> 'n', 12, '0'))::uuid;

    -- The record as create_professional writes it: the row, its 1:1 rows, French.
    insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status_changed_by, created_by)
    values (v_id, v_org, (p ->> 'profile')::uuid, p ->> 'first', p ->> 'last', p ->> 'email', auth.uid(), auth.uid());
    insert into public.professional_public_profiles (org_id, professional_id) values (v_org, v_id);
    insert into public.professional_matching_profiles (org_id, professional_id) values (v_org, v_id);
    insert into public.professional_languages (org_id, professional_id, language_id)
    select v_org, v_id, l.id from public.languages l where l.org_id = v_org and l.code = 'fr';

    -- Plain fields: what the record's forms write (column grants).
    update public.professionals
       set gender = p ->> 'gender', years_experience = (p ->> 'years')::smallint, city = p ->> 'city'
     where id = v_id;
    update public.professional_matching_profiles
       set accepting_new_clients = (p ->> 'accepting')::boolean,
           availability_periods = array(select jsonb_array_elements_text(coalesce(p -> 'periods', '[]'))),
           availability_note = p ->> 'availability_note',
           min_client_age = (p ->> 'min_client_age')::smallint,
           women_only = coalesce((p ->> 'women_only')::boolean, false)
     where professional_id = v_id;
    update public.professional_public_profiles
       set bio = p ->> 'bio', approach = p ->> 'approach',
           public_email = p ->> 'public_email', public_phone = p ->> 'public_phone'
     where professional_id = v_id;

    -- Titles and licences.
    select coalesce(jsonb_agg(jsonb_build_object('title_id', t.id, 'licence_number', e.v ->> 'licence') order by e.ord), '[]'),
           count(t.id)
      into v_items, v_n
      from jsonb_array_elements(p -> 'titles') with ordinality as e(v, ord)
      left join public.profession_titles t on t.org_id = v_org and t.key = e.v ->> 'key';
    if v_n <> jsonb_array_length(p -> 'titles') then
      raise exception 'seed: unknown title in %', p -> 'titles';
    end if;
    perform public.set_professional_professions(v_id, v_items);

    -- Languages.
    v_keys := array(select jsonb_array_elements_text(p -> 'languages'));
    v_ids := array(select l.id from public.languages l where l.org_id = v_org and l.code = any (v_keys));
    if cardinality(v_ids) <> cardinality(v_keys) then
      raise exception 'seed: unknown language in %', v_keys;
    end if;
    perform public.set_professional_languages(v_id, v_ids);

    -- Clientèles, ★ where listed.
    v_keys := array(select jsonb_array_elements_text(coalesce(p -> 'clienteles', '[]')));
    select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'specialized', coalesce(p -> 'clienteles_star', '[]') ? c.key)), '[]'),
           count(*)
      into v_items, v_n
      from public.clienteles c where c.org_id = v_org and c.key = any (v_keys);
    if v_n <> cardinality(v_keys) then
      raise exception 'seed: unknown clientèle in %', v_keys;
    end if;
    perform public.set_professional_clienteles(v_id, v_items);

    -- Motifs: "all", every active one except "motifs_except", or a list of keys.
    if p ->> 'motifs' = 'all' then
      v_ids := array(select m.id from public.motifs m where m.org_id = v_org and m.is_active);
    elsif p ? 'motifs_except' then
      v_keys := array(select jsonb_array_elements_text(p -> 'motifs_except'));
      if (select count(*) from public.motifs m where m.org_id = v_org and m.key = any (v_keys)) <> cardinality(v_keys) then
        raise exception 'seed: unknown motif in %', v_keys;
      end if;
      v_ids := array(select m.id from public.motifs m where m.org_id = v_org and m.is_active and m.key <> all (v_keys));
    else
      v_keys := array(select jsonb_array_elements_text(coalesce(p -> 'motifs', '[]')));
      v_ids := array(select m.id from public.motifs m where m.org_id = v_org and m.key = any (v_keys));
      if cardinality(v_ids) <> cardinality(v_keys) then
        raise exception 'seed: unknown motif in %', v_keys;
      end if;
    end if;
    perform public.set_professional_motifs(v_id, v_ids);

    if p ? 'ivac' then
      perform public.set_professional_payer_number(v_id, 'ivac', p ->> 'ivac');
    end if;

    -- Status: activation runs the readiness check. Since 4b.1 a complete file also has an account
    -- and an approved questionnaire, which no seeded file has: they are activated as imported files
    -- are (P4-20, P4-179), with the override reason, which activate_professional drops for a
    -- complete file.
    if p ->> 'status' in ('active', 'inactive') then
      perform public.activate_professional(v_id, 'Dossier complété hors application');
    end if;
    if p ->> 'status' = 'inactive' then
      perform public.deactivate_professional(
        v_id,
        (select r.id from public.deactivation_reasons r where r.org_id = v_org and r.key = p ->> 'deactivation_reason'),
        p ->> 'deactivation_note');
    end if;
    if p ->> 'status' = 'in_review' then
      update public.professionals
         set status = 'in_review', status_changed_at = now(), status_changed_by = auth.uid()
       where id = v_id;
    end if;
  end loop;

  -- Retention (P4-180…): fake counts and rates so « Révision mensuelle » shows every status.
  -- Months are relative to the clinic's today: the opening balance two months back, last month's
  -- sessions, decisions on the program's start (2026-07-01) and on this month's first day.
  --   01 Geneviève  312 sessions, 25 %                  → Palier maximum atteint
  --   03 Camille    103 sessions, 27,5 %                → Écart à valider (27 % suggested)
  --   04 Félix       60 sessions, 30 % maintained at 51 → Maintenu
  --   05 Sophie      40 sessions, 27 % custom, one client agreement → Taux particulier
  --   07 Étienne    158 sessions, 29 % → 28,5 % this month → Conforme (green for last month)
  --   02 Isabelle, 06 Marc-André: nothing yet          → Écart à valider
  declare
    v_this constant date := greatest(date_trunc('month', private.clinic_today())::date, date '2026-08-01');
    v_last constant date := (date_trunc('month', private.clinic_today()) - interval '1 month')::date;
    v_before constant date := (date_trunc('month', private.clinic_today()) - interval '2 months')::date;
    r record;
    v_decided jsonb;
  begin
    for r in select * from (values
        (1, 312.0, 0, 0), (3, 88.0, 14, 2), (4, 60.0, 0, 0), (5, 40.0, 0, 0), (7, 150.0, 8, 0)
      ) as v(n, opening, long_sessions, short_sessions)
    loop
      v_id := ('5eed0000-0000-0000-0000-' || lpad(r.n::text, 12, '0'))::uuid;
      perform public.record_monthly_sessions(v_before, jsonb_build_array(jsonb_build_object(
        'professional_id', v_id, 'sessions_50_60', 0, 'sessions_30', 0, 'adjustment', r.opening,
        'note', 'Solde d''ouverture (fictif)', 'expected_updated_at', null)));
      if r.long_sessions + r.short_sessions > 0 then
        perform public.record_monthly_sessions(v_last, jsonb_build_array(jsonb_build_object(
          'professional_id', v_id, 'sessions_50_60', r.long_sessions, 'sessions_30', r.short_sessions,
          'expected_updated_at', null)));
      end if;
    end loop;
    -- Each decision counts through last month (the month « Révision mensuelle » reviews) and names
    -- the open decision it replaces (null for the first).
    perform public.decide_retention('5eed0000-0000-0000-0000-000000000001', 'initial', 25, date '2026-07-01', null, v_last, null);
    perform public.decide_retention('5eed0000-0000-0000-0000-000000000003', 'initial', 27.5, date '2026-07-01', null, v_last, null);
    v_decided := public.decide_retention('5eed0000-0000-0000-0000-000000000004', 'initial', 30, date '2026-07-01', null, v_last, null);
    perform public.decide_retention('5eed0000-0000-0000-0000-000000000004', 'maintained', null, v_this, null, v_last,
                                    (v_decided ->> 'id')::uuid);
    perform public.decide_retention('5eed0000-0000-0000-0000-000000000005', 'custom', 27, date '2026-07-01',
                                    'Entente particulière (fictive)', v_last, null);
    perform public.set_professional_client_agreement('5eed0000-0000-0000-0000-000000000005', 'D-1042', 50, 6000, 9000,
                                                     date '2026-07-01', 'Entente fictive');
    v_decided := public.decide_retention('5eed0000-0000-0000-0000-000000000007', 'initial', 29, date '2026-07-01', null, v_last, null);
    perform public.decide_retention('5eed0000-0000-0000-0000-000000000007', 'suggested', null, v_this, null, v_last,
                                    (v_decided ->> 'id')::uuid);
  end;

  perform set_config('request.jwt.claims', '', false);
end;
$seed$;

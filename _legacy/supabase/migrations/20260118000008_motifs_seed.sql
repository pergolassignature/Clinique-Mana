-- Migration: motifs_seed
-- Module: motifs
-- Gate: 2 — Schema (Seed Data)
-- Created: 2026-01-19
--
-- Seeds the official motifs list (72 items).
-- Labels are exact FR-CA strings — do not modify.
-- Keys are stable ASCII snake_case identifiers derived from labels.
--
-- IMPORTANT: Do not rename, shorten, merge, or normalize labels.
-- Motifs are orientation tags, NOT diagnoses.

-- =============================================================================
-- OFFICIAL MOTIFS (72 items)
-- =============================================================================

insert into public.motifs (key, label, is_active, is_restricted) values
  ('abus_sexuel', 'Abus sexuel', true, false),
  ('accumulation_compulsive', 'Accumulation compulsive', true, false),
  ('adoption', 'Adoption', true, false),
  ('anxiete', 'Anxiété', true, false),
  ('automutilation', 'Automutilation', true, false),
  ('comportement_sexuels_abusif', 'Comportement sexuels abusif', true, false),
  ('consommation_alcool', 'Consommation d''alcool', true, false),
  ('consommation_drogue', 'Consommation de drogue', true, false),
  ('cyberdependance', 'Cyberdépendance', true, false),
  ('deficience_intellectuelle', 'Déficience intellectuelle', true, false),
  ('deficit_attention_hyperactivite', 'Déficit de l''attention / hyperactivité (TDA, TDAH)', true, false),
  ('dependance', 'Dépendance', true, false),
  ('dependance_affective', 'Dépendance affective', true, false),
  ('dependance_jeu', 'Dépendance au jeu', true, false),
  ('dependance_medicament', 'Dépendance au médicament', true, false),
  ('dependance_travail', 'Dépendance au travail', true, false),
  ('dependance_jeux_video', 'Dépendance aux jeux vidéo', true, false),
  ('dependance_sexuelle', 'Dépendance sexuelle', true, false),
  ('depression', 'Dépression', true, false),
  ('deuil', 'Deuil', true, false),
  ('difficultes_apprentissage', 'Difficultés d''apprentissage', true, false),
  ('difficultes_comportement', 'Difficultés de comportement', true, false),
  ('difficultes_language', 'Difficultés de language', true, false),
  ('difficultes_professionnelles', 'Difficultés professionnelles', true, false),
  ('douance', 'Douance', true, false),
  ('dysfonctions_sexuelle', 'Dysfonctions sexuelle', true, false),
  ('dyslexie', 'Dyslexie', true, false),
  ('epuisement_professionnel', 'Épuisement professionnel', true, false),
  ('estime_de_soi', 'Estime de soi', true, false),
  ('famille_recomposee', 'Famille recomposée', true, false),
  ('gestion_colere', 'Gestion de la colère', true, false),
  ('grossesse_prenatal_post_partum', 'Grossesse, Prénatal, Post-partum', true, false),
  ('guerre_conflit_arme_veterans', 'Guerre / Conflit armé (Vétérans)', true, false),
  ('guerre_conflit_arme_victimes_civiles', 'Guerre / Conflit armé (Victimes civiles)', true, false),
  ('idees_suicidaires', 'Idées suicidaires', true, false),
  ('identite_genre', 'Identité de genre', true, false),
  ('identite_orientation_sexuelle', 'Identité et Orientation sexuelle', true, false),
  ('identite_raciale', 'Identité raciale', true, false),
  ('infertilite', 'Infertilité', true, false),
  ('infidelite', 'Infidélité', true, false),
  ('insomnie', 'Insomnie', true, false),
  ('intimidation', 'Intimidation', true, false),
  ('maladies_degeneratives', 'Maladies dégénératives', true, false),
  ('monoparentalite', 'Monoparentalité', true, false),
  ('orientation_professionnelle', 'Orientation professionnelle', true, false),
  ('problemes_financiers', 'Problèmes financiers', true, false),
  ('psychose', 'Psychose', true, false),
  ('readaptation_professionnelle', 'Réadaption Professionnelle', true, false),
  ('relations_amoureuses', 'Relations amoureuses', true, false),
  ('relations_familiales', 'Relations familiales', true, false),
  ('relations_interpersonnelles', 'Relations interpersonnelles', true, false),
  ('retard_developpement', 'Retard de développement', true, false),
  ('retard_global_developpement', 'Retard global de développement (RGD)', true, false),
  ('separation_divorce', 'Séparation, Divorce', true, false),
  ('sexualite', 'Sexualité', true, false),
  ('situations_crises', 'Situations de crises', true, false),
  ('syndrome_gilles_tourette', 'Syndrome de Gilles de la Tourette', true, false),
  ('transsexualite', 'Transsexualité', true, false),
  ('traumatisme_cranio_cerebral', 'Traumatisme cranio-cérébral (TCC)', true, false),
  ('traumatisme_stress_post_traumatique', 'Traumatisme et Trouble de stress post-traumatique (TSPT)', true, false),
  ('trouble_bipolaire', 'Trouble bipolaire', true, false),
  ('trouble_personnalite_limite', 'Trouble de personnalité limite (TPL)', true, false),
  ('trouble_personnalite_narcissique', 'Trouble de personnalité narcissique (TPN)', true, false),
  ('trouble_conduites', 'Trouble des conduites', true, false),
  ('trouble_sommeil', 'Trouble du sommeil', true, false),
  ('trouble_spectre_autisme', 'Trouble du spectre de l''autisme', true, false),
  ('trouble_obsessionnel_compulsif', 'Trouble obsessionnel-compulsif (TOC)', true, false),
  ('trouble_oppositionnel_provocation', 'Trouble oppositionnel avec provocation (TOP)', true, false),
  ('troubles_alimentaires', 'Troubles alimentaires', true, false),
  ('victime_agression_sexuelle', 'Victime d''aggression sexuelle', true, false),
  ('victime_violence', 'Victime de violence', true, false),
  ('violence_conjugale_familiale', 'Violence conjugale ou familiale', true, false)
on conflict (key) do update set
  label = excluded.label,
  is_active = excluded.is_active;

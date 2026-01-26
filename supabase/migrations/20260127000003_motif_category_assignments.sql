-- Migration: Assign existing motifs to their respective categories
-- This updates the category_id foreign key based on the MOTIF_DISPLAY_GROUPS mapping

-- Inner Life (Vie intérieure) - 16 motifs
update public.motifs set category_id = (select id from public.motif_categories where key = 'inner_life')
where key in (
  'anxiete',
  'depression',
  'estime_de_soi',
  'gestion_colere',
  'insomnie',
  'trouble_sommeil',
  'idees_suicidaires',
  'automutilation',
  'situations_crises',
  'psychose',
  'trouble_bipolaire',
  'trouble_personnalite_limite',
  'trouble_personnalite_narcissique',
  'trouble_obsessionnel_compulsif',
  'accumulation_compulsive',
  'traumatisme_stress_post_traumatique'
);

-- Relationships (Relations) - 13 motifs
update public.motifs set category_id = (select id from public.motif_categories where key = 'relationships')
where key in (
  'relations_amoureuses',
  'relations_familiales',
  'relations_interpersonnelles',
  'infidelite',
  'dependance_affective',
  'famille_recomposee',
  'separation_divorce',
  'violence_conjugale_familiale',
  'intimidation',
  'adoption',
  'monoparentalite',
  'grossesse_prenatal_post_partum',
  'infertilite'
);

-- Dependencies (Dépendances) - 10 motifs
update public.motifs set category_id = (select id from public.motif_categories where key = 'dependencies')
where key in (
  'dependance',
  'dependance_jeu',
  'dependance_medicament',
  'dependance_travail',
  'dependance_jeux_video',
  'dependance_sexuelle',
  'consommation_alcool',
  'consommation_drogue',
  'cyberdependance',
  'troubles_alimentaires'
);

-- Work (Travail) - 5 motifs
update public.motifs set category_id = (select id from public.motif_categories where key = 'work')
where key in (
  'epuisement_professionnel',
  'difficultes_professionnelles',
  'orientation_professionnelle',
  'readaptation_professionnelle',
  'problemes_financiers'
);

-- Development (Développement) - 13 motifs
update public.motifs set category_id = (select id from public.motif_categories where key = 'development')
where key in (
  'deficit_attention_hyperactivite',
  'difficultes_apprentissage',
  'difficultes_language',
  'difficultes_comportement',
  'douance',
  'dyslexie',
  'retard_developpement',
  'retard_global_developpement',
  'trouble_spectre_autisme',
  'trouble_conduites',
  'trouble_oppositionnel_provocation',
  'deficience_intellectuelle',
  'syndrome_gilles_tourette'
);

-- Identity (Identité) - 6 motifs
update public.motifs set category_id = (select id from public.motif_categories where key = 'identity')
where key in (
  'identite_genre',
  'identite_orientation_sexuelle',
  'identite_raciale',
  'transsexualite',
  'sexualite',
  'dysfonctions_sexuelle'
);

-- Trauma (Traumatismes) - 7 motifs
update public.motifs set category_id = (select id from public.motif_categories where key = 'trauma')
where key in (
  'abus_sexuel',
  'victime_agression_sexuelle',
  'victime_violence',
  'comportement_sexuels_abusif',
  'guerre_conflit_arme_veterans',
  'guerre_conflit_arme_victimes_civiles',
  'traumatisme_cranio_cerebral'
);

-- Life Changes (Changements de vie) - 2 motifs
update public.motifs set category_id = (select id from public.motif_categories where key = 'life_changes')
where key in (
  'deuil',
  'maladies_degeneratives'
);

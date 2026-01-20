import type { MotifDisplayGroup } from './types'

// Visual groupings for display purposes only
// Groups represent neutral "spheres of life", not clinical categories
// These are NOT stored in database and can change without migration
// Keys must match database motifs.key values
export const MOTIF_DISPLAY_GROUPS: MotifDisplayGroup[] = [
  {
    labelKey: 'pages.motifs.groups.innerLife',
    motifKeys: [
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
      'traumatisme_stress_post_traumatique',
    ],
  },
  {
    labelKey: 'pages.motifs.groups.relationships',
    motifKeys: [
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
      'infertilite',
    ],
  },
  {
    labelKey: 'pages.motifs.groups.dependencies',
    motifKeys: [
      'dependance',
      'dependance_jeu',
      'dependance_medicament',
      'dependance_travail',
      'dependance_jeux_video',
      'dependance_sexuelle',
      'consommation_alcool',
      'consommation_drogue',
      'cyberdependance',
      'troubles_alimentaires',
    ],
  },
  {
    labelKey: 'pages.motifs.groups.work',
    motifKeys: [
      'epuisement_professionnel',
      'difficultes_professionnelles',
      'orientation_professionnelle',
      'readaptation_professionnelle',
      'problemes_financiers',
    ],
  },
  {
    labelKey: 'pages.motifs.groups.development',
    motifKeys: [
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
      'syndrome_gilles_tourette',
    ],
  },
  {
    labelKey: 'pages.motifs.groups.identity',
    motifKeys: [
      'identite_genre',
      'identite_orientation_sexuelle',
      'identite_raciale',
      'transsexualite',
      'sexualite',
      'dysfonctions_sexuelle',
    ],
  },
  {
    labelKey: 'pages.motifs.groups.trauma',
    motifKeys: [
      'abus_sexuel',
      'victime_agression_sexuelle',
      'victime_violence',
      'comportement_sexuels_abusif',
      'guerre_conflit_arme_veterans',
      'guerre_conflit_arme_victimes_civiles',
      'traumatisme_cranio_cerebral',
    ],
  },
  {
    labelKey: 'pages.motifs.groups.lifeChanges',
    motifKeys: [
      'deuil',
      'maladies_degeneratives',
    ],
  },
]

// Helper to check if a motif key has special "other" handling
export function isOtherMotif(motifKey: string): boolean {
  return motifKey === 'other' || motifKey === 'autre'
}

// Helper to check if a motif is restricted (uses database is_restricted field)
export function isMotifRestricted(isRestricted: boolean): boolean {
  return isRestricted
}

// Get all motif keys from display groups (for validation)
export function getGroupedMotifKeys(): string[] {
  return MOTIF_DISPLAY_GROUPS.flatMap((group) => group.motifKeys)
}

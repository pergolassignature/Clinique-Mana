// src/document-templates/constants.ts

// =============================================================================
// TEMPLATE KEYS
// =============================================================================

/** Template keys used across the app */
export const TEMPLATE_KEYS = {
  SERVICE_CONTRACT: 'contrat_service',
} as const

export type TemplateKey = (typeof TEMPLATE_KEYS)[keyof typeof TEMPLATE_KEYS]

// =============================================================================
// KNOWN VARIABLES
// =============================================================================

/** All known variables that can be used in templates */
export const KNOWN_VARIABLES = [
  'clinic.name',
  'clinic.address',
  'clinic.representative',
  'clinic.representative_title',
  'clinic.legal_form',
  'professional.full_name',
  'professional.email',
  'professional.phone',
  'professional.address',
  'professional.profession',
  'professional.license_number',
  'today',
  'pricing.annexe_a_html',
] as const

export type TemplateVariable = (typeof KNOWN_VARIABLES)[number]

// =============================================================================
// VARIABLE GROUPS (for cheatsheet UI)
// =============================================================================

/** Group variables by category for the cheatsheet UI */
export const VARIABLE_GROUPS = [
  {
    label: 'Clinique',
    variables: [
      { key: 'clinic.name', description: 'Nom legal de la clinique', example: 'CLINIQUE MANA INC' },
      { key: 'clinic.address', description: 'Adresse du siege social', example: '300 \u2013 797 Boul. Lebourgneuf, Qc, G2J 0B5' },
      { key: 'clinic.representative', description: 'Representante de la clinique', example: 'Madame Christine Sirois' },
      { key: 'clinic.representative_title', description: 'Titre de la representante', example: 'sa presidente dument autorisee' },
      { key: 'clinic.legal_form', description: 'Forme juridique', example: 'corporation legalement constituee...' },
    ],
  },
  {
    label: 'Professionnel',
    variables: [
      { key: 'professional.full_name', description: 'Nom complet du professionnel', example: 'Jean Tremblay' },
      { key: 'professional.email', description: 'Courriel du professionnel', example: 'jean@exemple.com' },
      { key: 'professional.phone', description: 'Telephone du professionnel', example: '(418) 555-0123' },
      { key: 'professional.address', description: 'Adresse du professionnel', example: '123 Rue Exemple, Quebec...' },
      { key: 'professional.profession', description: 'Titre professionnel', example: 'Psychologue' },
      { key: 'professional.license_number', description: 'Numero de permis', example: '12345-67' },
    ],
  },
  {
    label: 'Dates',
    variables: [
      { key: 'today', description: 'Date du jour', example: '28 janvier 2026' },
    ],
  },
  {
    label: 'Tarification',
    variables: [
      { key: 'pricing.annexe_a_html', description: 'Tableau des honoraires (HTML)', example: '<table>...</table>' },
    ],
  },
] as const

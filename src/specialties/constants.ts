// src/specialties/constants.ts
// Constants for the specialties module

import type { SpecialtyCategory } from './types'

/**
 * Display labels for specialty categories (FR-CA)
 */
export const SPECIALTY_CATEGORY_LABELS: Record<SpecialtyCategory, string> = {
  clientele: 'Clientèle',
  therapy_type: 'Types de thérapie',
}

/**
 * Display order for specialty categories
 */
export const SPECIALTY_CATEGORY_ORDER: SpecialtyCategory[] = [
  'clientele',
  'therapy_type',
]

/**
 * Category descriptions for UI
 */
export const SPECIALTY_CATEGORY_DESCRIPTIONS: Record<SpecialtyCategory, string> = {
  clientele: 'Groupes d\'âge et types de clientèle desservis',
  therapy_type: 'Approches thérapeutiques utilisées',
}

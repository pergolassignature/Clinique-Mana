// Database motif record
export interface DbMotif {
  id: string
  key: string
  label: string
  is_active: boolean
  is_restricted: boolean
}

// Visual grouping for display purposes only
// Groups represent neutral "spheres of life", not clinical categories
// These are NOT stored in database and can change without migration
export interface MotifDisplayGroup {
  labelKey: string // i18n key for group label
  motifKeys: string[] // database keys belonging to this group
}

// UI representation of a motif (derived from DbMotif)
export interface Motif {
  key: string
  label: string
  isRestricted: boolean
  isActive?: boolean
}

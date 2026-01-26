// Database motif record
export interface DbMotif {
  id: string
  key: string
  label: string
  is_active: boolean
  is_restricted: boolean
  category_id: string | null
}

// Database motif category record (matches Supabase table)
export interface DbMotifCategory {
  id: string
  key: string
  label_fr: string
  description_fr: string | null
  icon_name: string | null
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
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

// Application type for motif category (camelCase for frontend)
export interface MotifCategory {
  id: string
  key: string
  label: string
  description: string | null
  iconName: string | null
  displayOrder: number
  isActive: boolean
}

// For creating/updating categories
export interface MotifCategoryInput {
  key: string
  label: string
  description?: string
  iconName?: string
  displayOrder?: number
}

// Extended Motif with category info
export interface MotifWithCategory extends Motif {
  categoryId: string | null
  category?: MotifCategory
}

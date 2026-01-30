// src/specialties/types.ts
// Types for the specialties module

import { z } from 'zod'

// Category enum matching database constraint
export const SpecialtyCategorySchema = z.enum([
  'therapy_type',
  'clientele',
])
export type SpecialtyCategory = z.infer<typeof SpecialtyCategorySchema>


// Specialty from database
export const SpecialtySchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name_fr: z.string(),
  category: SpecialtyCategorySchema,
  is_active: z.boolean(),
  sort_order: z.number(),
  created_at: z.string().datetime(),
})
export type Specialty = z.infer<typeof SpecialtySchema>

// Input for creating a new specialty
export interface CreateSpecialtyInput {
  code: string
  name_fr: string
  category: SpecialtyCategory
  sort_order?: number
}

// Input for updating a specialty
export interface UpdateSpecialtyInput {
  name_fr?: string
  category?: SpecialtyCategory
  sort_order?: number
}

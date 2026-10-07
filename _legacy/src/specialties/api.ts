// src/specialties/api.ts
// API functions for the specialties module

import { supabase } from '@/lib/supabaseClient'
import type { Specialty, CreateSpecialtyInput, UpdateSpecialtyInput, SpecialtyCategory } from './types'

/**
 * Fetch all specialties (including inactive ones for management)
 */
export async function fetchAllSpecialties(): Promise<Specialty[]> {
  const { data, error } = await supabase
    .from('specialties')
    .select('*')
    .order('category')
    .order('sort_order')
    .order('name_fr')

  if (error) throw error
  return data || []
}

/**
 * Fetch active specialties only
 */
export async function fetchActiveSpecialties(): Promise<Specialty[]> {
  const { data, error } = await supabase
    .from('specialties')
    .select('*')
    .eq('is_active', true)
    .order('category')
    .order('sort_order')
    .order('name_fr')

  if (error) throw error
  return data || []
}

/**
 * Fetch specialties grouped by category
 */
export async function fetchSpecialtiesByCategory(
  includeInactive = false
): Promise<Record<SpecialtyCategory, Specialty[]>> {
  const specialties = includeInactive
    ? await fetchAllSpecialties()
    : await fetchActiveSpecialties()

  const grouped: Record<string, Specialty[]> = {}

  for (const specialty of specialties) {
    if (!grouped[specialty.category]) {
      grouped[specialty.category] = []
    }
    grouped[specialty.category]!.push(specialty)
  }

  return grouped as Record<SpecialtyCategory, Specialty[]>
}

/**
 * Create a new specialty
 */
export async function createSpecialty(input: CreateSpecialtyInput): Promise<Specialty> {
  const { data, error } = await supabase
    .from('specialties')
    .insert({
      code: input.code,
      name_fr: input.name_fr,
      category: input.category,
      sort_order: input.sort_order ?? 0,
      is_active: true,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Update a specialty
 */
export async function updateSpecialty(
  id: string,
  input: UpdateSpecialtyInput
): Promise<Specialty> {
  const { data, error } = await supabase
    .from('specialties')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Archive a specialty (soft delete)
 */
export async function archiveSpecialty(id: string): Promise<Specialty> {
  const { data, error } = await supabase
    .from('specialties')
    .update({ is_active: false })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Restore an archived specialty
 */
export async function unarchiveSpecialty(id: string): Promise<Specialty> {
  const { data, error } = await supabase
    .from('specialties')
    .update({ is_active: true })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Check if a code is already in use
 */
export async function isCodeUnique(code: string, excludeId?: string): Promise<boolean> {
  let query = supabase
    .from('specialties')
    .select('id')
    .eq('code', code)

  if (excludeId) {
    query = query.neq('id', excludeId)
  }

  const { data, error } = await query

  if (error) throw error
  return (data || []).length === 0
}

/**
 * Count professionals using a specialty
 */
export async function countProfessionalsUsingSpecialty(specialtyId: string): Promise<number> {
  const { count, error } = await supabase
    .from('professional_specialties')
    .select('*', { count: 'exact', head: true })
    .eq('specialty_id', specialtyId)

  if (error) throw error
  return count || 0
}

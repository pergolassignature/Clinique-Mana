// src/motifs/api.ts
// API functions for the motif categories module

import { supabase } from '@/lib/supabaseClient'
import type { DbMotifCategory, MotifCategory, MotifCategoryInput } from './types'

/**
 * Map database category record to application type
 */
function mapDbCategory(db: DbMotifCategory): MotifCategory {
  return {
    id: db.id,
    key: db.key,
    label: db.label_fr,
    description: db.description_fr,
    iconName: db.icon_name,
    displayOrder: db.display_order,
    isActive: db.is_active,
  }
}

/**
 * Fetch all categories (including inactive for admin)
 */
export async function fetchAllMotifCategories(): Promise<MotifCategory[]> {
  const { data, error } = await supabase
    .from('motif_categories')
    .select('*')
    .order('display_order', { ascending: true })

  if (error) throw error
  return (data ?? []).map(mapDbCategory)
}

/**
 * Fetch active categories only
 */
export async function fetchActiveMotifCategories(): Promise<MotifCategory[]> {
  const { data, error } = await supabase
    .from('motif_categories')
    .select('*')
    .eq('is_active', true)
    .order('display_order', { ascending: true })

  if (error) throw error
  return (data ?? []).map(mapDbCategory)
}

/**
 * Create a new motif category
 */
export async function createMotifCategory(input: MotifCategoryInput): Promise<MotifCategory> {
  const { data, error } = await supabase
    .from('motif_categories')
    .insert({
      key: input.key,
      label_fr: input.label,
      description_fr: input.description ?? null,
      icon_name: input.iconName ?? null,
      display_order: input.displayOrder ?? 0,
    })
    .select()
    .single()

  if (error) throw error
  return mapDbCategory(data)
}

/**
 * Update a motif category
 */
export async function updateMotifCategory(
  id: string,
  input: Partial<MotifCategoryInput>
): Promise<MotifCategory> {
  const updateData: Record<string, unknown> = {}
  if (input.key !== undefined) updateData.key = input.key
  if (input.label !== undefined) updateData.label_fr = input.label
  if (input.description !== undefined) updateData.description_fr = input.description
  if (input.iconName !== undefined) updateData.icon_name = input.iconName
  if (input.displayOrder !== undefined) updateData.display_order = input.displayOrder

  const { data, error } = await supabase
    .from('motif_categories')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return mapDbCategory(data)
}

/**
 * Archive a motif category (soft delete)
 */
export async function archiveMotifCategory(id: string): Promise<void> {
  const { error } = await supabase
    .from('motif_categories')
    .update({ is_active: false })
    .eq('id', id)

  if (error) throw error
}

/**
 * Unarchive a motif category
 */
export async function unarchiveMotifCategory(id: string): Promise<void> {
  const { error } = await supabase
    .from('motif_categories')
    .update({ is_active: true })
    .eq('id', id)

  if (error) throw error
}

/**
 * Check if a category key is unique
 */
export async function isCategoryKeyUnique(key: string, excludeId?: string): Promise<boolean> {
  let query = supabase
    .from('motif_categories')
    .select('id')
    .eq('key', key)

  if (excludeId) {
    query = query.neq('id', excludeId)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []).length === 0
}

/**
 * Count motifs using a category (for archive warning)
 */
export async function countMotifsInCategory(categoryId: string): Promise<number> {
  const { count, error } = await supabase
    .from('motifs')
    .select('*', { count: 'exact', head: true })
    .eq('category_id', categoryId)

  if (error) throw error
  return count ?? 0
}

/**
 * Update a single motif's category
 */
export async function setMotifCategory(motifId: string, categoryId: string | null): Promise<void> {
  const { error } = await supabase
    .from('motifs')
    .update({ category_id: categoryId })
    .eq('id', motifId)

  if (error) throw error
}

/**
 * Reorder categories (batch update display_order)
 */
export async function reorderMotifCategories(orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from('motif_categories')
      .update({ display_order: i + 1 })
      .eq('id', orderedIds[i])

    if (error) throw error
  }
}

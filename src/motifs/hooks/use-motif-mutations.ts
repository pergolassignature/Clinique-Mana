import { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

interface MutationState {
  isLoading: boolean
  error: Error | null
}

interface ArchiveResult {
  success: boolean
  error?: Error
}

interface CreateMotifInput {
  key: string
  label: string
}

interface CreateResult {
  success: boolean
  error?: Error
  motif?: {
    id: string
    key: string
    label: string
  }
}

interface KeyValidationResult {
  isValid: boolean
  isUnique: boolean
  error?: string
}

/**
 * Hook for motif mutation operations (archive, unarchive, create)
 */
export function useMotifMutations() {
  const [archiveState, setArchiveState] = useState<MutationState>({
    isLoading: false,
    error: null,
  })
  const [createState, setCreateState] = useState<MutationState>({
    isLoading: false,
    error: null,
  })

  /**
   * Archive a motif (set is_active = false)
   */
  const archiveMotif = async (motifId: string): Promise<ArchiveResult> => {
    setArchiveState({ isLoading: true, error: null })

    const { error } = await supabase
      .from('motifs')
      .update({ is_active: false })
      .eq('id', motifId)

    if (error) {
      const err = new Error(error.message)
      setArchiveState({ isLoading: false, error: err })
      return { success: false, error: err }
    }

    setArchiveState({ isLoading: false, error: null })
    return { success: true }
  }

  /**
   * Unarchive/restore a motif (set is_active = true)
   */
  const unarchiveMotif = async (motifId: string): Promise<ArchiveResult> => {
    setArchiveState({ isLoading: true, error: null })

    const { error } = await supabase
      .from('motifs')
      .update({ is_active: true })
      .eq('id', motifId)

    if (error) {
      const err = new Error(error.message)
      setArchiveState({ isLoading: false, error: err })
      return { success: false, error: err }
    }

    setArchiveState({ isLoading: false, error: null })
    return { success: true }
  }

  /**
   * Create a new motif
   */
  const createMotif = async (input: CreateMotifInput): Promise<CreateResult> => {
    setCreateState({ isLoading: true, error: null })

    const { data, error } = await supabase
      .from('motifs')
      .insert({
        key: input.key,
        label: input.label,
        is_active: true,
        is_restricted: false,
      })
      .select('id, key, label')
      .single()

    if (error) {
      const err = new Error(error.message)
      setCreateState({ isLoading: false, error: err })
      return { success: false, error: err }
    }

    setCreateState({ isLoading: false, error: null })
    return { success: true, motif: data }
  }

  /**
   * Validate a key for uniqueness
   */
  const validateKey = async (key: string): Promise<KeyValidationResult> => {
    // Basic format validation
    const keyPattern = /^[a-z][a-z0-9_]*$/
    if (!keyPattern.test(key)) {
      return {
        isValid: false,
        isUnique: false,
        error: 'La clé doit être en minuscules, commencer par une lettre et ne contenir que des lettres, chiffres et underscores.',
      }
    }

    // Check uniqueness
    const { data, error } = await supabase
      .from('motifs')
      .select('id')
      .eq('key', key)
      .maybeSingle()

    if (error) {
      return {
        isValid: false,
        isUnique: false,
        error: 'Erreur lors de la validation.',
      }
    }

    if (data) {
      return {
        isValid: true,
        isUnique: false,
        error: 'Cette clé existe déjà.',
      }
    }

    return { isValid: true, isUnique: true }
  }

  return {
    archiveMotif,
    unarchiveMotif,
    createMotif,
    validateKey,
    archiveState,
    createState,
  }
}

/**
 * Generate a snake_case key from a French label
 */
export function generateKeyFromLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/['']/g, '_') // Replace apostrophes
    .replace(/[^a-z0-9]+/g, '_') // Replace non-alphanumeric
    .replace(/^_+|_+$/g, '') // Trim underscores
    .replace(/_+/g, '_') // Collapse multiple underscores
    .slice(0, 50) // Limit length
}

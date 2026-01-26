import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import type { DbMotif, DbMotifCategory } from '../types'

// Raw type from Supabase (array from join)
interface DbMotifWithCategoryRaw extends DbMotif {
  motif_categories: Pick<DbMotifCategory, 'id' | 'key' | 'label_fr'>[] | null
}

// Extended DbMotif with optional category relation (normalized to single object)
export interface DbMotifWithCategory extends DbMotif {
  motif_categories: Pick<DbMotifCategory, 'id' | 'key' | 'label_fr'> | null
}

interface UseMotifOptions {
  /** Include inactive (archived) motifs. Default: false */
  includeInactive?: boolean
}

interface UseMotifs {
  motifs: DbMotifWithCategory[]
  isLoading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export function useMotifs(options?: UseMotifOptions): UseMotifs {
  const includeInactive = options?.includeInactive ?? false

  const [motifs, setMotifs] = useState<DbMotifWithCategory[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchMotifs = async () => {
    setIsLoading(true)
    setError(null)

    let query = supabase
      .from('motifs')
      .select('id, key, label, is_active, is_restricted, category_id, motif_categories(id, key, label_fr)')
      .order('label', { ascending: true })

    // By default, only return active motifs
    if (!includeInactive) {
      query = query.eq('is_active', true)
    }

    const { data, error: fetchError } = await query

    if (fetchError) {
      setError(new Error(fetchError.message))
      setMotifs([])
    } else {
      // Normalize the category data from array (Supabase join) to single object
      const rawData = (data || []) as DbMotifWithCategoryRaw[]
      const normalizedData: DbMotifWithCategory[] = rawData.map((motif) => {
        const categoryArray = motif.motif_categories
        const category = Array.isArray(categoryArray) && categoryArray.length > 0
          ? categoryArray[0]
          : null
        return {
          id: motif.id,
          key: motif.key,
          label: motif.label,
          is_active: motif.is_active,
          is_restricted: motif.is_restricted,
          category_id: motif.category_id,
          motif_categories: category ?? null,
        }
      })
      setMotifs(normalizedData)
    }

    setIsLoading(false)
  }

  useEffect(() => {
    fetchMotifs()
  }, [includeInactive])

  return {
    motifs,
    isLoading,
    error,
    refetch: fetchMotifs,
  }
}

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import type { DbMotif } from '../types'

interface UseMotifOptions {
  /** Include inactive (archived) motifs. Default: false */
  includeInactive?: boolean
}

interface UseMotifs {
  motifs: DbMotif[]
  isLoading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export function useMotifs(options?: UseMotifOptions): UseMotifs {
  const includeInactive = options?.includeInactive ?? false

  const [motifs, setMotifs] = useState<DbMotif[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchMotifs = async () => {
    setIsLoading(true)
    setError(null)

    let query = supabase
      .from('motifs')
      .select('id, key, label, is_active, is_restricted')
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
      setMotifs(data || [])
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

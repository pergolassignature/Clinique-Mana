import { createContext, useContext } from 'react'
import type { DemandeBundle, DemandesReference } from '../../api/demandes'

/** What the record's tabs read (CLAUDE.md §8: the bundle, never a refetch of their own). */
export interface DemandeRecordData {
  id: string
  bundle: DemandeBundle
  reference: DemandesReference
  /** demandes.manage and not closed: the intake and the follow-up are editable. */
  canEdit: boolean
}

export const DemandeRecordContext = createContext<DemandeRecordData | null>(null)

export function useDemandeRecord(): DemandeRecordData {
  const value = useContext(DemandeRecordContext)
  if (!value) throw new Error('useDemandeRecord outside DemandeRecordContext')
  return value
}

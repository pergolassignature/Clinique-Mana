import { createContext, useContext } from 'react'
import type { ClientsReference } from '../../api/clients'
import type { ClientSummary } from '../../api/parse'

/** What every record tab reads: the file's bundle (one request), the forms' lists, the caller's right to change it. */
export interface ClientRecordData {
  summary: ClientSummary
  reference: ClientsReference
  /** clients.manage, and the file neither merged nor anonymised. */
  canEdit: boolean
}

export const ClientRecordContext = createContext<ClientRecordData | null>(null)

/** The open record's data (tabs never refetch it: one bundle per record). */
export function useClientRecordData(): ClientRecordData {
  const value = useContext(ClientRecordContext)
  if (!value) throw new Error('useClientRecordData outside a client record')
  return value
}

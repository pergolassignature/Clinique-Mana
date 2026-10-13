import type { InboxQuery } from '../api/demandes'

/**
 * React Query keys of Demandes (D2):
 *
 * | Change                                                    | Invalidated                        |
 * |-----------------------------------------------------------|------------------------------------|
 * | any write on a request (intake, state, assignment,        | `lists()`, `counts()` and          |
 * | contact, task, note, participants, « Je m'en occupe »)    | `record(id)`                       |
 * | realtime: `{ table, record_id }` from another person      | the same, for that id              |
 * | realtime: the channel back after a cut                    | `all`                              |
 * | a client file created from the request                    | the record (its `client_id`)       |
 */
export const demandesKeys = {
  all: ['demandes'] as const,
  lists: () => [...demandesKeys.all, 'list'] as const,
  list: (query: InboxQuery, page: number) =>
    [...demandesKeys.lists(), query.view, query.assigned, [...query.flags].sort().join(','), query.search.trim(), page] as const,
  counts: () => [...demandesKeys.all, 'counts'] as const,
  record: (id: string) => [...demandesKeys.all, 'record', id] as const,
  reference: () => [...demandesKeys.all, 'reference'] as const,
}

import type { InboxQuery } from '../api/demandes'
import type { WaitlistQuery } from '../api/waitlist'
import type { CallsPeriod } from '../api/calls'

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
 * | any write on the waiting list (D3: register, fee, contact,| `waitlist()` (every list, entry    |
 * | offer, exit, priority) — it may move the request too      | and count), `lists()`, `counts()`, |
 * |                                                           | `record(demande)`                  |
 * | realtime, a change of a request (its entries announce it) | also `waitlist()`                  |
 * | the follow-up settings saved                              | `waitlistSettings()`               |
 * | a task done, cancelled, moved or given (D3b); realtime    | also `calls()`                     |
 * | a proposal made or withdrawn (D3b); realtime              | also `propositions()`, the record  |
 */
export const demandesKeys = {
  all: ['demandes'] as const,
  lists: () => [...demandesKeys.all, 'list'] as const,
  list: (query: InboxQuery, page: number) =>
    [...demandesKeys.lists(), query.view, query.assigned, [...query.flags].sort().join(','), query.search.trim(), page] as const,
  counts: () => [...demandesKeys.all, 'counts'] as const,
  record: (id: string) => [...demandesKeys.all, 'record', id] as const,
  reference: () => [...demandesKeys.all, 'reference'] as const,
  waitlist: () => [...demandesKeys.all, 'waitlist'] as const,
  waitlistLists: () => [...demandesKeys.waitlist(), 'lists'] as const,
  waitlistList: (query: WaitlistQuery) =>
    [...demandesKeys.waitlist(), 'list', query.target?.kind ?? 'all', query.target?.id ?? '', (query.states ?? []).join(',')] as const,
  waitlistOfDemande: (demandeId: string) => [...demandesKeys.waitlist(), 'demande', demandeId] as const,
  waitlistEntry: (id: string) => [...demandesKeys.waitlist(), 'entry', id] as const,
  waitlistSettings: () => [...demandesKeys.all, 'waitlist-settings'] as const,
  calls: () => [...demandesKeys.all, 'calls'] as const,
  propositions: () => [...demandesKeys.all, 'propositions'] as const,
  propositionsOf: (demandeId: string) => [...demandesKeys.propositions(), demandeId] as const,
  propositionServices: (professionalId: string) => [...demandesKeys.all, 'proposition-services', professionalId] as const,
  openSlots: (professionalId: string, serviceId: string, from: string, to: string) =>
    [...demandesKeys.all, 'open-slots', professionalId, serviceId, from, to] as const,
  callsOf: (period: CallsPeriod) => [...demandesKeys.calls(), period.from, period.to, period.overdue] as const,
}

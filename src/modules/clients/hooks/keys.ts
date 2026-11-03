import type { ClientsPageQuery } from '../api/clients'

/**
 * The module's query keys (files). Every write invalidates `all` (the list, the records, « Mes
 * clients » and the reference lists are cheap to refetch at the clinic's size), except the live
 * duplicate panel, which is never cached between keystrokes.
 */
export const clientsKeys = {
  all: ['clients'] as const,
  list: (query: ClientsPageQuery) => [...clientsKeys.all, 'list', query] as const,
  record: (id: string) => [...clientsKeys.all, 'record', id] as const,
  reference: () => [...clientsKeys.all, 'reference'] as const,
  mine: () => [...clientsKeys.all, 'mine'] as const,
  duplicates: (key: string) => [...clientsKeys.all, 'duplicates', key] as const,
  search: (query: string) => [...clientsKeys.all, 'search', query] as const,
  history: (id: string) => [...clientsKeys.all, 'history', id] as const,
  /** FP-9: « Payeurs à compléter » (a payer saved refetches it, under `all`). */
  payersToComplete: () => [...clientsKeys.all, 'payers-to-complete'] as const,
}

/**
 * React Query keys of the consents (C5a), under `clientsKeys.all` (a file's write refetches them too).
 *
 * | Change                                          | Invalidated                                  |
 * |-------------------------------------------------|----------------------------------------------|
 * | a consent sent, re-sent or cancelled            | `consentKeys.toObtain()`, `client(id)`       |
 * | a consent withdrawn (and its file's history)     | `toObtain()`, `client(id)`, `history(id)`    |
 * | its signed copy sent                            | `consentKeys.toObtain()`, `client(id)`       |
 * | a rule or the settings saved                    | `rules()` / `settings()` (written as is)     |
 * | a text published                                | `templates()`, `consentKeys.all` (flags)     |
 * | the public page                                 | none: component state only (a credential)    |
 */
export const consentKeys = {
  all: ['clients', 'consents'] as const,
  types: () => [...consentKeys.all, 'types'] as const,
  rules: () => [...consentKeys.all, 'rules'] as const,
  /** The service names a rule on a service shows (Services' catalogue). */
  serviceNames: () => [...consentKeys.all, 'service-names'] as const,
  settings: () => [...consentKeys.all, 'settings'] as const,
  templates: () => [...consentKeys.all, 'templates'] as const,
  toObtain: () => [...consentKeys.all, 'to-obtain'] as const,
  client: (clientId: string) => [...consentKeys.all, 'client', clientId] as const,
  /** A consent text version's clauses (CC-13). */
  clauses: (versionId: string) => [...consentKeys.all, 'clauses', versionId] as const,
  /** The re-sign campaigns (C5b.4): a start or a stop refetches `all` (the flags change the states too). */
  campaigns: () => [...consentKeys.all, 'campaigns'] as const,
  /**
   * CC-22: what the signed-in professional still has to countersign. Refetched after she signs;
   * her signing link is never cached (a credential, component state only).
   */
  mine: () => [...consentKeys.all, 'mine'] as const,
}

import type { ProfessionalsPageQuery } from '../api/list'

/**
 * React Query keys of the module, three roots so a change refetches only what it touched
 * (narrow invalidation, as `roleKeys` / `userKeys` in core):
 *
 * | Change                                   | Invalidated                                                    |
 * |------------------------------------------|----------------------------------------------------------------|
 * | a record's set, email or status, or a    | `record(id)` (after writing the returned set), `lists()`,      |
 * | field the list shows (names, new clients)| `history(id)` (its first page, `refreshProfessionalHistory`);  |
 * |                                          | sets and status also `usage()` (« Utilisé par »)               |
 * | a field the list does not show (bio,     | `record(id)`, `history(id)` (first page) only (`touchesList`   |
 * | approach, public contact, IVAC, gender,  | in `use-professional-mutations.ts`)                            |
 * | experience, phone, address)              |                                                                |
 * | creation                                 | `lists()`, `usage()`                                           |
 * | a list row saved                         | `catalog()`, `usage()`; `professionalKeys.all` for titles and  |
 * |                                          | motifs (licence and restricted rules change readiness)         |
 * | a list row archived or restored          | `catalog()`, `usage()`, `professionalKeys.all` (readiness counts |
 * |                                          | active rows only)                                              |
 * | a list reordered                         | `catalog()` (optimistic, rolled back on error)                 |
 * | module settings                          | none: the RPC returns the effective settings, written as is    |
 * | a professional's margin or level (4a.18) | `compensation(id)`, `history(id)` (first page)                 |
 * | a professional's private data, saved or  | `private(id)`, `history(id)` (first page); a reveal marks the  |
 * | cleared (4a.18)                          | history stale only. A revealed value is never cached.          |
 * | a clinic default range or rule (4a.18)   | `compensationTermsKeys.terms()`, every `compensation(…)`       |
 * |                                          | (`compensations()`: what is in force follows the defaults)     |
 *
 * Labels never live in records or list rows (ids only), so a rename touches the catalogue alone.
 */
export const professionalKeys = {
  all: ['professionals'] as const,
  /** Every list query: the whole list and the keyset pages. */
  lists: () => [...professionalKeys.all, 'list'] as const,
  list: () => [...professionalKeys.lists(), 'all'] as const,
  pages: (query: ProfessionalsPageQuery) => [...professionalKeys.lists(), 'pages', query] as const,
  record: (id: string) => [...professionalKeys.all, 'record', id] as const,
  history: (id: string) => [...professionalKeys.all, 'history', id] as const,
  /** Every professional's compensation entry: a clinic default or rule changes what each one has in force. */
  compensations: () => [...professionalKeys.all, 'compensation'] as const,
  /** The « Rémunération » cards of a record: terms in force and dated rows (`professionals.compensation`). */
  compensation: (id: string) => [...professionalKeys.compensations(), id] as const,
  /** The masked private data (`professionals.private`); never a revealed value. */
  private: (id: string) => [...professionalKeys.all, 'private', id] as const,
}

/** The nine lists (one cached payload) and their usage counts. */
export const professionalCatalogKeys = {
  all: ['professionals-catalog'] as const,
  catalog: () => [...professionalCatalogKeys.all, 'catalog'] as const,
  usage: () => [...professionalCatalogKeys.all, 'usage'] as const,
}

export const professionalsSettingsKeys = {
  all: ['professionals-settings'] as const,
  settings: () => [...professionalsSettingsKeys.all, 'settings'] as const,
}

/**
 * The clinic's compensation terms (Paramètres → Rémunération): the kinds (global, changed by
 * migration: never refetched) and the dated default ranges and recognition rules.
 */
export const compensationTermsKeys = {
  all: ['compensation-terms'] as const,
  kinds: () => [...compensationTermsKeys.all, 'kinds'] as const,
  terms: () => [...compensationTermsKeys.all, 'terms'] as const,
}

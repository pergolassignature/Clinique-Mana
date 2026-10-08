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
 * | a professional's sessions, rate or client | `compensation(id)`, `history(id)` (first page), `reviews()`    |
 * | agreement (P4-186, P4-187)               |                                                                |
 * | the review's batch of sessions (P4-190)  | `reviews()`, every `compensation(…)`, each row's `history(id)` |
 * | a professional's private data, saved or  | `private(id)`, `history(id)` (first page); a save first writes |
 * | cleared (4a.18)                          | its returned `updated_at` into `private(id)`; a reveal marks   |
 * |                                          | the history stale only. A revealed value is never cached.      |
 * | a clinic grid or other rate (P4-185)     | `compensationTermsKeys.terms()`, every `compensation(…)` and   |
 * |                                          | `review(…)` (the suggestions follow the grids)                 |
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
  /** Every professional's compensation entry: a clinic grid changes what each one is suggested. */
  compensations: () => [...professionalKeys.all, 'compensation'] as const,
  /** The « Rétention » card of a record: the state and the dated rows (`professionals.compensation`). */
  compensation: (id: string) => [...professionalKeys.compensations(), id] as const,
  /** Every « Révision mensuelle » month read. */
  reviews: () => [...professionalKeys.all, 'review'] as const,
  /** One month (`yyyy-MM-01`) of « Révision mensuelle ». */
  review: (month: string) => [...professionalKeys.reviews(), month] as const,
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
 * The clinic's compensation terms (Paramètres → Rémunération): the other kinds (global, changed by
 * migration: never refetched), the dated grids and the other kinds' rates.
 */
export const compensationTermsKeys = {
  all: ['compensation-terms'] as const,
  kinds: () => [...compensationTermsKeys.all, 'kinds'] as const,
  terms: () => [...compensationTermsKeys.all, 'terms'] as const,
}

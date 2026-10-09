import type { ProfessionalsPageQuery } from '../api/list'

/**
 * React Query keys of the module, three roots so a change refetches only what it touched
 * (narrow invalidation, as `roleKeys` / `userKeys` in core):
 *
 * | Change                                   | Invalidated                                                    |
 * |------------------------------------------|----------------------------------------------------------------|
 * | a record's set, email or status, or a    | `record(id)` (after writing the returned set), `lists()`,      |
 * | field the list shows (names, new clients,| `history(id)` (its first page, `refreshProfessionalHistory`);  |
 * | gender: the title's form, P4-342)        | sets and status also `usage()` (« Utilisé par »); the gender   |
 * |                                          | also `compensation(id)` and `reviews()`                        |
 * | a field the list does not show (bio,     | `record(id)`, `history(id)` (first page) only (`touchesList`   |
 * | approach, public contact, IVAC,          | in `use-professional-mutations.ts`)                            |
 * | experience, phone, address)              |                                                                |
 * | creation                                 | `lists()`, `usage()`                                           |
 * | a list row saved                         | `catalog()`, `usage()`; `professionalKeys.all` for titles and  |
 * |                                          | motifs (licence and restricted rules change readiness)         |
 * | a list row archived or restored          | `catalog()`, `usage()`, `professionalKeys.all` (readiness counts |
 * |                                          | active rows only)                                              |
 * | a list reordered                         | `catalog()` (optimistic, rolled back on error)                 |
 * | module settings                          | none: the RPC returns the effective settings, written as is    |
 * | an invitation sent, revoked, or an update | `record(id)` (its `onboarding(id)` too), `lists()` (the        |
 * | request (Task 4b.3), failed or not        | invitation states too), `history(id)` (its `emails(id)` too)   |
 * | a professional's sessions, rate or client | `compensation(id)`, `history(id)` (first page), `reviews()`    |
 * | agreement (P4-186, P4-187)               |                                                                |
 * | the review's batch of sessions (P4-190)  | `reviews()`, every `compensation(…)`, each row's `history(id)` |
 * | a professional's private data, saved or  | `private(id)`, `history(id)` (first page); a save first writes |
 * | cleared (4a.18)                          | its returned `updated_at` into `private(id)`; a reveal marks   |
 * |                                          | the history stale only. A revealed value is never cached.      |
 * | the provider's questionnaire (4b.4): a    | `mySubmission()` written in place; a private save, a signature |
 * | section saved, the private step, the     | or « Envoyer mon profil » refetch `mySubmission()` (the        |
 * | consent, the submission                  | private step also `myPrivate()`)                               |
 * | a clinic grid or other rate (P4-185)     | `compensationTermsKeys.terms()`, every `compensation(…)` and   |
 * |                                          | `review(…)` (the suggestions follow the grids)                 |
 * | a submission applied or sent back (4b.5) | `record(id)` (its onboarding and submissions too), `lists()`,  |
 * |                                          | `history(id)` (first page), its `submissionReview` (refetched  |
 * |                                          | in place after a refusal); once applied, `private(id)` when a  |
 * |                                          | private field was, `usage()` when a set was (P4-374)           |
 * | « Mettre mon profil à jour » (4b.5)      | `mySubmission()`, `myRecord()`                                 |
 * | a document uploaded, verified, refused,  | `record(id)` (its `documents(id)` and readiness), `lists()`,   |
 * | redated or deleted (4c.3)                | `history(id)` (first page), `usage()` (« Documents requis »)   |
 * | the provider's own upload (4c.6)         | `myDocuments()`                                                |
 * | a document type saved or archived        | as any list row (`catalog()`, `usage()`, every record: the     |
 * |                                          | readiness counts required types)                               |
 * | a consent version saved, published or    | `professionalsSettingsKeys.consents()`                         |
 * | discarded (« Consentements »)            |                                                                |
 * | a contract or an image consent sent,     | `record(id)` (its `contract(id)` / `imageConsent(id)` and the  |
 * | re-sent, regenerated or synchronised     | documents too: readiness follows them), `lists()`,             |
 * | (4d.3, P4-484)                           | `history(id)` (first page)                                     |
 * | a fiche emailed (4c.5)                   | `history(id)` (first page, its `emails(id)` too)               |
 * | a contract template's version saved,     | `contractTemplateKeys.all` (the list and the versions), and    |
 * | published or archived (4d.3)             | for a publication every signing card alone (`isContractKey`,   |
 * |                                          | « Aucun modèle publié »), never the records around them        |
 *
 * Labels never live in records or list rows (ids only), so a rename touches the catalogue alone.
 */
export const professionalKeys = {
  all: ['professionals'] as const,
  /** Every list query: the whole list and the keyset pages. */
  lists: () => [...professionalKeys.all, 'list'] as const,
  list: () => [...professionalKeys.lists(), 'all'] as const,
  pages: (query: ProfessionalsPageQuery) => [...professionalKeys.lists(), 'pages', query] as const,
  /**
   * The onboarding states of the whole clinic (`list_professional_invitation_states`), joined by
   * the list page: under `lists()`, so whatever refreshes the lists refreshes them.
   */
  invitationStates: () => [...professionalKeys.lists(), 'invitation-states'] as const,
  record: (id: string) => [...professionalKeys.all, 'record', id] as const,
  /**
   * The record's onboarding line (`get_professional_onboarding`, P4-270), requested with the record:
   * under `record(id)`, so every record refresh refreshes it.
   */
  onboarding: (id: string) => [...professionalKeys.record(id), 'onboarding'] as const,
  /**
   * « Questionnaire et mises à jour » (`list_professional_submissions`, Task 4b.5): under
   * `record(id)`, so every record refresh (an invitation, an apply, a refusal) refreshes it.
   */
  submissions: (id: string) => [...professionalKeys.record(id), 'submissions'] as const,
  /**
   * The contract card (`get_professional_contract`, Task 4d.3): under `record(id)`, so every
   * record refresh refreshes it (a signed contract completes the readiness).
   */
  contract: (id: string) => [...professionalKeys.record(id), 'contract'] as const,
  /** The image consent's signing card (`get_professional_image_consent`, P4-484): the same rule. */
  imageConsent: (id: string) => [...professionalKeys.record(id), 'image-consent'] as const,
  /** One submission's review (`get_submission_review`), read when its sheet opens; dropped once decided. */
  submissionReview: (submissionId: string) => [...professionalKeys.all, 'submission-review', submissionId] as const,
  /**
   * The Documents tab (`get_professional_documents`, Task 4c.3): under `record(id)`, so every record
   * refresh (an approved questionnaire brings the photo and the insurance) refreshes it.
   */
  documents: (id: string) => [...professionalKeys.record(id), 'documents'] as const,
  history: (id: string) => [...professionalKeys.all, 'history', id] as const,
  /** The emails about the professional (`list_subject_emails`): under `history(id)`, refreshed with it. */
  emails: (id: string) => [...professionalKeys.history(id), 'emails'] as const,
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
  /**
   * The signed-in professional's open submission (4b.4). The questionnaire writes each saved
   * section into it (no refetch while the provider types); a private save, a signature or a
   * submission refetches it.
   */
  mySubmission: () => [...professionalKeys.all, 'my-submission'] as const,
  /** The signed-in professional's private data on file, masked (`get_my_professional_private`). */
  myPrivate: () => [...professionalKeys.all, 'my-private'] as const,
  /** « Mon profil » (4b.5): the signed-in professional's own record (`get_my_professional_record`). */
  myRecord: () => [...professionalKeys.all, 'my-record'] as const,
  /** « Mes documents » (4c.6): the signed-in professional's documents. */
  myDocuments: () => [...professionalKeys.all, 'my-documents'] as const,
  /**
   * Her image consent step (`get_my_image_consent`, P4-487): states and dates only, never a signing
   * link. A signature (the embed's completion, the return from the signing page) refetches it,
   * `myDocuments()` and `mySubmission()`.
   */
  myImageConsent: () => [...professionalKeys.all, 'my-image-consent'] as const,
}

/** The nine lists (one cached payload, « Documents requis » included) and their usage counts. */
export const professionalCatalogKeys = {
  all: ['professionals-catalog'] as const,
  catalog: () => [...professionalCatalogKeys.all, 'catalog'] as const,
  usage: () => [...professionalCatalogKeys.all, 'usage'] as const,
}

export const professionalsSettingsKeys = {
  all: ['professionals-settings'] as const,
  settings: () => [...professionalsSettingsKeys.all, 'settings'] as const,
  /** « Paramètres → Consentements » (`get_consent_versions`). */
  consents: () => [...professionalsSettingsKeys.all, 'consents'] as const,
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

/** Every record's signing cards (`contract(id)`, `imageConsent(id)`), and nothing else of the records. */
export const isContractKey = (queryKey: readonly unknown[]) =>
  queryKey.length === 4 && queryKey[0] === professionalKeys.all[0] && queryKey[1] === 'record' && (queryKey[3] === 'contract' || queryKey[3] === 'image-consent')

/** « Paramètres → Contrats et formulaires » (Task 4d.3): the module's document templates and each one's versions. */
export const contractTemplateKeys = {
  all: ['contract-templates'] as const,
  list: () => [...contractTemplateKeys.all, 'list'] as const,
  versions: (templateId: string) => [...contractTemplateKeys.all, 'versions', templateId] as const,
}

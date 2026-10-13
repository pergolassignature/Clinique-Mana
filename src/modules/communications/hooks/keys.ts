import type { ThreadListQuery } from '../api/inbox'

/**
 * React Query keys of the Gmail side of the module (CM1, CM2):
 *
 * | Change                                          | Invalidated                                    |
 * |-------------------------------------------------|------------------------------------------------|
 * | a mailbox connected, synchronised, disconnected | `connections()`, `threads()` (a sync brings    |
 * |                                                 | new threads)                                   |
 * | the module settings (the Pub/Sub topic and the  | none: the RPC returns the effective settings,  |
 * | push's service account)                         | written into `settings()` as is                |
 * | an action on threads (read, archive, star, a    | written into `threadLists()` and `thread(id)`  |
 * | label: `gmail-modify`)                          | at once (optimistic), then `threadLists()`,    |
 * |                                                 | each `thread(id)` and `connections()` (unread  |
 * |                                                 | counts) once Gmail answered                    |
 * | a thread linked to a file or unlinked (CM2b)    | `threadLink(id)`, `threadLists()` (« À         |
 * |                                                 | rattacher » and each row's link status)        |
 * | a sync (new threads, linked by the sync)        | `threads()` covers every `threadLink(id)`      |
 * | a draft saved (CM3, autosave)                   | `drafts()` (the list; the open draft is the    |
 * |                                                 | composer's own state, never refetched)         |
 * | a draft deleted                                 | `drafts()`                                     |
 * | a template saved or deleted                     | `templates()`                                  |
 * | a message sent                                  | `threads()` (the lists, the thread, its link), |
 * |                                                 | `drafts()`, `clientThreads()`, `connections()` |
 *
 * The SMS side keeps its own root (`smsKeys`), so neither invalidates the other.
 */
export const mailKeys = {
  all: ['communications', 'mail'] as const,
  connections: () => [...mailKeys.all, 'connections'] as const,
  settings: () => [...mailKeys.all, 'settings'] as const,
  /** Every thread list and thread. */
  threads: () => [...mailKeys.all, 'threads'] as const,
  threadLists: () => [...mailKeys.threads(), 'list'] as const,
  threadList: (query: ThreadListQuery) =>
    [...mailKeys.threadLists(), query.connectionId, query.view, query.labelId ?? null, query.search?.trim() || null] as const,
  thread: (id: string) => [...mailKeys.threads(), 'one', id] as const,
  /** The thread's file (CM2b): under `threads()`, so a sync reads it again. */
  threadLink: (id: string) => [...mailKeys.threads(), 'link', id] as const,
  /** The search of a file to link a thread to (Clients' `search_clients`). */
  fileSearch: (query: string) => [...mailKeys.all, 'file-search', query] as const,
  labels: (connectionId: string) => [...mailKeys.all, 'labels', connectionId] as const,
  /** The composer (CM3). */
  drafts: () => [...mailKeys.all, 'drafts'] as const,
  draft: (id: string) => [...mailKeys.drafts(), 'one', id] as const,
  templates: () => [...mailKeys.all, 'templates'] as const,
  composeContext: (clientId: string) => [...mailKeys.all, 'compose-context', clientId] as const,
  clientThreads: () => [...mailKeys.all, 'client-threads'] as const,
  clientThreadList: (clientId: string) => [...mailKeys.clientThreads(), clientId] as const,
}

/**
 * React Query keys of « Textos » (batch SM).
 *
 * | Change                                      | Invalidated                                         |
 * |---------------------------------------------|-----------------------------------------------------|
 * | a reply sent (or failed: its row says so)   | `threads()`, `thread(phone)`                        |
 * | a consent recorded or withdrawn             | `threads()`, `thread(phone)` (the consent text      |
 * |                                             | queued shows in the thread)                         |
 * | the bell's unread count changed (a text     | `smsKeys.all` (no polling of its own: CLAUDE.md §8, |
 * | received raises a notice)                   | « only the bell's unread count polls »)              |
 * | the settings saved                          | none: the RPC returns the effective settings,       |
 * |                                             | written into `settings()` as is                     |
 */
export const smsKeys = {
  all: ['communications', 'sms'] as const,
  threads: () => [...smsKeys.all, 'threads'] as const,
  /** Keyed by the number (E.164): never put in a URL, only in the cache. */
  thread: (phone: string) => [...smsKeys.all, 'thread', phone] as const,
  /** A notice's `?message=<id>` resolved to its thread's number. */
  messagePhone: (id: string) => [...smsKeys.all, 'message-phone', id] as const,
  settings: () => [...smsKeys.all, 'settings'] as const,
  lastEvent: () => [...smsKeys.all, 'last-event'] as const,
}

/**
 * React Query keys of « Rédiger avec l'IA » (CM4):
 *
 * | Change                                  | Invalidated                                          |
 * |-----------------------------------------|------------------------------------------------------|
 * | a draft written (a call, its cost)      | `all` (the composer's status: the cap may be         |
 * |                                         | reached; the settings' month)                        |
 * | the settings saved, the key replaced    | `all`                                                |
 */
export const aiKeys = {
  all: ['communications', 'ai'] as const,
  status: () => [...aiKeys.all, 'status'] as const,
  settings: () => [...aiKeys.all, 'settings'] as const,
}

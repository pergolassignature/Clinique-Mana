/**
 * React Query keys of the Gmail side of the module (CM1):
 *
 * | Change                                          | Invalidated                                    |
 * |-------------------------------------------------|------------------------------------------------|
 * | a mailbox connected, synchronised, disconnected | `connections()`                                |
 * | the module settings (the Pub/Sub topic and the  | none: the RPC returns the effective settings,  |
 * | push's service account)                         | written into `settings()` as is                |
 *
 * The SMS side keeps its own root (`smsKeys`), so neither invalidates the other.
 */
export const mailKeys = {
  all: ['communications', 'mail'] as const,
  connections: () => [...mailKeys.all, 'connections'] as const,
  settings: () => [...mailKeys.all, 'settings'] as const,
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

/**
 * React Query keys of the Gmail side of the module (CM1):
 *
 * | Change                                          | Invalidated                                    |
 * |-------------------------------------------------|------------------------------------------------|
 * | a mailbox connected, synchronised, disconnected | `connections()`                                |
 * | the module settings (the Pub/Sub topic)         | none: the RPC returns the effective settings,  |
 * |                                                 | written into `settings()` as is                |
 *
 * The SMS side keeps its own root (`smsKeys`), so neither invalidates the other.
 */
export const mailKeys = {
  all: ['communications', 'mail'] as const,
  connections: () => [...mailKeys.all, 'connections'] as const,
  settings: () => [...mailKeys.all, 'settings'] as const,
}

/**
 * The core upload purposes as the client checks them before any network call (fast feedback):
 * a copy of `upload_purposes` in 20261008071750_core_storage.sql, which stays the authority.
 */
export const UPLOAD_PURPOSES = {
  org_logo: { mimeTypes: ['image/png', 'image/jpeg'], maxBytes: 2_097_152 },
  org_signature: { mimeTypes: ['image/png', 'image/jpeg'], maxBytes: 2_097_152 },
} as const satisfies Record<string, { mimeTypes: readonly string[]; maxBytes: number }>

/** What the client checks of an upload purpose before any network call. */
interface UploadPurposeLimits {
  /** `upload_purposes.mime_types`. */
  mimeTypes: readonly string[]
  /** `upload_purposes.max_bytes`. */
  maxBytes: number
  /** `upload_purposes.max_image_side`: the width and height cap of an image, in pixels; null for none. */
  maxImageSide: number | null
}

/**
 * The core upload purposes as the client checks them before any network call (fast feedback):
 * a copy of `upload_purposes` (20261008071750_core_storage.sql), which stays the authority.
 * `purposes.test.ts` reads the migrations and fails when the two differ.
 */
export const UPLOAD_PURPOSES = {
  org_logo: { mimeTypes: ['image/png', 'image/jpeg'], maxBytes: 2_097_152, maxImageSide: 4000 },
  org_signature: { mimeTypes: ['image/png', 'image/jpeg'], maxBytes: 2_097_152, maxImageSide: 4000 },
} as const satisfies Record<string, UploadPurposeLimits>

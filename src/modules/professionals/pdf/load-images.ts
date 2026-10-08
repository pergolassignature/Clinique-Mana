import { signedFileUrl } from '@/core/storage/api'

/**
 * Stored images as data URLs for the fiche (PS Hub's `loadImages.ts`): the clinic logo now, the
 * professional's photo with 4c. Read through `storage-sign` (P3-33: a 5-minute URL, the caller's
 * own access), fetched once, and embedded as they are: the logo and photo purposes accept PNG and
 * JPEG only, which react-pdf embeds without re-encoding (no canvas, unlike PS Hub's).
 *
 * A missing or unreadable image is `null`, never an error: the fiche is printed without it
 * (the clinic's name stands in for the logo).
 */

const EMBEDDABLE = new Set(['image/png', 'image/jpeg'])

/** A Blob as a data URL. */
function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}

/** The stored image `fileId` as a PNG or JPEG data URL, or null (none, unreadable, another type). */
export async function storedImageDataUrl(fileId: string | null): Promise<string | null> {
  if (!fileId) return null
  try {
    const { url } = await signedFileUrl(fileId)
    const response = await fetch(url)
    if (!response.ok) return null
    const blob = await response.blob()
    return EMBEDDABLE.has(blob.type) ? await dataUrl(blob) : null
  } catch {
    return null
  }
}

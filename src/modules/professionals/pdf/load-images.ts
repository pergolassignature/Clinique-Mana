import { signedFileUrl, type ImageVariant } from '@/core/storage/api'

/**
 * Stored images as data URLs for the fiche (PS Hub's `loadImages.ts`): the clinic logo now, the
 * professional's photo with 4c. Read through `storage-sign` (P3-33: a 5-minute URL, the caller's
 * own access), fetched once, and embedded as they are: the logo and photo purposes accept PNG and
 * JPEG only, which react-pdf embeds without re-encoding (no canvas, unlike PS Hub's).
 *
 * A missing or unreadable stored image is `null`, never an error: the fiche is printed without
 * it (Clinique MANA's bundled lockup stands in for the logo, the initials for the photo).
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

/** One signed read of `fileId` as an embeddable data URL, or null. */
async function readEmbeddable(fileId: string, variant?: ImageVariant): Promise<string | null> {
  try {
    const { url } = await signedFileUrl(fileId, variant ? { variant } : {})
    // A resized copy comes in the format the request accepts (WebP when offered): ask for what
    // react-pdf embeds.
    const response = await fetch(url, { headers: { Accept: 'image/png, image/jpeg' } })
    if (!response.ok) return null
    const blob = await response.blob()
    return EMBEDDABLE.has(blob.type) ? await dataUrl(blob) : null
  } catch {
    return null
  }
}

/**
 * The stored image `fileId` as a PNG or JPEG data URL, or null (none, unreadable, another type).
 * With `variant` (the photo: `print`, 480 px wide with its PNG or JPEG kept, PERF-1), that smaller
 * copy first, and the original when it cannot be had (image transformations off or failing): the
 * fiche never loses its photo to a resize.
 */
export async function storedImageDataUrl(fileId: string | null, { variant }: { variant?: ImageVariant } = {}): Promise<string | null> {
  if (!fileId) return null
  return (variant && (await readEmbeddable(fileId, variant))) || readEmbeddable(fileId)
}

/**
 * An image bundled with the renderer (Clinique MANA's lockup, `MANA_LOGO_URL`) as a data URL. It
 * ships with this chunk, so failing to read it fails the fiche (« La fiche n'a pas pu être
 * préparée… »): a fiche is never printed without the clinic's logo (P4-214).
 */
export async function bundledImageDataUrl(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Bundled image unavailable (${response.status})`)
  return dataUrl(await response.blob())
}

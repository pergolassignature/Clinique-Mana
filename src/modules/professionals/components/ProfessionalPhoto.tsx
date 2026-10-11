import { useSignedFileUrl } from '@/core/storage/hooks'
import { cn } from '@/shared/lib/utils'
import { useImageRetry } from './use-image-retry'

const SIZES = { 64: 'size-16', 96: 'size-24', 128: 'size-32' } as const

interface ProfessionalPhotoProps {
  /** The photo's stored file; null: the empty placeholder. */
  fileId: string | null
  /** What the photo shows (« Photo de … »). */
  alt: string
  /** Displayed side in px; the `card` copy (256 px box, PERF-1) is signed whatever the size. */
  size?: keyof typeof SIZES
  className?: string
}

/**
 * A professional's photo at a fixed size (gap audit V1): the `card` copy signed on demand
 * (`useSignedFileUrl`, P3-33), `loading="lazy"`, width and height set so nothing moves while it
 * loads. A grey disc while it loads, without a photo, or when it cannot load (an expired URL is
 * replaced once, `useImageRetry`). The clinic's portraits are transparent cut-outs: on the soft
 * teal, cropped from the top, as the avatar.
 */
export function ProfessionalPhoto({ fileId, alt, size = 96, className }: ProfessionalPhotoProps) {
  const signed = useSignedFileUrl(fileId, { variant: 'card' })
  const url = signed.data?.url
  const image = useImageRetry(fileId, url, signed.refetch)
  const box = cn(SIZES[size], 'shrink-0 rounded-full', className)
  if (!url || image.dead) return <div aria-hidden className={cn(box, 'bg-muted')} />
  return (
    <img
      src={url}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={image.onError}
      className={cn(box, 'border border-border bg-primary-soft object-cover object-top')}
    />
  )
}


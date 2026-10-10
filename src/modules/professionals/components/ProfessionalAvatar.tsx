import { useSignedFileUrl } from '@/core/storage/hooks'
import { initialsOf } from '@/shared/lib/format'
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/ui/avatar'
import { useImageRetry } from './use-image-retry'

interface ProfessionalAvatarProps {
  /** The professional's full name: the initials. */
  name: string
  /** A signed read URL of the photo (`storage-sign`); nothing: the initials. */
  url: string | null | undefined
  size?: 'sm' | 'md' | 'lg'
  /** The photo failed to load (an expired URL: ask for a new one). */
  onImageError?: () => void
  className?: string
}

/**
 * A professional's round avatar: the photo once it has loaded, else the initials (while it loads,
 * when it fails, without a photo). Decorative: the name is always written next to it.
 *
 * The clinic's portraits are transparent cut-outs (the website's): they sit on the soft teal of the
 * palette, cropped from the top (`object-top`) so a tall portrait keeps the face.
 */
export function ProfessionalAvatar({ name, url, size = 'md', onImageError, className }: ProfessionalAvatarProps) {
  return (
    <Avatar size={size} aria-hidden className={className}>
      {url && (
        <AvatarImage
          src={url}
          alt=""
          className="bg-primary-soft object-top"
          onLoadingStatusChange={(status) => status === 'error' && onImageError?.()}
        />
      )}
      <AvatarFallback className="text-muted-foreground">{initialsOf(name)}</AvatarFallback>
    </Avatar>
  )
}

interface ProfessionalPhotoAvatarProps {
  name: string
  /** The photo's stored file (`ProfessionalRecord.photoFileId`), null without one. */
  fileId: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

/**
 * The avatar of one professional, its photo signed on demand (`useSignedFileUrl`: a 5-minute URL,
 * kept by the core hook's rules, never beyond). One `storage-sign` call per avatar: for one record,
 * not for a list's rows (the per-user limit is 120 an hour). An expired URL is replaced once
 * (`useImageRetry`); a photo that cannot load leaves the initials.
 */
export function ProfessionalPhotoAvatar({ name, fileId, size, className }: ProfessionalPhotoAvatarProps) {
  const signed = useSignedFileUrl(fileId, { variant: 'avatar' })
  const url = signed.data?.url
  const image = useImageRetry(fileId, url, signed.refetch)
  return <ProfessionalAvatar name={name} url={image.dead ? null : url} size={size} onImageError={image.onError} className={className} />
}

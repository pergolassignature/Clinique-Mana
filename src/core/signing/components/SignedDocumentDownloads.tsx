import { useId } from 'react'
import { t } from '@/i18n'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { canSplit, preloadPdfSplitter, type SignedDocumentFiles } from '../downloads'
import { useSignedDocumentDownload } from '../use-signed-download'

const D = 'signing.downloads'

interface SignedDocumentDownloadsProps {
  files: SignedDocumentFiles
  /** The document's own button (« Télécharger le contrat signé »). */
  documentLabel: string
  /** Its accessible name when the label alone is ambiguous (« … du contrat de Marie »). */
  documentAriaLabel?: string
}

/**
 * A signed document's downloads (P4-500), for any module's card that shows a signed request to its
 * readers: the document alone (primary), Documenso's certificate and journal alone, and the full
 * sealed PDF as a small link with one line saying it is the proof. When N cannot be known (no
 * recorded page count, no source file), only the sealed PDF is offered, with the reason; when the
 * sealed PDF turns out to hold no certificate pages, that button is disabled with its reason.
 * Nothing is read before a press; hovering or focusing a split download preloads pdf-lib's chunk.
 * Remount it (a `key`) for another request.
 */
export function SignedDocumentDownloads({ files, documentLabel, documentAriaLabel }: SignedDocumentDownloadsProps) {
  const { download, pendingKind, hasCertificate } = useSignedDocumentDownload(files)
  const reasonId = useId()
  const splittable = canSplit(files)
  const busy = pendingKind !== null
  const noCertificate = hasCertificate === false
  const label = (kind: 'document' | 'certificate' | 'sealed', text: string) => (pendingKind === kind ? t(`${D}.working`) : text)

  if (!splittable) {
    return (
      <div className="space-y-1">
        <Button
          type="button"
          size="sm"
          aria-disabled={busy || undefined}
          className={softDisabledClasses}
          onClick={ignoreWhenInactive(busy, () => download('sealed'))}
        >
          {label('sealed', t(`${D}.sealed`))}
        </Button>
        <p className="text-xs text-muted-foreground">{t(`${D}.cannotSplit`)}</p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div role="group" aria-label={t(`${D}.groupLabel`)} className="flex flex-wrap gap-2" onPointerEnter={preloadPdfSplitter} onFocus={preloadPdfSplitter}>
        <Button
          type="button"
          size="sm"
          aria-label={pendingKind === 'document' ? undefined : documentAriaLabel}
          aria-disabled={busy || undefined}
          className={softDisabledClasses}
          onClick={ignoreWhenInactive(busy, () => download('document'))}
        >
          {label('document', documentLabel)}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-disabled={busy || noCertificate || undefined}
          aria-describedby={noCertificate ? reasonId : undefined}
          className={softDisabledClasses}
          onClick={ignoreWhenInactive(busy || noCertificate, () => download('certificate'))}
        >
          {label('certificate', t(`${D}.certificate`))}
        </Button>
      </div>
      {noCertificate && (
        <p id={reasonId} className="text-xs text-muted-foreground">
          {t(`${D}.noCertificate`)}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        <Button
          type="button"
          variant="link"
          aria-disabled={busy || undefined}
          className={cn('h-auto p-0 text-xs', softDisabledClasses)}
          onClick={ignoreWhenInactive(busy, () => download('sealed'))}
        >
          {label('sealed', t(`${D}.sealed`))}
        </Button>{' '}
        · {t(`${D}.sealedHelp`)}
      </p>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { t } from '@/i18n'
import { fetchStoredFile } from '@/core/storage/api'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { previewProfessionalContract, type PreviewAction, type SigningForm } from '../../api/contracts'
import { formTextRoot, previewErrorMessage } from '../../hooks/use-contracts'
import { signerRoleLabel } from '../../lib/contract'
import { RefusalAlert } from '../compensation/DatedRowParts'

const P = 'modules.professionals.contract.preview'

/**
 * What the dialog shows: the PDF an action would send under a key (`prepare`, P4-502: rendered by
 * the send's own path, nothing sent), or the source PDF a sent request kept (`sent`: « Voir le
 * contrat envoyé », through `storage-sign`).
 */
export type PreviewSource =
  | { kind: 'prepare'; action: PreviewAction; key: string }
  | { kind: 'sent'; fileId: string; pageCount: number | null; signers: { role: string; name: string }[] }

interface Loaded {
  url: string
  pageCount: number | null
  signers: { role: string; name: string }[]
  summary: { label: string; value: string }[]
}

type LoadState = { status: 'loading' } | { status: 'ready'; loaded: Loaded } | { status: 'error'; message: string }

interface SigningPreviewDialogProps {
  form: SigningForm
  professionalId: string
  firstName: string
  /** The template version: the published one for a preview, the request's for a sent PDF. */
  version: number | null
  /** Null: closed. */
  source: PreviewSource | null
  onClose: () => void
  /** « Envoyer pour signature à … » (a preview only): sends with the previewed key. */
  onSend?: () => void
  /** « Rafraîchir l'aperçu »: a new key, so a new snapshot of today's data. */
  onRefresh?: () => void
  /** The preview failed: its key may be dropped (`releaseKey`). */
  onFailed?: () => void
  /** Restores focus to the button that opened the dialog. */
  onCloseAutoFocus?: (event: Event) => void
  /** One more line under the preview (the image consent's renewal: the signed one stays until then). */
  note?: string
}

/**
 * The signing forms' preview (P4-502, asked by Jonathan): the PDF exactly as it will be sent, in a
 * large dialog, with its page count, the template version, the signers and the main values Annexe
 * A prints; « Envoyer pour signature à {prénom} » sends what is shown (the same key, so the same
 * snapshot). Also « Voir le contrat envoyé » (`sent`), read-only. The PDF lives in this component's
 * state as a blob URL, revoked on close or reload; nothing is cached.
 */
export function SigningPreviewDialog({
  form,
  professionalId,
  firstName,
  version,
  source,
  onClose,
  onSend,
  onRefresh,
  onFailed,
  onCloseAutoFocus,
  note,
}: SigningPreviewDialogProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const F = formTextRoot(form)
  const sourceId = source === null ? null : source.kind === 'prepare' ? `${source.action}:${source.key}` : `sent:${source.fileId}`

  useEffect(() => {
    if (source === null) return
    const controller = new AbortController()
    let url: string | null = null
    setState({ status: 'loading' })
    const load = async (): Promise<Omit<Loaded, 'url'> & { bytes: Uint8Array }> => {
      if (source.kind === 'sent') {
        const bytes = await fetchStoredFile(source.fileId, { signal: controller.signal })
        return { bytes, pageCount: source.pageCount, signers: source.signers, summary: [] }
      }
      const preview = await previewProfessionalContract(professionalId, source.action, source.key, form, controller.signal)
      return { bytes: preview.bytes, pageCount: preview.pageCount, signers: preview.signers, summary: preview.summary }
    }
    load().then(
      ({ bytes, ...rest }) => {
        if (controller.signal.aborted) return
        url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
        setState({ status: 'ready', loaded: { url, ...rest } })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', message: source.kind === 'sent' ? t(`${P}.sentLoadFailed`) : previewErrorMessage(error, form) })
        onFailed?.()
      },
    )
    return () => {
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
    // `sourceId` names the source: a new key or file reloads, a re-render does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId])

  const sent = source?.kind === 'sent'
  const regenerate = source?.kind === 'prepare' && source.action === 'regenerate'
  const ready = state.status === 'ready' ? state.loaded : null

  return (
    <Dialog open={source !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex h-[calc(100dvh-2rem)] max-w-[1200px] flex-col overflow-hidden"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{t(sent ? `${F}.preview.sentTitle` : `${F}.preview.title`, { firstName })}</DialogTitle>
          <DialogDescription>{t(sent ? `${P}.sentDescription` : `${P}.description`, { firstName })}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
          <div className="flex min-h-[45vh] flex-1 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
            {state.status === 'loading' && (
              <p role="status" className="text-sm text-muted-foreground">
                {t(sent ? `${P}.loadingSent` : `${P}.loading`)}
              </p>
            )}
            {state.status === 'error' && (
              <div className="w-full max-w-md p-4">
                <RefusalAlert message={state.message} />
              </div>
            )}
            {ready && <iframe src={ready.url} title={t(`${P}.frameTitle`)} className="h-full w-full bg-white" />}
          </div>

          <aside className="shrink-0 space-y-4 overflow-y-auto text-sm lg:w-80">
            <dl className="space-y-1">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t(`${P}.pages`)}</dt>
                <dd className="font-medium text-foreground">{ready?.pageCount != null ? String(ready.pageCount) : '…'}</dd>
              </div>
              {version !== null && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{t(`${P}.version`)}</dt>
                  <dd className="font-medium text-foreground">{String(version)}</dd>
                </div>
              )}
            </dl>

            {ready && ready.signers.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-foreground">{t(`${P}.signers`)}</p>
                <ul className="space-y-0.5">
                  {ready.signers.map((signer) => (
                    <li key={`${signer.role}:${signer.name}`}>
                      <span className="text-muted-foreground">{signerRoleLabel(signer.role)} : </span>
                      <span className="font-medium text-foreground">{signer.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {ready && ready.summary.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-foreground">{t(`${P}.annexe`)}</p>
                <dl className="space-y-1.5">
                  {ready.summary.map((line) => (
                    <div key={line.label}>
                      <dt className="text-xs text-muted-foreground">{line.label}</dt>
                      <dd className="text-foreground">{line.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {ready && (
              <a href={ready.url} target="_blank" rel="noopener noreferrer" className="block text-link underline-offset-[3px] hover:underline">
                {t(`${P}.openTab`)}
              </a>
            )}

            {!sent && (
              <div className="space-y-2 border-t border-border-light pt-3">
                {regenerate && <p className="text-xs text-muted-foreground">{t(`${F}.preview.regenerateNote`)}</p>}
                {note && <p className="text-xs text-muted-foreground">{note}</p>}
                <p className="text-xs text-muted-foreground">{t(`${P}.frozen`)}</p>
                {onRefresh && (
                  <Button type="button" size="sm" variant="outline" disabled={state.status === 'loading'} onClick={onRefresh}>
                    {t(`${P}.refresh`)}
                  </Button>
                )}
              </div>
            )}
          </aside>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {sent ? t('common.close') : t('common.cancel')}
          </Button>
          {!sent && onSend && (
            <Button type="button" aria-disabled={!ready || undefined} className={softDisabledClasses} onClick={ignoreWhenInactive(!ready, onSend)}>
              {t(`${F}.preview.send`, { firstName })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

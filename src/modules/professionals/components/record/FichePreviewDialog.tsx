import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { ficheErrorMessage, useDownloadFiche, useRenderFiche } from '../../hooks/use-fiche'
import type { FicheTitle } from '../../lib/fiche'
import { RefusalAlert } from '../compensation/DatedRowParts'
import { useRecordData } from './record-context'

const P = 'modules.professionals.fiche.preview'

type LoadState = { status: 'loading' } | { status: 'ready'; url: string } | { status: 'error'; message: string }

interface FichePreviewDialogProps {
  open: boolean
  onClose: () => void
  /** The fiche's titles (`ficheTitles`): with two, one fiche per title, chosen in the dialog. */
  titles: readonly FicheTitle[]
  onCloseAutoFocus?: (event: Event) => void
}

/**
 * « Aperçu de la fiche » (gap audit H3, P4-547): the fiche PDF « Télécharger » makes, rendered in
 * the browser (react-pdf, its lazy chunk through `useRenderFiche`) and shown in a large dialog, the
 * photo only with an image consent on file (P4-512). With two titles, one button per title switches
 * the fiche. The PDF lives in this component's state as a blob URL, revoked on close or switch;
 * nothing is stored, sent or stamped. « Télécharger » saves it (and stamps it, as the menu does).
 */
export function FichePreviewDialog({ open, onClose, titles, onCloseAutoFocus }: FichePreviewDialogProps) {
  const { record, catalog } = useRecordData()
  const render = useRenderFiche()
  const download = useDownloadFiche()
  const [titleId, setTitleId] = useState<string | null>(titles[0]?.titleId ?? null)
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const name = `${record.professional.firstName} ${record.professional.lastName}`

  useEffect(() => {
    if (!open) return
    let cancelled = false
    let url: string | null = null
    setState({ status: 'loading' })
    render({ record, catalog, titleId }).then(
      ({ blob }) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setState({ status: 'ready', url })
      },
      (error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: ficheErrorMessage(error, t('modules.professionals.fiche.errors.render')) })
      },
    )
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
    // A new title or a reopening renders again; a re-render of the record page does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, titleId])

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex h-[calc(100dvh-2rem)] max-w-[1000px] flex-col overflow-hidden" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t(`${P}.title`, { name })}</DialogTitle>
          <DialogDescription>{t(`${P}.description`)}</DialogDescription>
        </DialogHeader>
        {titles.length > 1 && (
          <div role="group" aria-label={t(`${P}.titles`)} className="flex flex-wrap gap-2">
            {titles.map((title) => (
              <Button
                key={title.titleId}
                type="button"
                size="sm"
                variant={title.titleId === titleId ? 'default' : 'outline'}
                aria-pressed={title.titleId === titleId}
                onClick={() => setTitleId(title.titleId)}
              >
                {title.name}
              </Button>
            ))}
          </div>
        )}
        <div className="flex min-h-[45vh] flex-1 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
          {state.status === 'loading' && (
            <p role="status" className="text-sm text-muted-foreground">
              {t(`${P}.loading`)}
            </p>
          )}
          {state.status === 'error' && (
            <div className="w-full max-w-md p-4">
              <RefusalAlert message={state.message} />
            </div>
          )}
          {state.status === 'ready' && <iframe src={state.url} title={t(`${P}.frameTitle`, { name })} className="h-full w-full bg-white" />}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {state.status === 'ready' && (
            <a href={state.url} target="_blank" rel="noopener noreferrer" className="text-sm text-link underline-offset-[3px] hover:underline">
              {t(`${P}.openTab`)}
            </a>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={state.status !== 'ready' || download.isPending}
            onClick={() => download.mutate({ record, catalog, titleId })}
          >
            <Download aria-hidden />
            {t(`${P}.download`)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

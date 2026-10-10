import { useId, useMemo, useState } from 'react'
import { t } from '@/i18n'
import type { EmailTemplateDraft } from '@/core/email/api'
import { emailErrorMessage } from '@/core/email/errors'
import { useEmailPreview } from '@/core/email/hooks'
import { withInertLinks } from '@/core/email/preview-html'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'

/** The two widths of the preview: a desktop mail client, and a phone. */
const WIDTHS = { desktop: 600, phone: 375 } as const
type Width = keyof typeof WIDTHS

interface EmailPreviewProps {
  templateKey: string
  /** The draft to render; null while it has an error (the last preview stays, dimmed). */
  draft: EmailTemplateDraft | null
  /** Why `draft` is null: the draft's first error, shown as the reason for the pause. */
  pausedReason: string | null
}

/**
 * The live preview of a draft, rendered by `email-preview` with the catalogue's sample values.
 * The HTML is shown in an `<iframe sandbox="">`: no script, no form, no same-origin access, no
 * navigation of the app — whatever the email holds; its links do nothing (`withInertLinks`).
 * « Ordinateur » / « Téléphone » switch the width.
 */
export function EmailPreview({ templateKey, draft, pausedReason }: EmailPreviewProps) {
  const [width, setWidth] = useState<Width>('desktop')
  const { data, error, isPending, isFetching, isPlaceholderData } = useEmailPreview(templateKey, draft)
  // A failure of the latest draft; a preview of an earlier one may still be on screen.
  // Memoised: the mapping reports unexpected codes to Sentry, once per failure, not per render.
  const failure = useMemo(() => (error ? emailErrorMessage(error) : null), [error])
  const titleId = useId()
  const srcDoc = useMemo(() => (data ? withInertLinks(data.html) : ''), [data])
  // Only why the preview is not the text being typed is announced (paused, failed); « Mise à jour
  // de l'aperçu… » shows on every pause in typing and is not.
  const announcement = draft === null ? t('settings.email.preview.paused', { reason: pausedReason ?? '' }) : failure
  const updating = !announcement && isFetching && (isPending || isPlaceholderData)

  return (
    <section aria-labelledby={titleId} className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={titleId} className="text-sm font-semibold text-foreground">
          {t('settings.email.preview.title')}
        </h3>
        <div role="group" aria-label={t('settings.email.preview.widthLabel')} className="flex gap-1">
          {(Object.keys(WIDTHS) as Width[]).map((key) => (
            <Button
              key={key}
              type="button"
              size="sm"
              variant={width === key ? 'secondary' : 'ghost'}
              aria-pressed={width === key}
              onClick={() => setWidth(key)}
            >
              {t(`settings.email.preview.${key}`)}
            </Button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        <span aria-live="polite">{announcement ?? ''}</span>
        {updating && t('settings.email.preview.updating')}
      </p>
      {data ? (
        <>
          <p className="truncate text-sm">
            <span className="text-muted-foreground">{t('settings.email.preview.subject')}</span> {data.subject}
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <iframe
              sandbox=""
              srcDoc={srcDoc}
              title={t('settings.email.preview.frameTitle')}
              width={WIDTHS[width]}
              className={cn('block h-[560px] max-w-none bg-card', (draft === null || failure) && 'opacity-60')}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t('settings.email.preview.linksDisabled')}</p>
        </>
      ) : (
        !failure && draft !== null && <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      )}
    </section>
  )
}

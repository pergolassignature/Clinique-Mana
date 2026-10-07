import { useId, type FormEventHandler, type ReactNode } from 'react'
import { t } from '@/i18n'
import { Badge } from '@/shared/ui/badge'

interface SettingsCardProps {
  title: string
  description?: string
  /** Without the edit permission: fields disabled, « Lecture seule » badge, no footer. */
  readOnly?: boolean
  /** A save is in flight: the form is marked `aria-busy` (fields stay enabled; the SaveButton shows the state). */
  pending?: boolean
  onSubmit?: FormEventHandler<HTMLFormElement>
  /** The save button (and any secondary action); not rendered when read-only. */
  footer?: ReactNode
  children: ReactNode
}

/** One block of a settings page: its own form, its own save button, read-only without the edit permission. */
export function SettingsCard({ title, description, readOnly, pending, onSubmit, footer, children }: SettingsCardProps) {
  const titleId = useId()
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-labelledby={titleId}
      aria-busy={pending || undefined}
      className="rounded-2xl border border-border bg-card text-card-foreground shadow-soft"
    >
      <div className="flex items-start justify-between gap-4 p-6 pb-4">
        <div>
          <h3 id={titleId} className="text-base font-semibold">
            {title}
          </h3>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {readOnly && <Badge variant="secondary">{t('common.readOnly')}</Badge>}
      </div>
      {/* min-w-0: a fieldset defaults to min-width: min-content, which lets wide content overflow the card. */}
      <fieldset disabled={readOnly} className="min-w-0 space-y-4 px-6 pb-6">
        {children}
      </fieldset>
      {!readOnly && footer && (
        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-3">{footer}</div>
      )}
    </form>
  )
}

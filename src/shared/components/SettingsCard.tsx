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

/**
 * One block of a settings page: its own form, its own save button, read-only without the edit
 * permission. Design system Card: hairline border, radius 6, padding 16, no shadow; title 14/600,
 * description 12px; actions aligned right under the fields.
 */
export function SettingsCard({ title, description, readOnly, pending, onSubmit, footer, children }: SettingsCardProps) {
  const titleId = useId()
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-labelledby={titleId}
      aria-busy={pending || undefined}
      className="rounded-lg border border-border bg-card p-4 text-card-foreground"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={titleId} className="text-base font-semibold tracking-tight">
            {title}
          </h3>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {readOnly && <Badge variant="secondary">{t('common.readOnly')}</Badge>}
      </div>
      {/* min-w-0: a fieldset defaults to min-width: min-content, which lets wide content overflow the card. */}
      <fieldset disabled={readOnly} className="min-w-0 space-y-3">
        {children}
      </fieldset>
      {!readOnly && footer && <div className="mt-4 flex items-center justify-end gap-1.5">{footer}</div>}
    </form>
  )
}

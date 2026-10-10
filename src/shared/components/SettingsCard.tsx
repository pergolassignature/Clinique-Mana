import { useContext, useId, type FormEventHandler, type ReactNode, type Ref } from 'react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { InCardContext } from '@/shared/ui/card-context'
import { FieldsReadOnlyContext } from '@/shared/ui/read-only-context'
import { StatusDot } from '@/shared/ui/status-dot'

interface SettingsCardProps {
  /**
   * `section` for a card of actions with no fields (e.g. « Sessions » in « Mon compte »): no
   * form and no fieldset, so `onSubmit`, `pending` and `readOnly` do not apply. Inside a read-only
   * area (`FieldsReadOnlyContext`) its footer action is not rendered either.
   */
  as?: 'form' | 'section'
  /**
   * `card` (default): a bordered card of its own. `section`: one section of a `SectionSurface`
   * (several forms on one surface, a hairline between them, no border of its own): from 720 px of
   * surface width the title and description sit in a 220 px aside, the fields (up to 560 px) and
   * the footer beside it; narrower, stacked like a card (audit 2026-10-09 §2.4, mockups 1 and 2).
   */
  layout?: 'card' | 'section'
  title: string
  description?: string
  /**
   * The form has unsaved changes: « Modifications non enregistrées » under the title (with its
   * `FormActions` shown, decision UI-2). Pass the same `dirty` as `FormActions`.
   */
  dirty?: boolean
  /**
   * Without the edit permission: the fields are read-only (focusable, copyable, at full contrast;
   * never disabled), the form never submits and the footer is not rendered. The page shows the
   * one « Lecture seule » notice (`ReadOnlyNotice`); the card adds no badge of its own.
   */
  readOnly?: boolean
  /** A save is in flight: the form is marked `aria-busy` (fields stay enabled; the SaveButton shows the state). */
  pending?: boolean
  onSubmit?: FormEventHandler<HTMLFormElement>
  /**
   * For a form card, `FormActions` (« Annuler / Enregistrer »); for a section, its action. Not
   * rendered when read-only: a form card's own `readOnly` or an inherited one; a section's only
   * when inherited. The row collapses while `FormActions` renders nothing (a clean form).
   */
  footer?: ReactNode
  /** Makes the title a focus target (`tabIndex={-1}`, never a tab stop), e.g. where focus goes once the card's last action is gone. */
  headingRef?: Ref<HTMLHeadingElement>
  children: ReactNode
}

const CARD_CLASSES = 'rounded-lg border border-border bg-card p-4 text-card-foreground'
/** A section of a `SectionSurface`: aside + fields once the surface (`container-inline`) is 720 px wide. */
const SECTION_CLASSES = 'min-w-0 px-4 py-5 cq-720:grid cq-720:grid-cols-section cq-720:gap-6'

/**
 * One block of a settings page: its own form, its own save button, read-only without the edit
 * permission. Design system Card: hairline border, radius 6, padding 16, no shadow; the panel title
 * 16/24, 600 (as `CardTitle`, `DialogTitle`; audit 2026-10-09 §2.2), description 12px; actions
 * aligned right under the fields. With `layout="section"`, one section of a `SectionSurface`.
 */
export function SettingsCard({
  as = 'form',
  layout = 'card',
  title,
  description,
  dirty = false,
  readOnly: readOnlyProp = false,
  pending,
  onSubmit,
  footer,
  headingRef,
  children,
}: SettingsCardProps) {
  const titleId = useId()
  // Inside a read-only area the card is read-only too: a card can never make fields editable again.
  const inherited = useContext(FieldsReadOnlyContext)
  const readOnly = readOnlyProp || inherited
  const section = layout === 'section'
  const header = (
    <div className={cn('mb-3 min-w-0', section && 'cq-720:mb-0')}>
      <h3 id={titleId} ref={headingRef} tabIndex={headingRef ? -1 : undefined} className="text-lg font-semibold outline-none">
        {title}
      </h3>
      {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      {dirty && !readOnly && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <StatusDot tone="warning" />
          {t('common.form.unsavedChanges')}
        </p>
      )}
    </div>
  )
  // `empty:hidden`: FormActions renders nothing while its form is clean (decision UI-2).
  const footerRow = footer && <div className="mt-3 flex items-center justify-end gap-2 empty:hidden">{footer}</div>
  const classes = section ? SECTION_CLASSES : CARD_CLASSES

  if (as === 'section') {
    return (
      <InCardContext.Provider value>
        <section aria-labelledby={titleId} className={classes}>
          {header}
          <div className="min-w-0">
            <div className="min-w-0 space-y-3">{children}</div>
            {/* An action changes something: none inside a read-only area. */}
            {!inherited && footerRow}
          </div>
        </section>
      </InCardContext.Provider>
    )
  }

  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    // A form portalled out of the card (a dialog's) is not inside this one in the DOM, but React
    // bubbles its submit through the component tree: it is that form's, never the card's.
    if (event.target !== event.currentTarget) return
    // Read-only: Enter in a field would still submit the form implicitly; nothing may be saved.
    if (readOnly) event.preventDefault()
    else onSubmit?.(event)
  }
  return (
    <InCardContext.Provider value>
      <form onSubmit={handleSubmit} noValidate aria-labelledby={titleId} aria-busy={pending || undefined} className={classes}>
        {header}
        <div className="min-w-0">
          {/* min-w-0: a fieldset defaults to min-width: min-content, which lets wide content overflow the card. */}
          <fieldset className="min-w-0 space-y-3">
            <FieldsReadOnlyContext.Provider value={readOnly}>{children}</FieldsReadOnlyContext.Provider>
          </fieldset>
          {!readOnly && footerRow}
        </div>
      </form>
    </InCardContext.Provider>
  )
}

/**
 * The surface that holds several `SettingsCard layout="section"` forms: one bordered card, a
 * hairline between sections, and the container (`container-inline`) whose width decides the
 * aside layout. Record form tabs, Paramètres form sections, Mon compte.
 */
export function SectionSurface({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <InCardContext.Provider value>
      <div className={cn('container-inline divide-y divide-border rounded-lg border border-border bg-card text-card-foreground', className)}>
        {children}
      </div>
    </InCardContext.Provider>
  )
}

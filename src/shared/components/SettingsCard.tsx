import { useContext, useId, type FormEventHandler, type ReactNode } from 'react'
import { FieldsReadOnlyContext } from '@/shared/ui/read-only-context'

interface SettingsCardProps {
  /**
   * `section` for a card of actions with no fields (e.g. « Sessions » in « Mon compte »): no
   * form and no fieldset, so `onSubmit`, `pending` and `readOnly` do not apply. Inside a read-only
   * area (`FieldsReadOnlyContext`) its footer action is not rendered either.
   */
  as?: 'form' | 'section'
  title: string
  description?: string
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
   * when inherited.
   */
  footer?: ReactNode
  children: ReactNode
}

const CARD_CLASSES = 'rounded-lg border border-border bg-card p-4 text-card-foreground'

/**
 * One block of a settings page: its own form, its own save button, read-only without the edit
 * permission. Design system Card: hairline border, radius 6, padding 16, no shadow; title 14/600,
 * description 12px; actions aligned right under the fields.
 */
export function SettingsCard({ as = 'form', title, description, readOnly: readOnlyProp = false, pending, onSubmit, footer, children }: SettingsCardProps) {
  const titleId = useId()
  // Inside a read-only area the card is read-only too: a card can never make fields editable again.
  const inherited = useContext(FieldsReadOnlyContext)
  const readOnly = readOnlyProp || inherited
  const header = (
    <div className="mb-3 min-w-0">
      <h3 id={titleId} className="text-base font-semibold tracking-tight">
        {title}
      </h3>
      {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
    </div>
  )
  const footerRow = footer && <div className="mt-3 flex items-center justify-end gap-2">{footer}</div>

  if (as === 'section') {
    return (
      <section aria-labelledby={titleId} className={CARD_CLASSES}>
        {header}
        <div className="min-w-0 space-y-3">{children}</div>
        {/* An action changes something: none inside a read-only area. */}
        {!inherited && footerRow}
      </section>
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
    <form onSubmit={handleSubmit} noValidate aria-labelledby={titleId} aria-busy={pending || undefined} className={CARD_CLASSES}>
      {header}
      {/* min-w-0: a fieldset defaults to min-width: min-content, which lets wide content overflow the card. */}
      <fieldset className="min-w-0 space-y-3">
        <FieldsReadOnlyContext.Provider value={readOnly}>{children}</FieldsReadOnlyContext.Provider>
      </fieldset>
      {!readOnly && footerRow}
    </form>
  )
}

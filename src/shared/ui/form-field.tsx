import { useId, type ReactNode } from 'react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Label } from './label'
import { useFieldReadOnly } from './read-only-context'

/**
 * What FormField hands its control. Spread it whole only on the design-system controls that
 * accept every prop here: `Input`, `Select`, `Textarea`, `Checkbox`, `Switch`. A custom control
 * (a Radix trigger, a group of buttons, a `div`) picks what it supports (`id`, `aria-*`) and must
 * honour `readOnly` itself: show the value, change nothing. `readOnly` is not a valid attribute on
 * a `div` or `button`, so do not spread it there.
 */
export interface FieldControlProps {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
  /** Read-only: the control shows its value, focusable and copyable, but cannot change it (never disabled). */
  readOnly: boolean
}

/**
 * A field's width, from its content (audit 2026-10-09 §2.5): `xs` 96 (1–3 digits: âge, années,
 * jours, places), `sm` 160 (code postal, date, NEQ, n° de permis, IVAC), `md` 264 (prénom, nom,
 * téléphone, ville, short selects, TPS / TVQ), `full` the whole column (address, email, URL,
 * text). A field is at least as wide as its label.
 */
export type FieldWidth = 'xs' | 'sm' | 'md' | 'full'

const FIELD_WIDTH: Record<FieldWidth, string> = {
  xs: 'w-field-xs',
  sm: 'w-field-sm',
  md: 'w-field-md',
  full: 'w-full',
}

interface FormFieldProps {
  label: string
  /**
   * The field's width (label, control, help and error together); never wider than its column
   * (`max-w-full`). Without it the field is a plain block, as before (it fills a block column).
   */
  width?: FieldWidth
  className?: string
  /** A line under the control, read with it (`aria-describedby`): a hint, or a live counter. */
  help?: ReactNode
  error?: string
  /**
   * Marks the label: a teal `*` for sighted users (hidden from screen readers) and « (requis) »
   * for screen readers (decision #30). Validation itself stays in the schema.
   */
  required?: boolean
  /**
   * Shows the value without letting it change. Defaults to the surrounding context (a read-only
   * SettingsCard). Hides the required marker: there is nothing to fill in.
   */
  readOnly?: boolean
  children: (props: FieldControlProps) => ReactNode
}

/**
 * Label + control + help + error, wired for screen readers. The control is a render prop.
 * The error is read through `aria-describedby`, not announced as an alert: react-hook-form focuses
 * the first invalid field, and an alert per field would announce every error at once.
 */
export function FormField({ label, width, className, help, error, required, readOnly: readOnlyProp, children }: FormFieldProps) {
  const id = useId()
  const readOnly = useFieldReadOnly(readOnlyProp)
  const helpId = help ? `${id}-help` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className={cn('space-y-1', width && ['min-w-0 max-w-full', FIELD_WIDTH[width]], className)}>
      <Label htmlFor={id}>
        {label}
        {required && !readOnly && (
          <>
            <span aria-hidden="true" className="ml-0.5 text-primary">
              *
            </span>
            <span className="sr-only"> {t('common.form.required')}</span>
          </>
        )}
      </Label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined, readOnly })}
      {help && (
        <p id={helpId} className="text-xs text-muted-foreground">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * Fields that belong together on one line (Prénom | Nom; Ville | Province | Code postal), 12 px
 * apart, wrapping when the column is too narrow. Give each `FormField` a `width`.
 */
export function FormRow({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('flex flex-wrap items-start gap-3', className)}>{children}</div>
}

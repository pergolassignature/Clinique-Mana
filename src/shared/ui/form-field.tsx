import { useId, type ReactNode } from 'react'
import { t } from '@/i18n'
import { Label } from './label'

/** What FormField hands its control: spread it on the input, select trigger or textarea. */
export interface FieldControlProps {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
}

interface FormFieldProps {
  label: string
  help?: string
  error?: string
  /**
   * Marks the label: a teal `*` for sighted users (hidden from screen readers) and « (requis) »
   * for screen readers (decision #30). Validation itself stays in the schema.
   */
  required?: boolean
  children: (props: FieldControlProps) => ReactNode
}

/**
 * Label + control + help + error, wired for screen readers. The control is a render prop.
 * The error is read through `aria-describedby`, not announced as an alert: react-hook-form focuses
 * the first invalid field, and an alert per field would announce every error at once.
 */
export function FormField({ label, help, error, required, children }: FormFieldProps) {
  const id = useId()
  const helpId = help ? `${id}-help` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>
        {label}
        {required && (
          <>
            <span aria-hidden="true" className="ml-0.5 text-primary">
              *
            </span>
            <span className="sr-only"> {t('common.form.required')}</span>
          </>
        )}
      </Label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
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

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
  /** Adds a visually hidden « (requis) » to the label; validation itself stays in the schema. */
  required?: boolean
  children: (props: FieldControlProps) => ReactNode
}

/** Label + control + help + error, wired for screen readers. The control is a render prop. */
export function FormField({ label, help, error, required, children }: FormFieldProps) {
  const id = useId()
  const helpId = help ? `${id}-help` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required && <span className="sr-only"> {t('common.form.required')}</span>}
      </Label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {help && (
        <p id={helpId} className="text-xs text-muted-foreground">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

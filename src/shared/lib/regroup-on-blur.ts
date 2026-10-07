import type { FocusEvent } from 'react'
import type { FieldValues, Path, PathValue, UseFormSetValue } from 'react-hook-form'

interface RegroupForm<T extends FieldValues> {
  setValue: UseFormSetValue<T>
  formState: { isSubmitted: boolean }
}

/**
 * `register` options that rewrite a field in its display format once it is left (`h2x1y4` →
 * `H2X 1Y4`, `123456789rt0001` → `123456789 RT 0001`): `register(name, regroupOnBlur(form, name, f))`.
 * Only a changed value is set, dirty; it is re-validated only after a first submit, like typing.
 * `format` returns its input unchanged when it does not recognise it, so the schema's error shows
 * what was typed.
 */
export function regroupOnBlur<T extends FieldValues>(form: RegroupForm<T>, name: Path<T>, format: (value: string) => string) {
  return {
    onBlur: (event: FocusEvent<HTMLInputElement>) => {
      const formatted = format(event.target.value)
      if (formatted !== event.target.value) {
        // Read at blur time (formState is a live proxy), not when the field rendered.
        form.setValue(name, formatted as PathValue<T, Path<T>>, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })
      }
    },
  }
}

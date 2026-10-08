import type { FieldValues, Path, PathValue, UseFormGetValues, UseFormSetValue } from 'react-hook-form'
import { PROVINCES } from '@/shared/lib/field-schemas'
import type { PlaceAddress } from './api'

/**
 * How a chosen suggestion fills an address form (P4-222). The person stays in charge:
 * - only **choosing a suggestion** fills anything; typing, focusing or loading a record never does;
 * - a choice fills « Adresse » (line 1), the city, the province and the postal code with what Google
 *   returned; a value Google lacks leaves its field as it was;
 * - « Appartement ou bureau » (line 2) is **never overwritten**: Google's unit goes there only when
 *   the field is empty;
 * - a field the person changes while the choice is being resolved keeps the person's value;
 * - every field stays editable afterwards, and changes are ordinary edits (dirty, saved with the
 *   card's « Enregistrer »).
 */

/** The form's field names for each address part (the clinic uses snake_case, Professionnels camelCase). */
export interface AddressFieldNames<T extends FieldValues> {
  line1: Path<T>
  line2: Path<T>
  city: Path<T>
  province: Path<T>
  postalCode: Path<T>
}

type Part = 'line1' | 'city' | 'province' | 'postalCode'
const FILLED: readonly Part[] = ['line1', 'city', 'province', 'postalCode']

/** The values of the filled parts when the suggestion was chosen. */
export type AddressCapture = Readonly<Record<Part, string>>

/** What `AddressAutocomplete` calls: `capture()` when a suggestion is chosen, `apply()` once its address arrives. */
export interface AddressAutofill {
  capture(): AddressCapture
  /** Fills the form; returns whether any field changed. */
  apply(address: PlaceAddress, captured: AddressCapture): boolean
}

interface AutofillForm<T extends FieldValues> {
  getValues: UseFormGetValues<T>
  setValue: UseFormSetValue<T>
  formState: { isSubmitted: boolean }
}

const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value))

/** The autofill of one form: `addressAutofill(form, { line1: 'address_line1', … })`. */
export function addressAutofill<T extends FieldValues>(form: AutofillForm<T>, names: AddressFieldNames<T>): AddressAutofill {
  const current = (part: keyof AddressFieldNames<T>) => text(form.getValues(names[part]))
  const set = (part: keyof AddressFieldNames<T>, value: string) => {
    if (current(part) === value) return false
    // Dirty like typing; re-validated only after a first submit, like `regroupOnBlur`.
    form.setValue(names[part], value as PathValue<T, Path<T>>, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })
    return true
  }
  return {
    capture: () => Object.fromEntries(FILLED.map((part) => [part, current(part)])) as Record<Part, string>,
    apply(address, captured) {
      const province = address.province && (PROVINCES as readonly string[]).includes(address.province) ? address.province : null
      const values: Record<Part, string | null> = {
        line1: address.line1,
        city: address.city,
        province,
        postalCode: address.postalCode,
      }
      let changed = false
      for (const part of FILLED) {
        const value = values[part]
        if (value && current(part) === captured[part]) changed = set(part, value) || changed
      }
      if (address.line2 && current('line2').trim() === '') changed = set('line2', address.line2) || changed
      return changed
    },
  }
}

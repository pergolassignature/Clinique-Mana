import type { FieldValues, Path, PathValue, UseFormGetValues, UseFormSetValue } from 'react-hook-form'
import { PROVINCES } from '@/shared/lib/field-schemas'
import type { AddressSuggestion, PlaceAddress } from './api'
import { civicNumber, splitCivicNumber, startsWithGeneric, streetLine } from './street-line'

/**
 * How a chosen suggestion fills an address form (P4-222). The person stays in charge:
 * - only **choosing a suggestion** fills anything; typing, focusing or loading a record never does;
 * - a choice fills « Adresse » (line 1), the city, the province and the postal code with what Google
 *   returned. When Google returns a street without a civic number and the typed text started with
 *   one, the typed number stays in front (`1234, rue Saint-Denis` in Québec);
 * - a value Google lacks leaves its field as it was, except a city, a postal code or a line 2 that
 *   the **previous choice** wrote and nobody touched since: that one is the old address's, so it is
 *   cleared. Line 1 is never cleared;
 * - « Appartement ou bureau » (line 2) is **never overwritten** when the person typed it: Google's
 *   unit goes there only when the field is empty (or still holds the previous choice's unit);
 * - a field the person changes while the choice is being resolved keeps the person's value; if
 *   « Adresse » itself changed meanwhile (« Annuler », a reload of the record), nothing is filled;
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

type Part = keyof AddressFieldNames<FieldValues>
const FILLED = ['line1', 'city', 'province', 'postalCode'] as const
/** Cleared when Google has no value and the field still holds the previous choice's (never line 1). */
const CLEARABLE: ReadonlySet<Part> = new Set(['city', 'postalCode'])

/** The values of the address fields when the suggestion was chosen. */
export type AddressCapture = Readonly<Record<Part, string>>

/** What a choice left in each field (Google's values): pass it to the next choice as `previous`. */
export type AddressFill = Readonly<Partial<Record<Part, string>>>

/** What `AddressAutocomplete` calls: `capture()` when a suggestion is chosen, then `apply()` or `applyStreet()`. */
export interface AddressAutofill {
  capture(): AddressCapture
  /**
   * Fills the form with the chosen place's address. Returns what this choice left in the fields
   * (the next choice's `previous`), or null when « Adresse » changed since `capture()`: then
   * nothing is filled.
   */
  apply(address: PlaceAddress, captured: AddressCapture, previous?: AddressFill | null): AddressFill | null
  /**
   * The place could not be read: fills line 1 alone from the suggestion's street, in the
   * province's convention. Returns whether line 1 was filled (not for a suggestion that is no
   * street, e.g. a neighbourhood, nor when « Adresse » changed since `capture()`).
   */
  applyStreet(suggestion: AddressSuggestion, captured: AddressCapture): boolean
}

interface AutofillForm<T extends FieldValues> {
  getValues: UseFormGetValues<T>
  setValue: UseFormSetValue<T>
  formState: { isSubmitted: boolean }
}

const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value))

const isProvince = (value: string | null): value is string => value !== null && (PROVINCES as readonly string[]).includes(value)

/** Lower case, accents removed. */
const fold = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

/**
 * The province a suggestion's secondary text names (« Montréal, QC, Canada » → `QC`), or null when
 * it names none of the 13.
 */
function provinceInText(secondary: string): string | null {
  for (const segment of secondary.split(',')) {
    const word = segment.trim().split(/\s+/)[0] ?? ''
    if (isProvince(word.toUpperCase())) return word.toUpperCase()
    if (fold(segment) === 'quebec') return 'QC'
  }
  return null
}

/** The autofill of one form: `addressAutofill(form, { line1: 'address_line1', … })`. */
export function addressAutofill<T extends FieldValues>(form: AutofillForm<T>, names: AddressFieldNames<T>): AddressAutofill {
  const current = (part: Part) => text(form.getValues(names[part]))
  const set = (part: Part, value: string) => {
    if (current(part) === value) return
    // Dirty like typing; re-validated only after a first submit, like `regroupOnBlur`.
    form.setValue(names[part], value as PathValue<T, Path<T>>, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })
  }
  const stale = (captured: AddressCapture) => current('line1') !== captured.line1

  return {
    capture: () => ({
      line1: current('line1'),
      line2: current('line2'),
      city: current('city'),
      province: current('province'),
      postalCode: current('postalCode'),
    }),

    apply(address, captured, previous) {
      if (stale(captured)) return null
      const province = isProvince(address.province) ? address.province : null
      const quebec = (province ?? current('province')) === 'QC'
      let line1 = address.line1
      // Google's street without a number, the typed text with one: the number stays.
      const typedNumber = civicNumber(captured.line1)
      if (line1 && typedNumber && !civicNumber(line1)) line1 = streetLine(typedNumber, line1, quebec)
      const values: Record<(typeof FILLED)[number], string | null> = { line1, city: address.city, province, postalCode: address.postalCode }

      const fill: Partial<Record<Part, string>> = {}
      /** Still what the previous choice wrote: Google's, not the person's. */
      const fromPrevious = (part: Part) => !!previous?.[part] && current(part) === previous[part]
      for (const part of FILLED) {
        // Changed while the choice resolved: the person's value.
        if (current(part) !== captured[part]) continue
        const value = values[part]
        if (value) {
          set(part, value)
          fill[part] = value
        } else if (CLEARABLE.has(part) && fromPrevious(part)) {
          set(part, '')
        }
      }
      if (current('line2') === captured.line2) {
        const google = fromPrevious('line2') || current('line2').trim() === ''
        if (address.line2 && google) {
          set('line2', address.line2)
          fill.line2 = address.line2
        } else if (!address.line2 && fromPrevious('line2')) {
          set('line2', '')
        }
      }
      return fill
    },

    applyStreet(suggestion, captured) {
      if (stale(captured)) return false
      const [number, street] = splitCivicNumber(suggestion.mainText)
      // A neighbourhood, a city or a building name is no street: line 1 stays as typed.
      if (!street || (!number && !startsWithGeneric(street))) return false
      const quebec = (provinceInText(suggestion.secondaryText) ?? current('province')) === 'QC'
      const line1 = streetLine(number ?? civicNumber(captured.line1), street, quebec)
      if (!line1) return false
      set('line1', line1)
      return true
    },
  }
}

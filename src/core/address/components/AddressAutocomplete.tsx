import { forwardRef, useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Input, type InputProps } from '@/shared/ui/input'
import { useFieldReadOnly } from '@/shared/ui/read-only-context'
import type { AddressSuggestion, PlaceAddress } from '../api'
import type { AddressAutofill } from '../autofill'
import { useAddressSuggestions } from '../use-address-suggestions'

export interface AddressAutocompleteProps extends Omit<InputProps, 'role' | 'autoComplete' | 'type'> {
  /** How a chosen suggestion fills the form (`addressAutofill(form, names)`). */
  autofill: AddressAutofill
}

/**
 * « Adresse » (line 1) with Google Places suggestions and manual override (P4-220–P4-222): the
 * address field of every form. Spread `FormField`'s props and `register(line1)` on it, as on an
 * `Input`:
 *
 *   <AddressAutocomplete {...field} {...register('address_line1')} autofill={addressAutofill(form, NAMES)} />
 *
 * - Typing asks for suggestions after a pause (3 characters at least); the list is an ARIA 1.2
 *   combobox: ↓/↑ move (wrapping), Entrée chooses, Échap closes (and does not close a surrounding
 *   dialog), Tab or leaving the field closes. The mouse chooses without taking focus away.
 * - Choosing fills the form through `autofill` (line 2 never overwritten; edits made while it
 *   resolves are kept); if the address cannot be read, only the street is filled.
 * - The person can ignore the list and type freely; « Saisir manuellement » (the last option) stops
 *   suggestions in this field until it is emptied.
 * - Read-only: a plain input. Service unavailable: a plain input too, quietly (`availability.ts`).
 * - The browser's own autofill is off on this field: its menu would cover the suggestions.
 */
export const AddressAutocomplete = forwardRef<HTMLInputElement, AddressAutocompleteProps>(function AddressAutocomplete(
  { autofill, readOnly: readOnlyProp, onChange, onBlur, onKeyDown, className, ...props },
  forwardedRef,
) {
  const readOnly = useFieldReadOnly(readOnlyProp)
  const { suggestions, loading, search, cancel, resolve } = useAddressSuggestions()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [manual, setManual] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const pick = useRef<AbortController | null>(null)
  const baseId = useId()
  const listId = `${baseId}-list`
  const optionId = (index: number) => `${baseId}-option-${index}`

  // Stop a choice still resolving when the field goes away.
  useEffect(() => () => pick.current?.abort(), [])

  const visible = open && !manual && !readOnly && suggestions.length > 0
  const manualIndex = suggestions.length
  const optionCount = suggestions.length + 1

  // A new list: nothing highlighted, and its size said once (not on every keystroke's re-render).
  useEffect(() => {
    setActive(-1)
    if (open && !manual && suggestions.length > 0) {
      setAnnouncement(suggestions.length === 1 ? t('address.suggestions.countOne') : t('address.suggestions.countMany', { count: String(suggestions.length) }))
    }
  }, [suggestions, open, manual])

  const close = useCallback(() => {
    setOpen(false)
    setActive(-1)
  }, [])

  const choose = async (suggestion: AddressSuggestion) => {
    close()
    pick.current?.abort()
    const controller = new AbortController()
    pick.current = controller
    const captured = autofill.capture()
    setResolving(true)
    const address = await resolve(suggestion, controller.signal)
    if (controller.signal.aborted) return
    pick.current = null
    setResolving(false)
    const fallback: PlaceAddress = { line1: suggestion.mainText, line2: null, city: null, province: null, postalCode: null, country: null }
    autofill.apply(address ?? fallback, captured)
    setAnnouncement(address ? t('address.suggestions.filled') : t('address.suggestions.partial'))
  }

  const chooseIndex = (index: number) => {
    if (index === manualIndex) {
      setManual(true)
      cancel()
      close()
      setAnnouncement(t('address.suggestions.manualOn'))
      return
    }
    const suggestion = suggestions[index]
    if (suggestion) void choose(suggestion)
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange?.(event)
    // Typing again wins over a choice still resolving.
    pick.current?.abort()
    pick.current = null
    setResolving(false)
    const value = event.target.value
    if (manual) {
      if (value === '') setManual(false)
      return
    }
    setOpen(true)
    search(value)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented || readOnly || manual) return
    switch (event.key) {
      case 'ArrowDown':
        if (suggestions.length === 0) return
        event.preventDefault()
        if (!visible) {
          setOpen(true)
          return
        }
        setActive((i) => (i + 1) % optionCount)
        return
      case 'ArrowUp':
        if (!visible) return
        event.preventDefault()
        setActive((i) => (i <= 0 ? optionCount - 1 : i - 1))
        return
      case 'Enter':
        // Without a highlighted option, Entrée keeps its meaning (the card's save).
        if (!visible || active < 0) return
        event.preventDefault()
        chooseIndex(active)
        return
      case 'Escape':
        if (!visible) return
        // Only the list closes, not a surrounding sheet or dialog.
        event.preventDefault()
        event.stopPropagation()
        close()
        return
      case 'Tab':
        close()
        return
    }
  }

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    onBlur?.(event)
    close()
  }

  // The list never takes focus: the input keeps it (and its caret) while the mouse chooses.
  const keepFocus = (event: MouseEvent) => event.preventDefault()

  if (readOnly) return <Input ref={forwardedRef} {...props} readOnly className={className} onChange={onChange} onBlur={onBlur} onKeyDown={onKeyDown} />

  const busy = loading || resolving
  return (
    <div className="relative">
      <Input
        ref={forwardedRef}
        {...props}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={visible}
        aria-controls={visible ? listId : undefined}
        aria-activedescendant={visible && active >= 0 ? optionId(active) : undefined}
        aria-busy={busy || undefined}
        autoComplete="off"
        className={cn(busy && 'pr-8', className)}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
      {busy && (
        <Loader2
          aria-hidden="true"
          className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-subtle motion-reduce:animate-none"
        />
      )}
      {visible && (
        <div className="absolute inset-x-0 top-full z-50 mt-1 rounded-lg border border-border bg-card p-1 shadow-medium" onMouseDown={keepFocus}>
          <ul id={listId} role="listbox" aria-label={t('address.suggestions.label')} className="max-h-72 overflow-y-auto">
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion.placeId}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                className="flex cursor-pointer flex-col rounded-lg px-2 py-1.5 aria-selected:bg-muted"
                onMouseMove={() => setActive(index)}
                onClick={() => chooseIndex(index)}
              >
                <span className="truncate text-sm text-foreground">{suggestion.mainText}</span>
                {suggestion.secondaryText && <span className="truncate text-xs text-muted-foreground">{suggestion.secondaryText}</span>}
              </li>
            ))}
            <li role="presentation" className="my-1 h-px bg-border" />
            <li
              id={optionId(manualIndex)}
              role="option"
              aria-selected={active === manualIndex}
              className="cursor-pointer rounded-lg px-2 py-1.5 text-sm text-muted-foreground aria-selected:bg-muted aria-selected:text-foreground"
              onMouseMove={() => setActive(manualIndex)}
              onClick={() => chooseIndex(manualIndex)}
            >
              {t('address.suggestions.manual')}
            </li>
          </ul>
          {/* Google's attribution for suggestions shown without a map. */}
          <p aria-hidden="true" className="px-2 pb-0.5 pt-1 text-right text-2xs text-subtle">
            {t('address.suggestions.attribution')}
          </p>
        </div>
      )}
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  )
})

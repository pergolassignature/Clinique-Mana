import { forwardRef, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { addDays, addMonths, endOfWeek, format, startOfMonth, startOfWeek } from 'date-fns'
import { fr } from 'date-fns/locale'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { t } from '@/i18n'
import { isDateInRange, parseDateText } from '@/shared/lib/date-time-entry'
import { formatDateOnlyFull, formatDateOnlyShort, getClinicDateString, isCalendarDate } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import { Button } from './button'
import { focusRing } from './field-classes'
import { Input } from './input'
import { Popover, PopoverAnchor, PopoverContent } from './popover'
import { useFieldReadOnly } from './read-only-context'
import { useTypedEntry } from './use-typed-entry'

export interface DateFieldProps {
  id?: string
  name?: string
  /** A calendar date, `yyyy-MM-dd`, '' when empty: the native input's value. Never converted to a timezone. */
  value: string | null | undefined
  /** `yyyy-MM-dd`, or '' when the person empties the field. */
  onChange: (value: string) => void
  onBlur?: () => void
  /**
   * The first and last days the calendar offers (`yyyy-MM-dd`, inclusive). A typed date outside them
   * is handed over, as the native input did: the form's validation says why it is refused.
   */
  min?: string | null
  max?: string | null
  /** An optional date: « Effacer » in the calendar. Emptying the text always clears, as natively. */
  clearable?: boolean
  /** Shows the value without letting it change (defaults to the surrounding context). */
  readOnly?: boolean
  autoFocus?: boolean
  /** For react-hook-form's `field` (never set: fields are read-only, not disabled). */
  disabled?: boolean
  className?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  'aria-label'?: string
}

/**
 * A react-hook-form date bound to a field (`useController`'s `field`), for a component that renders
 * its own DateField (« À partir du »). Merge `ref` with another ref when the dialog focuses it.
 */
export interface DateFieldBinding {
  name: string
  value: string | null | undefined
  onChange: (value: string) => void
  onBlur: () => void
  ref: (element: HTMLInputElement | null) => void
}

/** A calendar date as a local noon `Date`, for date-fns' month arithmetic (noon: no DST edge). */
function toDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year!, month! - 1, day!, 12)
}

const toValue = (date: Date) => format(date, 'yyyy-MM-dd')

/** « 12 oct. 2026 », '' for an empty or unreadable value. */
const display = (value: string) => (isCalendarDate(value) ? formatDateOnlyShort(value) : '')

/** A typed text that names a day is finished (« 12/10/2026 »): handed over while typing. */
const isComplete = (text: string) => parseDateText(text) !== null

const clamp = (value: string, min?: string | null, max?: string | null) => (min && value < min ? min : max && value > max ? max : value)

const ignore = (event: MouseEvent) => event.preventDefault()

const navButton = `inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground ${focusRing}`
const captionSelect = `h-7 rounded-md border border-input bg-card px-1.5 text-sm text-foreground hover:border-input-hover ${focusRing}`

/**
 * A calendar date (birthday, expiry, « à partir du ») in place of the native `<input type="date">`,
 * whose look follows the browser's language. Spread `FormField`'s props on it like an `Input`; its
 * value is the native input's `yyyy-MM-dd` string, so `onChange` hands over the value itself, not an
 * event (react-hook-form: `Controller`, `field.onChange`). Shown with `formatDateOnlyShort`
 * (« 12 oct. 2026 »), never through a timezone (CLAUDE.md §9).
 *
 * - Typing: « 12/10/2026 » (day first, as in Québec), « 2026-10-12 », « 12 oct 2026 ». A finished
 *   date is handed over at once; on Entrée or when leaving, the text is tidied, or the last date put
 *   back when it cannot be read. A date outside `min`–`max` is handed over (the form refuses it).
 * - The calendar (a click in the field, the calendar icon, ↓ or Alt+↓): weeks start on Monday, today
 *   is marked, the month and year can be picked. ↓ moves into it; arrows by day and week, Page↑/↓ by
 *   month (with Maj: by year), Début/Fin to the week's ends, Entrée or Espace chooses, Échap closes
 *   it and goes back to the field (the dialog around stays open). « Aujourd'hui », and « Effacer »
 *   when `clearable`.
 * - Read-only: a plain read-only input with the date.
 */
export const DateField = forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
  { value, onChange, onBlur, min, max, clearable = false, readOnly: readOnlyProp, className, ...props },
  ref,
) {
  const readOnly = useFieldReadOnly(readOnlyProp)
  const current = value && isCalendarDate(value) ? value : ''
  const entry = useTypedEntry({ value: current, format: display, parse: parseDateText, isComplete, onChange })

  const [open, setOpen] = useState(false)
  /** The day that has (or will have) keyboard focus in the calendar; its month is the one shown. */
  const [focused, setFocused] = useState(current)
  /** The focused day should take keyboard focus once rendered (↓ from the field, arrows in the grid). */
  const focusDay = useRef(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLTableElement>(null)
  /** Whether closing should put focus back in the field (a choice, Échap), not an outside click. */
  const refocus = useRef(false)
  const baseId = useId()
  const dialogId = `${baseId}-calendar`
  const captionId = `${baseId}-caption`
  const today = getClinicDateString(new Date())

  const input = () => wrapper.current?.querySelector('input') ?? null

  const show = (focusCalendar: boolean) => {
    setFocused(clamp(current || today, min, max))
    focusDay.current = focusCalendar
    setOpen(true)
  }

  const close = (backToField: boolean) => {
    if (backToField) refocus.current = true
    setOpen(false)
  }

  // Keyboard focus follows the focused day while the person moves in the grid.
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      const inGrid = grid.current?.contains(document.activeElement) ?? false
      if (!focusDay.current && !inGrid) return
      focusDay.current = false
      grid.current?.querySelector<HTMLButtonElement>(`button[data-day="${focused}"]`)?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, focused])

  const choose = (day: string) => {
    if (!isDateInRange(day, min, max)) return
    entry.choose(day)
    close(true)
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Before the `defaultPrevented` check: inside a Sheet or Dialog, Échap arrives already marked
    // handled (`keepOpenForCombobox` kept the dialog open for it), and the calendar must still close.
    if (event.key === 'Escape') {
      if (!open) return
      event.preventDefault()
      event.stopPropagation()
      close(false)
      return
    }
    if (event.defaultPrevented) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const typed = entry.commit()
      if (open) {
        focusDay.current = true
        setFocused((day) => (typed ? clamp(typed, min, max) : day || clamp(today, min, max)))
        grid.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus({ preventScroll: true })
      } else {
        show(true)
      }
      return
    }
    if (event.key === 'Enter') {
      entry.commit()
      if (open) close(false)
      return
    }
    if (event.key === 'Tab') close(false)
  }

  const handleGridKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const base = toDate(focused || today)
    let next: Date | null = null
    switch (event.key) {
      case 'ArrowLeft':
        next = addDays(base, -1)
        break
      case 'ArrowRight':
        next = addDays(base, 1)
        break
      case 'ArrowUp':
        next = addDays(base, -7)
        break
      case 'ArrowDown':
        next = addDays(base, 7)
        break
      case 'PageUp':
        next = addMonths(base, event.shiftKey ? -12 : -1)
        break
      case 'PageDown':
        next = addMonths(base, event.shiftKey ? 12 : 1)
        break
      case 'Home':
        next = startOfWeek(base, { weekStartsOn: 1 })
        break
      case 'End':
        next = endOfWeek(base, { weekStartsOn: 1 })
        break
      default:
        return
    }
    event.preventDefault()
    focusDay.current = true
    setFocused(clamp(toValue(next), min, max))
  }

  /** Tab stays inside the open calendar (its controls cycle), as in a dialog. */
  const keepTabInside = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled])')).filter(
      (item) => item.tabIndex >= 0,
    )
    if (items.length === 0) return
    const first = items[0]!
    const last = items[items.length - 1]!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  // The month shown: the focused day's.
  const view = startOfMonth(toDate(focused || clamp(today, min, max)))
  const weekStart = startOfWeek(view, { weekStartsOn: 1 })
  const days = Array.from({ length: 42 }, (_, index) => toValue(addDays(weekStart, index)))
  const weekdays = useMemo(() => {
    const monday = startOfWeek(new Date(2026, 0, 5, 12), { weekStartsOn: 1 })
    return Array.from({ length: 7 }, (_, index) => {
      const day = addDays(monday, index)
      return { short: format(day, 'EEEEEE', { locale: fr }), long: format(day, 'EEEE', { locale: fr }) }
    })
  }, [])
  const viewYear = view.getFullYear()
  const todayYear = Number(today.slice(0, 4))
  const firstYear = Math.min(min ? Number(min.slice(0, 4)) : todayYear - 110, viewYear)
  const lastYear = Math.max(max ? Number(max.slice(0, 4)) : todayYear + 10, viewYear)
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index)
  const monthOf = (value: string) => value.slice(0, 7)
  const viewMonth = monthOf(toValue(view))

  /** Another month or year from the caption: same day of the month, kept inside the bounds. */
  const showMonth = (year: number, month: number) => {
    const day = Math.min(toDate(focused || today).getDate(), new Date(year, month + 1, 0).getDate())
    setFocused(clamp(toValue(new Date(year, month, day, 12)), min, max))
  }
  const canGoBack = !min || monthOf(min) < viewMonth
  const canGoForward = !max || monthOf(max) > viewMonth
  const todayInRange = isDateInRange(today, min, max)

  if (readOnly) {
    return <Input ref={ref} {...props} className={className} readOnly value={display(current)} />
  }

  return (
    <Popover open={open} onOpenChange={(next) => (next ? show(false) : close(false))}>
      <PopoverAnchor asChild>
        <div ref={wrapper} className={cn('relative', className)}>
          <Input
            ref={ref}
            {...props}
            type="text"
            role="combobox"
            aria-autocomplete="none"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? dialogId : undefined}
            autoComplete="off"
            spellCheck={false}
            placeholder={t('common.dateField.placeholder')}
            className="pr-8"
            value={entry.text}
            onChange={(event) => {
              entry.type(event.target.value)
              const typed = parseDateText(event.target.value)
              if (typed) setFocused(typed)
            }}
            onClick={() => !open && show(false)}
            onKeyDown={handleInputKeyDown}
            onBlur={() => {
              entry.commit()
              onBlur?.()
            }}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label={t('common.dateField.open')}
            className="absolute inset-y-0 right-0 flex w-8 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground"
            onMouseDown={ignore}
            onClick={() => {
              if (open) close(true)
              else {
                input()?.focus()
                show(false)
              }
            }}
          >
            <CalendarDays aria-hidden className="h-3.5 w-3.5" />
          </button>
        </div>
      </PopoverAnchor>
      <PopoverContent
        id={dialogId}
        role="dialog"
        aria-label={t('common.dateField.dialog')}
        align="start"
        className="w-auto p-3"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (refocus.current) input()?.focus()
          refocus.current = false
        }}
        onEscapeKeyDown={() => {
          refocus.current = true
        }}
        onInteractOutside={(event) => {
          if (wrapper.current?.contains(event.target as Node)) event.preventDefault()
        }}
        onKeyDown={keepTabInside}
      >
        <div className="mb-2 flex items-center justify-between gap-1">
          <button type="button" className={navButton} aria-label={t('common.dateField.previousMonth')} disabled={!canGoBack} onClick={() => setFocused(clamp(toValue(addMonths(toDate(focused || today), -1)), min, max))}>
            <ChevronLeft aria-hidden className="h-4 w-4" />
          </button>
          <div id={captionId} className="flex items-center gap-1">
            <select
              aria-label={t('common.dateField.month')}
              className={captionSelect}
              value={view.getMonth()}
              onChange={(event) => showMonth(viewYear, Number(event.target.value))}
            >
              {Array.from({ length: 12 }, (_, month) => (
                <option key={month} value={month}>
                  {format(new Date(2026, month, 1, 12), 'LLLL', { locale: fr })}
                </option>
              ))}
            </select>
            <select aria-label={t('common.dateField.year')} className={cn(captionSelect, 'tabular')} value={viewYear} onChange={(event) => showMonth(Number(event.target.value), view.getMonth())}>
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className={navButton} aria-label={t('common.dateField.nextMonth')} disabled={!canGoForward} onClick={() => setFocused(clamp(toValue(addMonths(toDate(focused || today), 1)), min, max))}>
            <ChevronRight aria-hidden className="h-4 w-4" />
          </button>
        </div>
        <table ref={grid} role="grid" aria-label={format(view, 'LLLL yyyy', { locale: fr })} className="border-collapse" onKeyDown={handleGridKeyDown}>
          <thead>
            <tr>
              {weekdays.map((weekday) => (
                <th key={weekday.long} scope="col" abbr={weekday.long} className="h-7 w-9 text-center text-xs font-normal text-muted-foreground">
                  {weekday.short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }, (_, week) => (
              <tr key={week}>
                {days.slice(week * 7, week * 7 + 7).map((day) => {
                  const outside = monthOf(day) !== viewMonth
                  const selected = day === current
                  const allowed = isDateInRange(day, min, max)
                  return (
                    <td key={day} role="gridcell" aria-selected={selected} className="p-0 text-center">
                      <button
                        type="button"
                        data-day={day}
                        tabIndex={day === focused ? 0 : -1}
                        aria-label={formatDateOnlyFull(day)}
                        aria-current={day === today ? 'date' : undefined}
                        aria-disabled={!allowed || undefined}
                        onClick={() => choose(day)}
                        // A day of the month shown only: focusing a neighbouring month's day would
                        // redraw the grid under the pointer before its click lands.
                        onFocus={() => day !== focused && !outside && setFocused(day)}
                        className={cn(
                          'relative h-9 w-9 rounded-md text-sm tabular transition-colors',
                          focusRing,
                          outside ? 'text-subtle' : 'text-foreground',
                          allowed ? 'hover:bg-muted' : 'cursor-not-allowed text-subtle line-through opacity-60',
                          day === today && !selected && 'font-semibold text-primary',
                          selected && 'bg-primary font-medium text-primary-foreground hover:bg-primary-hover',
                        )}
                      >
                        {Number(day.slice(8, 10))}
                        {day === today && (
                          <span aria-hidden className={cn('absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full', selected ? 'bg-primary-foreground' : 'bg-primary')} />
                        )}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
          <Button type="button" variant="ghost" size="sm" disabled={!todayInRange} onClick={() => choose(today)}>
            {t('common.dateField.today')}
          </Button>
          {clearable && current && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                entry.choose('')
                close(true)
              }}
            >
              {t('common.dateField.clear')}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
})

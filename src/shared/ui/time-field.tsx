import { forwardRef, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Check, Clock } from 'lucide-react'
import { t } from '@/i18n'
import { isCompleteTimeText, minutesToTime, normalizeTime, parseTimeText, timeToMinutes } from '@/shared/lib/date-time-entry'
import { cn } from '@/shared/lib/utils'
import { Input } from './input'
import { Popover, PopoverAnchor, PopoverContent } from './popover'
import { useFieldReadOnly } from './read-only-context'
import { useTypedEntry } from './use-typed-entry'

export interface TimeFieldProps {
  id?: string
  name?: string
  /** `HH:mm` (seconds from the database are dropped), '' when empty: the native input's value. */
  value: string | null | undefined
  /** `HH:mm`, or '' when the person empties the field. */
  onChange: (value: string) => void
  onBlur?: () => void
  /** Minutes between two times of the list (default 15). Typing still accepts any minute. */
  step?: number
  /**
   * The earliest and latest times of the list (`HH:mm`, inclusive). A typed time outside them is
   * handed over, as the native input did: the form's validation says why it is refused.
   */
  min?: string
  max?: string
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

/** Where the list opens when the field is empty: the start of a working day. */
const EMPTY_START = 8 * 60

const ignore = (event: MouseEvent) => event.preventDefault()

/**
 * A time of day, 24-hour, as Québec writes it (« 07:00 », never AM/PM), in place of the native
 * `<input type="time">`, whose look follows the browser's language. Spread `FormField`'s props on it
 * like an `Input`; its value is the native input's `HH:mm` string, so `onChange` hands over the value
 * itself, not an event (react-hook-form: `Controller`, `field.onChange`).
 *
 * - Typing: « 7 », « 0730 », « 7:30 », « 7h », « 7 h 30 ». A finished time is handed over at once;
 *   « 7 » or « 17 » on Entrée or when leaving the field, then shown as « 07:00 ». What cannot be read
 *   puts the last time back.
 * - The list (a click in the field, the clock, ↓ or ↑): every `step` minutes, opened on the current
 *   time. ↓/↑ move, Page↓/Page↑ by an hour, Entrée chooses, Échap closes it (the dialog around stays
 *   open: `keepOpenForCombobox`), Tab or leaving closes it. The mouse chooses without taking focus.
 * - Read-only: a plain read-only input with the time.
 */
export const TimeField = forwardRef<HTMLInputElement, TimeFieldProps>(function TimeField(
  { value, onChange, onBlur, step = 15, min, max, readOnly: readOnlyProp, className, ...props },
  ref,
) {
  const readOnly = useFieldReadOnly(readOnlyProp)
  const current = normalizeTime(value)
  const minMinutes = min ? timeToMinutes(min) : 0
  const maxMinutes = max ? timeToMinutes(max) : 23 * 60 + 59
  const entry = useTypedEntry({ value: current, format: normalizeTime, parse: parseTimeText, isComplete: isCompleteTimeText, onChange })
  const options = useMemo(() => {
    const list: string[] = []
    const every = Math.max(1, Math.round(step))
    for (let minutes = minMinutes; minutes <= maxMinutes; minutes += every) list.push(minutesToTime(minutes))
    return list
  }, [step, minMinutes, maxMinutes])

  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const wrapper = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  /** The list was just opened: its time is centred, not only brought into view. */
  const opening = useRef(false)
  const baseId = useId()
  const listId = `${baseId}-list`
  const optionId = (index: number) => `${baseId}-option-${index}`

  /** The option to start from: the current time, else the nearest after it (or after 08:00). */
  const startIndex = () => {
    const target = current ? timeToMinutes(current) : Math.max(minMinutes, Math.min(EMPTY_START, maxMinutes))
    const index = options.findIndex((option) => timeToMinutes(option) >= target)
    return index === -1 ? options.length - 1 : index
  }

  const show = () => {
    if (open) return
    opening.current = true
    setActive(startIndex())
    setOpen(true)
  }

  const close = () => {
    setOpen(false)
    setActive(-1)
  }

  // The highlighted time stays in view; on opening, the current time is in the middle. The list
  // scrolls itself (not scrollIntoView, which would also scroll the page or the dialog).
  useEffect(() => {
    if (!open || active < 0) return
    const frame = requestAnimationFrame(() => {
      const box = list.current
      const item = box?.children[active] as HTMLElement | undefined
      if (!box || !item) return
      if (opening.current) box.scrollTop = item.offsetTop - (box.clientHeight - item.offsetHeight) / 2
      else if (item.offsetTop < box.scrollTop) box.scrollTop = item.offsetTop
      else if (item.offsetTop + item.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = item.offsetTop + item.offsetHeight - box.clientHeight
      opening.current = false
    })
    return () => cancelAnimationFrame(frame)
  }, [open, active])

  const choose = (option: string) => {
    entry.choose(option)
    close()
  }

  const move = (by: number) => setActive((index) => Math.max(0, Math.min(options.length - 1, (index < 0 ? startIndex() : index) + by)))

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Before the `defaultPrevented` check: inside a Sheet or Dialog, Échap arrives already marked
    // handled (`keepOpenForCombobox` kept the dialog open for it), and the list must still close.
    if (event.key === 'Escape') {
      if (!open) return
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (event.defaultPrevented) return
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault()
        if (!open) show()
        else move(event.key === 'ArrowDown' ? 1 : -1)
        return
      case 'PageDown':
      case 'PageUp':
        if (!open) return
        event.preventDefault()
        move((event.key === 'PageDown' ? 60 : -60) / Math.max(1, Math.round(step)))
        return
      case 'Enter':
        if (open && active >= 0 && options[active]) {
          // Entrée chooses in the list; without the list it keeps its meaning (the form's save).
          event.preventDefault()
          choose(options[active])
          return
        }
        entry.commit()
        return
      case 'Tab':
        close()
        return
    }
  }

  if (readOnly) {
    return <Input ref={ref} {...props} className={className} readOnly value={current} />
  }

  return (
    <Popover open={open} onOpenChange={(next) => (next ? show() : close())}>
      <PopoverAnchor asChild>
        <div ref={wrapper} className={cn('relative', className)}>
          <Input
            ref={ref}
            {...props}
            type="text"
            role="combobox"
            aria-autocomplete="none"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
            autoComplete="off"
            spellCheck={false}
            placeholder={t('common.timeField.placeholder')}
            className="pr-8"
            value={entry.text}
            onChange={(event) => {
              entry.type(event.target.value)
              // What is typed wins over the highlighted time: Entrée then reads the text.
              setActive(-1)
            }}
            onClick={show}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              entry.commit()
              close()
              onBlur?.()
            }}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label={t('common.timeField.open')}
            className="absolute inset-y-0 right-0 flex w-8 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground"
            // The field keeps focus (and its caret): the list is read through it.
            onMouseDown={ignore}
            onClick={() => {
              if (open) close()
              else show()
              wrapper.current?.querySelector('input')?.focus()
            }}
          >
            <Clock aria-hidden className="h-3.5 w-3.5" />
          </button>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[max(var(--radix-popover-trigger-width),7rem)] p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (wrapper.current?.contains(event.target as Node)) event.preventDefault()
        }}
        // A Dialog or Sheet around blocks scrolling outside itself; the list scrolls anyway.
        onWheel={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
      >
        <ul ref={list} id={listId} role="listbox" aria-label={t('common.timeField.list')} className="relative max-h-60 overflow-y-auto overscroll-contain" onMouseDown={ignore}>
          {options.map((option, index) => (
            <li
              key={option}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm tabular aria-selected:bg-muted"
              onMouseMove={() => setActive(index)}
              onClick={() => choose(option)}
            >
              {option}
              {option === current && <Check aria-hidden className="h-3.5 w-3.5 text-primary" />}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
})

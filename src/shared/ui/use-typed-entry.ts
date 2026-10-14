import { useEffect, useRef, useState } from 'react'

interface TypedEntryOptions {
  /** The field's value (`HH:mm`, `yyyy-MM-dd`), '' when empty. */
  value: string
  /** The text shown for a value ('' for ''). */
  format: (value: string) => string
  /** A typed text read into a value, or null when it cannot be read (or is out of bounds). */
  parse: (text: string) => string | null
  /** Whether a typed text is finished, so it is handed over while typing. */
  isComplete: (text: string) => boolean
  onChange: (value: string) => void
}

/**
 * The text of a typed field (TimeField, DateField) and when its value is handed over: at once when
 * the text is a finished value or empty (as the native inputs did, so a form saved without leaving
 * the field still has it), otherwise on `commit()` (Entrée, leaving the field), which also shows the
 * value in its tidy form, or puts the last value back when the text cannot be read. A value the form
 * puts in from outside (« Annuler », `reset`) replaces the text.
 */
export function useTypedEntry({ value, format, parse, isComplete, onChange }: TypedEntryOptions) {
  const [text, setText] = useState(() => format(value))
  /** The last value handed over or received: the form's value as this field knows it. */
  const known = useRef(value)

  useEffect(() => {
    if (value === known.current) return
    known.current = value
    setText(format(value))
  }, [value, format])

  const emit = (next: string) => {
    if (next === known.current) return
    known.current = next
    onChange(next)
  }

  /** The person typed: the text changes, the value only when the text is finished or empty. */
  const type = (next: string) => {
    setText(next)
    if (next.trim() === '') {
      emit('')
      return
    }
    if (!isComplete(next)) return
    const parsed = parse(next)
    if (parsed !== null) emit(parsed)
  }

  /** Hands over what the text says and tidies it; the last value back when it cannot be read. */
  const commit = (): string | null => {
    if (text.trim() === '') {
      emit('')
      setText('')
      return ''
    }
    const parsed = parse(text)
    if (parsed === null) {
      setText(format(known.current))
      return null
    }
    emit(parsed)
    setText(format(parsed))
    return parsed
  }

  /** A value chosen in the list or the calendar. */
  const choose = (next: string) => {
    emit(next)
    setText(format(next))
  }

  return { text, type, commit, choose }
}

import { useRef, type KeyboardEvent } from 'react'
import { cn } from '@/shared/lib/utils'
import { focusRing } from '@/shared/ui/field-classes'

interface SegmentedToggleOption<V extends string> {
  value: V
  label: string
}

interface SegmentedToggleProps<V extends string> {
  /** Names the group (« Afficher », « Affichage »). */
  label: string
  options: readonly SegmentedToggleOption<V>[]
  value: V
  onChange: (value: V) => void
}

/** Keys that move focus between the options, and where they go. */
const MOVES: Record<string, (index: number, last: number) => number> = {
  ArrowRight: (i, last) => (i === last ? 0 : i + 1),
  ArrowDown: (i, last) => (i === last ? 0 : i + 1),
  ArrowLeft: (i, last) => (i === 0 ? last : i - 1),
  ArrowUp: (i, last) => (i === 0 ? last : i - 1),
  Home: () => 0,
  End: (_, last) => last,
}

/**
 * A few mutually exclusive views of a list (« Actifs · Archivés · Tous », « Par catégorie · Liste
 * A–Z »): toggle buttons (`aria-pressed`) in a toolbar with one tab stop (the selected option).
 * Arrow keys, Home and End move focus only; Enter or Space selects (decision #36: an arrow key
 * never changes what is shown).
 */
export function SegmentedToggle<V extends string>({ label, options, value, onChange }: SegmentedToggleProps<V>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const move = MOVES[event.key]
    if (!move) return
    event.preventDefault()
    buttons.current[move(index, options.length - 1)]?.focus()
  }
  return (
    <div role="toolbar" aria-label={label} className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-muted p-0.5">
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            ref={(button) => {
              buttons.current[index] = button
            }}
            type="button"
            aria-pressed={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              `h-7 whitespace-nowrap rounded-sm px-2.5 text-xs font-medium transition-colors duration-120 ${focusRing}`,
              selected ? 'bg-card text-foreground shadow-soft' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

import { useRef, type KeyboardEvent } from 'react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { focusRing } from '@/shared/ui/field-classes'

export const LIST_STATUS_FILTERS = ['active', 'archived', 'all'] as const
export type ListStatusFilterValue = (typeof LIST_STATUS_FILTERS)[number]

interface ListStatusFilterProps {
  value: ListStatusFilterValue
  counts: Record<ListStatusFilterValue, number>
  onChange: (value: ListStatusFilterValue) => void
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
 * « Actifs (n) · Archivés (n) · Tous (n) »: a toggle group with one tab stop (the selected
 * option). Arrow keys, Home and End move focus only; Enter or Space selects (decision #36: an
 * arrow key never changes what is shown). Toggle buttons (`aria-pressed`) in a toolbar.
 */
export function ListStatusFilter({ value, counts, onChange }: ListStatusFilterProps) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const move = MOVES[event.key]
    if (!move) return
    event.preventDefault()
    buttons.current[move(index, LIST_STATUS_FILTERS.length - 1)]?.focus()
  }
  return (
    <div
      role="toolbar"
      aria-label={t('modules.professionals.settings.list.filter.label')}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-muted p-0.5"
    >
      {LIST_STATUS_FILTERS.map((option, index) => {
        const selected = option === value
        return (
          <button
            key={option}
            ref={(button) => {
              buttons.current[index] = button
            }}
            type="button"
            aria-pressed={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              `h-7 whitespace-nowrap rounded-sm px-2.5 text-xs font-medium transition-colors duration-120 ${focusRing}`,
              selected ? 'bg-card text-foreground shadow-soft' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t('modules.professionals.settings.list.filter.option', {
              label: t(`modules.professionals.settings.list.filter.${option}`),
              count: String(counts[option]),
            })}
          </button>
        )
      })}
    </div>
  )
}

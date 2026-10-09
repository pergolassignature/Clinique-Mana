import { forwardRef, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { cn } from '@/shared/lib/utils'
import { focusRing } from '@/shared/ui/field-classes'
import { MOTIF_CATEGORY_ICONS, type MotifCategoryIcon } from '../../lib/constants'
import { motifIconLabel } from '../../lib/display'
import { CategoryIcon } from '../CategoryIcon'

/** Icons per row (`grid-cols-5`): 4 rows of 5 fit a dialog at phone width. */
const COLUMNS = 5
const LAST = MOTIF_CATEGORY_ICONS.length - 1

/** Keys that move focus in the grid, and where they go (Left and Right wrap; Up and Down stop at the edges). */
const MOVES: Record<string, (index: number) => number> = {
  ArrowRight: (i) => (i === LAST ? 0 : i + 1),
  ArrowLeft: (i) => (i === 0 ? LAST : i - 1),
  ArrowDown: (i) => (i + COLUMNS > LAST ? i : i + COLUMNS),
  ArrowUp: (i) => (i - COLUMNS < 0 ? i : i - COLUMNS),
  Home: () => 0,
  End: () => LAST,
}

interface IconPickerProps {
  /** The id of the field's visible label. */
  labelledBy: string
  describedBy?: string
  value: MotifCategoryIcon
  onChange: (icon: MotifCategoryIcon) => void
  onBlur?: () => void
}

/**
 * A motif category's icon: a radio group of the 20 icons in a grid, each named in words. One tab
 * stop (the chosen icon, or the one last reached while inside); arrow keys, Home and End move
 * focus only, Enter, Space or a click chooses (decision #36). Choosing changes the form's draft;
 * nothing is saved until « Enregistrer ». The ref reaches the chosen icon (react-hook-form focus).
 */
export const IconPicker = forwardRef<HTMLButtonElement, IconPickerProps>(function IconPicker(
  { labelledBy, describedBy, value, onChange, onBlur },
  ref,
) {
  const selected = Math.max(0, MOTIF_CATEGORY_ICONS.indexOf(value))
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  // The tab stop while focus is inside; back on the chosen icon once focus leaves the group.
  const [active, setActive] = useState<number | null>(null)
  const tabStop = active ?? selected

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const move = MOVES[event.key]
    if (!move) return
    event.preventDefault()
    const next = move(index)
    setActive(next)
    buttons.current[next]?.focus()
  }
  const onGroupBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    setActive(null)
    onBlur?.()
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onBlur={onGroupBlur}
      className="grid w-fit grid-cols-5 gap-1.5"
    >
      {MOTIF_CATEGORY_ICONS.map((icon, index) => {
        const checked = index === selected
        return (
          <button
            key={icon}
            ref={(button) => {
              buttons.current[index] = button
              if (!checked) return
              if (typeof ref === 'function') ref(button)
              else if (ref) ref.current = button
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={motifIconLabel(icon)}
            tabIndex={index === tabStop ? 0 : -1}
            onClick={() => {
              setActive(index)
              onChange(icon)
            }}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              `inline-flex size-9 items-center justify-center rounded-md border transition-colors duration-120 ${focusRing}`,
              checked
                ? 'border-primary bg-primary-soft text-primary-soft-foreground'
                : 'border-border text-muted-foreground hover:border-input-hover hover:text-foreground',
            )}
          >
            <CategoryIcon icon={icon} className="size-4" />
          </button>
        )
      })}
    </div>
  )
})

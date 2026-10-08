import * as React from 'react'
import { cn } from '@/shared/lib/utils'
import { focusRing } from './field-classes'

export interface SegmentedOption<V extends string> {
  value: V
  label: string
  /** Not offered (skipped by the arrow keys). The chosen option stays shown either way. */
  disabled?: boolean
}

interface SegmentedControlProps<V extends string> {
  options: SegmentedOption<V>[]
  value: V
  /** Runs on a press (click, Enter or Space) of another option; never on focus moves. */
  onValueChange: (value: V) => void
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  /** Every option inactive (e.g. the caller may not change it). */
  disabled?: boolean
  /**
   * A choice is saving: the buttons stay focusable (`aria-disabled`, so focus never drops to
   * <body>) and presses are ignored; the group is `aria-busy`.
   */
  pending?: boolean
  className?: string
}

/**
 * A toggle group of `aria-pressed` buttons, drawn as a segmented control. Keyboard: one tab stop
 * (the chosen option), the arrow keys (and Home / End) only move focus, Enter or Space chooses.
 * So arrowing through it never saves anything (decision #36), unlike native radios.
 */
export function SegmentedControl<V extends string>({
  options,
  value,
  onValueChange,
  disabled = false,
  pending = false,
  className,
  ...aria
}: SegmentedControlProps<V>) {
  const buttons = React.useRef<(HTMLButtonElement | null)[]>([])
  const isEnabled = (option: SegmentedOption<V>) => !disabled && !option.disabled
  const chosen = options.findIndex((o) => o.value === value && isEnabled(o))
  const tabStop = chosen !== -1 ? chosen : options.findIndex(isEnabled)

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const enabled = options.map((o, i) => (isEnabled(o) ? i : -1)).filter((i) => i !== -1)
    if (enabled.length === 0) return
    const current = enabled.indexOf(buttons.current.findIndex((b) => b === document.activeElement))
    let next: number
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = enabled[(current + 1) % enabled.length] as number
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        next = enabled[(current - 1 + enabled.length) % enabled.length] as number
        break
      case 'Home':
        next = enabled[0] as number
        break
      case 'End':
        next = enabled[enabled.length - 1] as number
        break
      default:
        return
    }
    event.preventDefault()
    buttons.current[next]?.focus()
  }

  return (
    <div
      role="group"
      {...aria}
      aria-busy={pending || undefined}
      onKeyDown={onKeyDown}
      className={cn('flex w-full rounded-md border border-border bg-muted p-0.5 sm:inline-flex sm:w-auto', className)}
    >
      {options.map((option, index) => {
        const pressed = option.value === value
        return (
          <button
            key={option.value}
            ref={(button) => {
              buttons.current[index] = button
            }}
            type="button"
            aria-pressed={pressed}
            disabled={!isEnabled(option)}
            aria-disabled={pending || undefined}
            tabIndex={index === tabStop ? 0 : -1}
            onClick={() => {
              if (pending || pressed) return
              onValueChange(option.value)
            }}
            className={cn(
              `flex min-h-11 flex-1 items-center justify-center whitespace-nowrap rounded-sm px-2.5 text-xs text-muted-foreground transition-colors duration-120 hover:text-foreground sm:min-h-7 sm:flex-none ${focusRing}`,
              'aria-pressed:bg-card aria-pressed:font-medium aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-border',
              'disabled:cursor-default disabled:hover:text-muted-foreground [&:disabled:not([aria-pressed=true])]:opacity-50',
              pending && 'cursor-progress',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

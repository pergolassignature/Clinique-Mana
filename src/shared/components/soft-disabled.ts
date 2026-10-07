import type { MouseEvent } from 'react'

/**
 * For a button that is inactive but must keep keyboard focus (a `disabled` button drops focus to
 * <body>, WCAG 2.4.3): mark it `aria-disabled` and ignore presses with `ignoreWhenInactive`.
 * These classes give it the `disabled` look of Button (opacity .5) plus a not-allowed cursor;
 * each caller also pins its variant's hover/active fill (`aria-disabled:hover:…`).
 */
export const softDisabledClasses = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-50'

/**
 * Wraps a click handler: while inactive, the press is cancelled (for a submit button that also
 * cancels the form submission, including Enter in a field) and the handler does not run.
 */
export function ignoreWhenInactive(inactive: boolean, onClick?: () => void) {
  return (event: MouseEvent<HTMLButtonElement>) => {
    if (inactive) {
      event.preventDefault()
      return
    }
    onClick?.()
  }
}

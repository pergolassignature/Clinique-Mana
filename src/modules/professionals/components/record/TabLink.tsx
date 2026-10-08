import type { MouseEvent } from 'react'
import { Link, useNavigate, type LinkProps } from 'react-router-dom'
import { useConfirmLeave } from '@/shared/lib/unsaved-changes-context'
import { cn } from '@/shared/lib/utils'
import { focusRing } from '@/shared/ui/field-classes'
import { recordPath, type RecordTab } from '../../lib/constants'

interface TabLinkProps extends Omit<LinkProps, 'to' | 'replace'> {
  id: string
  tab: RecordTab
  /** Drawn by the caller (e.g. `Button asChild`) instead of as an inline text link. */
  unstyled?: boolean
}

/** Clicks the browser handles itself (new tab or window, other target): never intercepted. */
function isNativeClick(event: MouseEvent<HTMLAnchorElement>, target: string | undefined) {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (target !== undefined && target !== '_self')
}

/**
 * A link to another tab of the same record; it replaces the history entry, as the tabs do (P4-70),
 * and, like a tab switch, asks first while a card of the open tab has unsaved edits
 * (`useConfirmLeave`), so a tab with editable cards can link to another safely. Modified clicks
 * (new tab or window) are left to the browser.
 */
export function TabLink({ id, tab, unstyled = false, className, onClick, ...props }: TabLinkProps) {
  const confirmLeave = useConfirmLeave()
  const navigate = useNavigate()
  const to = recordPath(id, tab)
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || isNativeClick(event, props.target)) return
    event.preventDefault()
    confirmLeave(() => navigate(to, { replace: true }))
  }
  return (
    <Link
      to={to}
      replace
      className={unstyled ? className : cn('rounded-sm text-link underline-offset-[3px] hover:underline', focusRing, className)}
      {...props}
      onClick={handleClick}
    />
  )
}

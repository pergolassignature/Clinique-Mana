import { forwardRef, useContext, type MouseEvent } from 'react'
import { NavLink, useNavigate, type NavLinkProps } from 'react-router-dom'
import { UnsavedChangesContext } from '@/shared/lib/unsaved-changes-context'

/** Clicks the browser handles itself (new tab or window, download, other target): never intercepted. */
function isNativeClick(event: MouseEvent<HTMLAnchorElement>, props: NavLinkProps) {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    (props.target !== undefined && props.target !== '_self') ||
    props.reloadDocument === true
  )
}

/**
 * A `NavLink` that asks before leaving a form with unsaved changes. When nothing is dirty, or for
 * a modified/middle click, it behaves exactly like `NavLink`.
 */
export const GuardedNavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(function GuardedNavLink(props, ref) {
  const { onClick, to, replace, state, relative, preventScrollReset } = props
  const guard = useContext(UnsavedChangesContext)
  const navigate = useNavigate()

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || isNativeClick(event, props) || !guard?.isDirty()) return
    event.preventDefault()
    guard.confirmLeave(() => navigate(to, { replace, state, relative, preventScrollReset }))
  }

  return <NavLink ref={ref} {...props} onClick={handleClick} />
})

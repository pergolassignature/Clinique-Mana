import { Link, type LinkProps } from 'react-router-dom'
import { cn } from '@/shared/lib/utils'
import { focusRing } from '@/shared/ui/field-classes'
import { recordPath, type RecordTab } from '../../lib/constants'

interface TabLinkProps extends Omit<LinkProps, 'to' | 'replace'> {
  id: string
  tab: RecordTab
  /** Drawn by the caller (e.g. `Button asChild`) instead of as an inline text link. */
  unstyled?: boolean
}

/** A link to another tab of the same record; it replaces the history entry, as the tabs do (P4-70). */
export function TabLink({ id, tab, unstyled = false, className, ...props }: TabLinkProps) {
  return (
    <Link
      to={recordPath(id, tab)}
      replace
      className={unstyled ? className : cn('rounded-sm text-link underline-offset-[3px] hover:underline', focusRing, className)}
      {...props}
    />
  )
}

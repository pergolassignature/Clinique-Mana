import * as React from 'react'
import { cn } from '@/shared/lib/utils'
import { focusRing } from './field-classes'

interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  /**
   * Names the horizontal scroll wrapper, not the table (name the table with a `TableCaption` or
   * `aria-labelledby`). With it, the wrapper becomes a focusable region, so keyboard users can
   * scroll a wide table with the arrow keys; without it, the wrapper stays out of the tab order.
   */
  scrollLabel?: string
  /**
   * With `scrollLabel`: `always` (default) keeps the wrapper a tab stop; `overflow` makes it one
   * only while the table is wider than it (there is something to scroll), so a table that fits
   * adds no empty tab stop.
   */
  scrollFocus?: 'always' | 'overflow'
}

/** Whether the wrapper's content is wider than the wrapper; follows resizes of both. */
function useOverflowing(wrapper: React.RefObject<HTMLDivElement | null>, enabled: boolean) {
  const [overflowing, setOverflowing] = React.useState(false)
  React.useLayoutEffect(() => {
    const element = wrapper.current
    if (!enabled || !element) return
    const update = () => setOverflowing(element.scrollWidth > element.clientWidth + 1)
    update()
    if (typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    return () => observer.disconnect()
  }, [wrapper, enabled])
  return overflowing
}

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, scrollLabel, scrollFocus = 'always', ...props }, ref) => {
    const wrapper = React.useRef<HTMLDivElement>(null)
    const overflowing = useOverflowing(wrapper, Boolean(scrollLabel) && scrollFocus === 'overflow')
    const focusable = Boolean(scrollLabel) && (scrollFocus === 'always' || overflowing)
    return (
      <div
        ref={wrapper}
        className={`relative w-full overflow-x-auto rounded-lg ${focusRing}`}
        {...(focusable ? { role: 'region', 'aria-label': scrollLabel, tabIndex: 0 } : {})}
      >
        <table ref={ref} className={cn('w-full caption-bottom text-sm text-foreground', className)} {...props} />
      </div>
    )
  }
)
Table.displayName = 'Table'

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead ref={ref} className={cn('[&_tr]:border-b [&_tr]:border-border [&_tr:hover]:bg-transparent', className)} {...props} />
  )
)
TableHeader.displayName = 'TableHeader'

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
  )
)
TableBody.displayName = 'TableBody'

/** 40px rows with a hairline between them; hover #FAFAFA; a selected row (`data-state="selected"`) is primary-soft. */
const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn('border-b border-border transition-colors duration-120 hover:bg-card-hover data-[state=selected]:bg-primary-soft', className)}
      {...props}
    />
  )
)
TableRow.displayName = 'TableRow'

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        'px-3 py-2 text-left align-middle text-2xs font-medium uppercase tracking-wide text-muted-foreground [&:has([role=checkbox])]:pr-0',
        className
      )}
      {...props}
    />
  )
)
TableHead.displayName = 'TableHead'

/** Padding 8×12, 40px minimum row height; tabular figures so amounts, rates and dates line up. */
const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td ref={ref} className={cn('tabular h-10 px-3 py-2 align-middle [&:has([role=checkbox])]:pr-0', className)} {...props} />
  )
)
TableCell.displayName = 'TableCell'

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn('mt-3 text-xs text-muted-foreground', className)} {...props} />
  )
)
TableCaption.displayName = 'TableCaption'

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption }

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
  /**
   * From `lg`, the header row stays in view under the top bar while the page scrolls (tables over
   * about 15 rows: Journal d'audit, Motifs, Tâches planifiées). The wrapper then clips sideways
   * instead of scrolling (a scrolling box would hold the header inside it); below `lg` the table
   * scrolls sideways as usual and the header does not stick. Under another sticky band (a record
   * header), set `--table-sticky-top` on an ancestor (default: the top bar's height).
   */
  stickyHeader?: boolean
}

type Align = 'left' | 'center' | 'right'

/** Text alignment of a head or a cell: text left; numbers, amounts, counts and percentages right. */
const ALIGN: Record<Align, string> = { left: 'text-left', center: 'text-center', right: 'text-right' }

/** Whether the header sticks (`Table stickyHeader`), and whether a `TableHead` is in the `thead`. */
const StickyHeaderContext = React.createContext(false)
const InHeaderContext = React.createContext(false)

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
  ({ className, scrollLabel, scrollFocus = 'always', stickyHeader = false, ...props }, ref) => {
    const wrapper = React.useRef<HTMLDivElement>(null)
    const overflowing = useOverflowing(wrapper, Boolean(scrollLabel) && scrollFocus === 'overflow')
    const focusable = Boolean(scrollLabel) && (scrollFocus === 'always' || overflowing)
    return (
      <div
        ref={wrapper}
        className={cn('relative w-full overflow-x-auto rounded-lg', stickyHeader && 'lg:overflow-x-clip', focusRing)}
        {...(focusable ? { role: 'region', 'aria-label': scrollLabel, tabIndex: 0 } : {})}
      >
        <StickyHeaderContext.Provider value={stickyHeader}>
          <table ref={ref} className={cn('w-full caption-bottom text-sm text-foreground', className)} {...props} />
        </StickyHeaderContext.Provider>
      </div>
    )
  }
)
Table.displayName = 'Table'

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <InHeaderContext.Provider value>
      <thead ref={ref} className={cn('[&_tr]:border-b [&_tr]:border-border [&_tr:hover]:bg-transparent', className)} {...props} />
    </InHeaderContext.Provider>
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

interface TableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /** `right` for numbers, amounts, counts (« 0 / 3 ») and percentages; default `left`. */
  align?: Align
}

/**
 * The one table-header style: the overline (11/16, 500, caps, +0.06em, secondary). Never restyle
 * it per table (no 12 px, no sentence case, no 600): audit 2026-10-09 §2.6.
 */
const TableHead = React.forwardRef<HTMLTableCellElement, TableHeadProps>(
  ({ className, align = 'left', ...props }, ref) => {
    const stickyTable = React.useContext(StickyHeaderContext)
    const inHeader = React.useContext(InHeaderContext)
    const sticky = stickyTable && inHeader
    return (
      <th
        ref={ref}
        data-sticky={sticky || undefined}
        className={cn(
          'px-3 py-2 align-middle text-2xs font-medium uppercase tracking-wide text-muted-foreground [&:has([role=checkbox])]:pr-0',
          ALIGN[align],
          // The row's hairline does not stick with a collapsed border: the cell draws its own.
          sticky && 'lg:sticky lg:top-[var(--table-sticky-top,var(--topbar-h))] lg:z-10 lg:bg-card lg:shadow-[inset_0_-1px_0_rgb(var(--border))]',
          className
        )}
        {...props}
      />
    )
  }
)
TableHead.displayName = 'TableHead'

interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  /** `right` for numbers, amounts, counts and percentages (they are tabular already); default `left`. */
  align?: Align
}

/** Padding 8×12, 40px minimum row height; tabular figures so amounts, rates and dates line up. */
const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, align, ...props }, ref) => (
    <td
      ref={ref}
      className={cn('tabular h-10 px-3 py-2 align-middle [&:has([role=checkbox])]:pr-0', align && ALIGN[align], className)}
      {...props}
    />
  )
)
TableCell.displayName = 'TableCell'

interface TableGroupRowProps extends React.HTMLAttributes<HTMLTableCellElement> {
  /** The number of columns the group label spans (all of them). */
  colSpan: number
  /** `rowgroup` (default) when the group is its own `TableBody`; `colgroup` for a header over columns. */
  scope?: 'rowgroup' | 'colgroup'
}

/**
 * A group's label row (a module, a category): the overline on the muted fill, a hairline above,
 * as the role matrix does. Never 12/600 dark caps. Put each group in its own `TableBody`, the
 * group row first.
 */
const TableGroupRow = React.forwardRef<HTMLTableCellElement, TableGroupRowProps>(
  ({ className, colSpan, scope = 'rowgroup', children, ...props }, ref) => (
    <tr className="hover:bg-transparent">
      <th
        ref={ref}
        scope={scope}
        colSpan={colSpan}
        className={cn(
          'border-t border-border bg-muted px-3 py-1.5 text-left align-middle text-2xs font-medium uppercase tracking-wide text-muted-foreground',
          className
        )}
        {...props}
      >
        {children}
      </th>
    </tr>
  )
)
TableGroupRow.displayName = 'TableGroupRow'

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn('mt-3 text-xs text-muted-foreground', className)} {...props} />
  )
)
TableCaption.displayName = 'TableCaption'

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption, TableGroupRow }

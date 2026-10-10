import type { ReactNode } from 'react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'

export interface DescriptionItem {
  /** A stable key when two labels could be equal; the label otherwise. */
  key?: string
  label: ReactNode
  /**
   * The value. `null`, `undefined`, `''` and an empty array read « Non indiqué » (or `empty`),
   * in the muted colour: never a blank.
   */
  value?: ReactNode
  /** Another empty text for this row (« Non suivies », « Aucune »). */
  empty?: string
}

interface DescriptionListProps {
  items: readonly DescriptionItem[]
  /**
   * 2: two columns of pairs from `xl` (≥ 1280 px), one below (a read-only tab, Mon profil). 1
   * (default): one column, for a card or the rail.
   */
  columns?: 1 | 2
  /** The label column: `md` 180 px (default), `sm` 132 px (the 320 px rail, a narrow card). */
  labelWidth?: 'sm' | 'md'
  className?: string
}

const isEmpty = (value: ReactNode) =>
  value === null || value === undefined || value === false || value === '' || (Array.isArray(value) && value.length === 0)

const LABEL_COLUMNS = {
  md: 'sm:grid-cols-[180px_minmax(0,1fr)]',
  sm: 'sm:grid-cols-[132px_minmax(0,1fr)]',
} as const

/**
 * The one read-only pattern (decision UI-3, audit 2026-10-09 §2.6): label (13/400 secondary) and
 * value (13/400 foreground) side by side from `sm`, a hairline between rows, « Non indiqué » in
 * the muted colour for an empty value. Full contrast and copyable, without looking like a form.
 * For a tab the user can never edit; a read-only moment inside an editable form keeps `readOnly`
 * inputs. On a phone the label sits above its value.
 */
export function DescriptionList({ items, columns = 1, labelWidth = 'md', className }: DescriptionListProps) {
  return (
    <dl className={cn('grid min-w-0', columns === 2 && 'xl:grid-cols-2 xl:gap-x-8', className)}>
      {items.map((item, index) => {
        const empty = isEmpty(item.value)
        return (
          <div
            key={item.key ?? (typeof item.label === 'string' ? item.label : index)}
            className={cn(
              'grid min-w-0 gap-x-3 gap-y-0.5 border-t border-border-light py-2 first:border-t-0',
              LABEL_COLUMNS[labelWidth],
              // Two columns: the second pair starts the right column, without a hairline above it.
              columns === 2 && 'xl:[&:nth-child(2)]:border-t-0',
            )}
          >
            <dt className="min-w-0 text-sm text-muted-foreground">{item.label}</dt>
            <dd className={cn('min-w-0 break-words text-sm', empty ? 'text-subtle' : 'text-foreground')}>
              {empty ? (item.empty ?? t('common.notProvided')) : item.value}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

import { t } from '@/i18n'
import { SegmentedToggle } from './SegmentedToggle'

export const LIST_STATUS_FILTERS = ['active', 'archived', 'all'] as const
export type ListStatusFilterValue = (typeof LIST_STATUS_FILTERS)[number]

interface ListStatusFilterProps {
  value: ListStatusFilterValue
  counts: Record<ListStatusFilterValue, number>
  onChange: (value: ListStatusFilterValue) => void
}

/**
 * « Actifs (n) · Archivés (n) · Tous (n) »: a `SegmentedToggle` (one tab stop, arrows move focus,
 * Enter or Space selects; decision #36).
 */
export function ListStatusFilter({ value, counts, onChange }: ListStatusFilterProps) {
  return (
    <SegmentedToggle
      label={t('common.listFilter.label')}
      value={value}
      onChange={onChange}
      options={LIST_STATUS_FILTERS.map((option) => ({
        value: option,
        label: t('common.listFilter.option', { label: t(`common.listFilter.${option}`), count: String(counts[option]) }),
      }))}
    />
  )
}

import { Plus, FileText } from 'lucide-react'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/empty-state'
import { FilterBarSkeleton } from '@/shared/components/filter-bar-skeleton'
import { CardGridSkeleton } from '@/shared/components/table-skeleton'
import { Button } from '@/shared/ui/button'

export function ReasonsPage() {
  const isEmpty = true

  return (
    <div className="space-y-6">
      {/* Toolbar: Action button */}
      <div className="flex justify-end">
        <Button disabled>
          <Plus className="h-4 w-4" />
          {t('pages.reasons.action')}
        </Button>
      </div>

      {/* Filter Bar */}
      <FilterBarSkeleton filters={2} showSearch />

      {/* Content */}
      {isEmpty ? (
        <EmptyState
          icon={<FileText className="h-8 w-8" />}
          title={t('pages.reasons.empty.title')}
          description={t('pages.reasons.empty.description')}
        />
      ) : (
        <CardGridSkeleton cards={6} />
      )}
    </div>
  )
}

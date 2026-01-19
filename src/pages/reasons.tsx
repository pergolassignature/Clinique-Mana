import { Plus, FileText } from 'lucide-react'
import { t } from '@/i18n'
import { PageHeader } from '@/shared/components/page-header'
import { EmptyState } from '@/shared/components/empty-state'
import { FilterBarSkeleton } from '@/shared/components/filter-bar-skeleton'
import { CardGridSkeleton } from '@/shared/components/table-skeleton'
import { Button } from '@/shared/ui/button'

export function ReasonsPage() {
  const isEmpty = true

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('pages.reasons.title')}
        subtitle={t('pages.reasons.subtitle')}
        action={{
          label: t('pages.reasons.action'),
          icon: <Plus className="h-4 w-4" />,
          disabled: true,
        }}
      />

      {/* Filter Bar */}
      <FilterBarSkeleton filters={2} showSearch />

      {/* Content */}
      {isEmpty ? (
        <EmptyState
          icon={<FileText className="h-8 w-8" />}
          title={t('pages.reasons.empty.title')}
          description={t('pages.reasons.empty.description')}
          action={
            <Button disabled>
              <Plus className="mr-2 h-4 w-4" />
              {t('pages.reasons.action')}
            </Button>
          }
        />
      ) : (
        <CardGridSkeleton cards={6} />
      )}
    </div>
  )
}

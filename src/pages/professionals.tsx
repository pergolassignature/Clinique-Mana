import { Plus, Users } from 'lucide-react'
import { t } from '@/i18n'
import { PageHeader } from '@/shared/components/page-header'
import { EmptyState } from '@/shared/components/empty-state'
import { FilterBarSkeleton } from '@/shared/components/filter-bar-skeleton'
import { TableSkeleton, CardGridSkeleton } from '@/shared/components/table-skeleton'
import { Button } from '@/shared/ui/button'

export function ProfessionalsPage() {
  // Mock: show empty state by default
  const isEmpty = true
  const showSkeleton = false

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('pages.professionals.title')}
        subtitle={t('pages.professionals.subtitle')}
        action={{
          label: t('pages.professionals.action'),
          icon: <Plus className="h-4 w-4" />,
          disabled: true,
        }}
      />

      {/* Filter Bar */}
      <FilterBarSkeleton filters={3} showSearch />

      {/* Content */}
      {showSkeleton ? (
        <CardGridSkeleton cards={6} />
      ) : isEmpty ? (
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          title={t('pages.professionals.empty.title')}
          description={t('pages.professionals.empty.description')}
          action={
            <Button disabled>
              <Plus className="mr-2 h-4 w-4" />
              {t('pages.professionals.action')}
            </Button>
          }
        />
      ) : (
        <TableSkeleton columns={5} rows={5} />
      )}
    </div>
  )
}

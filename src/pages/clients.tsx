import { Plus, UserCircle } from 'lucide-react'
import { t } from '@/i18n'
import { PageHeader } from '@/shared/components/page-header'
import { EmptyState } from '@/shared/components/empty-state'
import { FilterBarSkeleton } from '@/shared/components/filter-bar-skeleton'
import { TableSkeleton } from '@/shared/components/table-skeleton'
import { Button } from '@/shared/ui/button'

export function ClientsPage() {
  const isEmpty = true

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('pages.clients.title')}
        subtitle={t('pages.clients.subtitle')}
        action={{
          label: t('pages.clients.action'),
          icon: <Plus className="h-4 w-4" />,
          disabled: true,
        }}
      />

      {/* Filter Bar */}
      <FilterBarSkeleton filters={4} showSearch />

      {/* Content */}
      {isEmpty ? (
        <EmptyState
          icon={<UserCircle className="h-8 w-8" />}
          title={t('pages.clients.empty.title')}
          description={t('pages.clients.empty.description')}
          action={
            <Button disabled>
              <Plus className="mr-2 h-4 w-4" />
              {t('pages.clients.action')}
            </Button>
          }
        />
      ) : (
        <TableSkeleton columns={6} rows={8} />
      )}
    </div>
  )
}

import type { ReactNode } from 'react'
import { t } from '@/i18n'
import { useSettingsSection } from '@/core/settings/section-context'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { useProfessionalsCatalog, useReferenceUsage } from '../../hooks/use-catalog'
import type { CatalogView } from '../../lib/catalog-view'

/** What a list section's cards are built from, once both have loaded. */
export interface ReferenceSettingsData {
  /** The nine lists, archived rows included, each in its order (the module's cached catalogue). */
  catalog: CatalogView
  /** « Utilisé par » counts, keyed by `usageKey(kind, id)`. */
  usage: ReadonlyMap<string, number>
  /** The user holds the section's `editPermission` (`professionals.settings`). */
  canEdit: boolean
}

interface ReferenceSettingsPageProps {
  title: string
  description?: string
  /** Page-level buttons in the header (e.g. « Gérer les catégories »), once the data has loaded. */
  actions?: (data: ReferenceSettingsData) => ReactNode
  /** The page's `ReferenceListCard`s. */
  children: (data: ReferenceSettingsData) => ReactNode
}

/**
 * The frame of a « Paramètres → Professionnels » list section (4a.6–4a.9): title, the one
 * « Lecture seule » notice when the user may only read it, then the cards once the catalogue and
 * the usage counts have loaded. Both queries start together (no waterfall); the catalogue is the
 * module's shared cache (5 min), so a section opened after the list or a record shows at once.
 */
export function ReferenceSettingsPage({ title, description, actions, children }: ReferenceSettingsPageProps) {
  const { readOnly } = useSettingsSection()
  const catalog = useProfessionalsCatalog()
  const usage = useReferenceUsage()
  const data: ReferenceSettingsData | null = catalog.data && usage.data ? { catalog: catalog.data, usage: usage.data, canEdit: !readOnly } : null

  let content: ReactNode
  if (data) {
    content = <div className="space-y-5">{children(data)}</div>
  } else if ((catalog.isError && !catalog.data) || (usage.isError && !usage.data)) {
    content = (
      <LoadError
        message={t('modules.professionals.settings.list.loadError')}
        retrying={catalog.isFetching || usage.isFetching}
        onRetry={() => {
          if (catalog.isError) void catalog.refetch()
          if (usage.isError) void usage.refetch()
        }}
      />
    )
  } else {
    content = <Loading />
  }

  return (
    <div className="max-w-content space-y-5">
      <PageHeader title={title} description={description} actions={data && actions?.(data)} />
      {readOnly && <ReadOnlyNotice />}
      {content}
    </div>
  )
}

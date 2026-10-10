import type { ReactNode } from 'react'
import { t } from '@/i18n'
import type { Organization } from '@/core/settings/organization/api'
import { useOrganization } from '@/core/settings/organization/hooks'
import { useSettingsSection } from '@/core/settings/section-context'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { SectionSurface } from '@/shared/components/SettingsCard'

interface OrganizationSettingsPageProps {
  title: string
  description?: string
  /** The page's `OrganizationCard`s, once the organization has loaded. */
  children: (organization: Organization) => ReactNode
}

/**
 * The frame of a settings page that edits the organization: title, the one « Lecture seule »
 * notice when the user may only read the section, then the cards once the organization has
 * loaded (with a loading line, and a load error with « Réessayer »): sections of one surface
 * (`SectionSurface`; each card a `layout="section"`), title and description in an aside from 720 px,
 * fields up to 560 px (audit 2026-10-09 §2.4).
 */
export function OrganizationSettingsPage({ title, description, children }: OrganizationSettingsPageProps) {
  const { readOnly } = useSettingsSection()
  const { data: organization, isPending, isError, isFetching, refetch } = useOrganization()

  return (
    <div className="space-y-5">
      <PageHeader level={1} title={title} description={description} fullWidthDescription />
      {readOnly && <ReadOnlyNotice />}
      {isPending ? (
        <Loading />
      ) : isError && !organization ? (
        <LoadError message={t('settings.organization.loadError')} retrying={isFetching} onRetry={() => void refetch()} />
      ) : (
        organization && <SectionSurface>{children(organization)}</SectionSurface>
      )}
    </div>
  )
}

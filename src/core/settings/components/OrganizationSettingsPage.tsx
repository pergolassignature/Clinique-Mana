import type { ReactNode } from 'react'
import { t } from '@/i18n'
import type { Organization } from '@/core/settings/organization/api'
import { useOrganization } from '@/core/settings/organization/hooks'
import { useSettingsSection } from '@/core/settings/section-context'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { Button } from '@/shared/ui/button'

interface OrganizationSettingsPageProps {
  title: string
  description?: string
  /** The page's `OrganizationCard`s, once the organization has loaded. */
  children: (organization: Organization) => ReactNode
}

/**
 * The frame of a settings page that edits the organization: title, the one « Lecture seule »
 * notice when the user may only read the section, then the cards once the organization has
 * loaded (with a loading line, and a load error with « Réessayer »). Forms max 640 px.
 */
export function OrganizationSettingsPage({ title, description, children }: OrganizationSettingsPageProps) {
  const { readOnly } = useSettingsSection()
  const { data: organization, isPending, isError, isFetching, refetch } = useOrganization()

  return (
    <div className="max-w-form space-y-5">
      <PageHeader title={title} description={description} />
      {readOnly && <ReadOnlyNotice />}
      {isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('common.loading')}
        </p>
      ) : isError && !organization ? (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">{t('settings.organization.loadError')}</p>
          <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : (
        organization && <div className="space-y-4">{children(organization)}</div>
      )}
    </div>
  )
}

import { useState } from 'react'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { useOrganization } from '@/core/settings/organization/hooks'
import { SETTINGS_BASE_PATH } from '@/core/settings/paths'
import { useSettingsSection } from '@/core/settings/section-context'
import { EmptyState } from '@/shared/components/EmptyState'
import { GuardedNavLink } from '@/shared/components/GuardedNavLink'
import { Loading, LoadError } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { SegmentedToggle } from '@/shared/components/SegmentedToggle'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import type { ContractTemplate } from '../../api/contracts'
import { TemplateEditor } from '../../components/settings/TemplateEditor'
import { useContractTemplates } from '../../hooks/use-contracts'

const N = 'modules.professionals.settings.contracts'

const FILTERS = ['all', 'published', 'draft', 'unpublished', 'retired'] as const
type Filter = (typeof FILTERS)[number]

/** Which filters a template answers to (« Publié », « Brouillon en cours », « Non publié », « Retiré »). */
function matches(template: ContractTemplate, filter: Filter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'published':
      return template.isActive && template.publishedVersion !== null
    case 'draft':
      return template.draftVersionId !== null
    case 'unpublished':
      return template.isActive && template.publishedVersion === null
    case 'retired':
      return !template.isActive
  }
}

/** « Version 2 publiée le 8 oct. 2026 », « Non publié ». */
function publicationLabel(template: ContractTemplate): string {
  return template.publishedVersion !== null && template.publishedAt !== null
    ? t(`${N}.list.published`, { version: String(template.publishedVersion), date: formatClinicDateShort(template.publishedAt) })
    : t(`${N}.list.notPublished`)
}

/**
 * Paramètres → Contrats (Task 4d.3, A5.7): the module's document templates (« Contrat de service »
 * today) with a status filter and a search, the selected one's editor (`TemplateEditor`), and the
 * clinic's signer from « Signataire ». Seen with `professionals.manage` or `.settings`, changed
 * with `professionals.settings` (the template's edit permission; read-only otherwise, one notice).
 */
export function ContractsSettingsPage() {
  const { readOnly } = useSettingsSection()
  const templates = useContractTemplates()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const all = templates.data ?? []
  const needle = query.trim().toLocaleLowerCase('fr-CA')
  const shown = all.filter((tpl) => matches(tpl, filter) && (needle === '' || tpl.title.toLocaleLowerCase('fr-CA').includes(needle)))
  // A clinic has one template today: it opens by itself.
  const open = all.find((tpl) => tpl.id === selected) ?? (all.length === 1 ? all[0] : null)

  return (
    <div className="space-y-5">
      <div className="max-w-form space-y-5">
        <PageHeader title={t(`${N}.title`)} description={t(`${N}.description`)} />
        {readOnly && <ReadOnlyNotice />}
        <SettingsCard as="section" title={t(`${N}.list.title`)} description={t(`${N}.list.description`)}>
          {templates.isPending ? (
            <Loading />
          ) : templates.data === undefined ? (
            <LoadError
              message={moduleErrorMessage(templates.error, t(`${N}.list.loadError`), 'settings')}
              retrying={templates.isFetching}
              onRetry={() => void templates.refetch()}
            />
          ) : (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <SegmentedToggle
                  label={t(`${N}.list.filterLabel`)}
                  value={filter}
                  onChange={setFilter}
                  options={FILTERS.map((value) => ({
                    value,
                    label: t(`${N}.list.filter`, { label: t(`${N}.list.filters.${value}`), count: String(all.filter((tpl) => matches(tpl, value)).length) }),
                  }))}
                />
                <Input
                  type="search"
                  aria-label={t(`${N}.list.search`)}
                  placeholder={t(`${N}.list.search`)}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="sm:max-w-56"
                />
              </div>
              {shown.length === 0 ? (
                <EmptyState title={t(`${N}.list.emptyTitle`)} body={t(`${N}.list.emptyBody`)} />
              ) : (
                <ul className="divide-y divide-border-light border-y border-border-light">
                  {shown.map((tpl) => (
                    <li key={tpl.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-sm font-medium text-foreground">{tpl.title}</p>
                        {tpl.description && <p className="text-xs text-muted-foreground">{tpl.description}</p>}
                        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>{publicationLabel(tpl)}</span>
                          {tpl.draftVersionId !== null && <Badge variant="info">{t(`${N}.list.draft`)}</Badge>}
                          {!tpl.isActive && <Badge variant="warning">{t(`${N}.list.retired`)}</Badge>}
                        </p>
                      </div>
                      {open?.id !== tpl.id && (
                        <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setSelected(tpl.id)}>
                          {t(`${N}.list.open`, { title: tpl.title })}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </SettingsCard>
        <ClinicSignerCard />
      </div>
      {open && (
        <section aria-label={t(`${N}.editorLabel`, { title: open.title })} className="max-w-4xl">
          <TemplateEditor template={open} readOnly={readOnly || !open.canEdit} />
        </section>
      )}
    </div>
  )
}

/** « Signataire de la clinique » (A5.8): who signs second when Settings has a name and an address; changed in « Signataire ». */
function ClinicSignerCard() {
  const organization = useOrganization()
  const org = organization.data
  const configured = Boolean(org?.signatory_name?.trim() && org?.signatory_email?.trim())
  return (
    <SettingsCard as="section" title={t(`${N}.signer.title`)} description={t(`${N}.signer.description`)}>
      {organization.isPending ? (
        <Loading />
      ) : !org ? (
        <LoadError message={t(`${N}.signer.loadError`)} retrying={organization.isFetching} onRetry={() => void organization.refetch()} />
      ) : configured ? (
        <p className="text-sm">
          <span className="font-medium text-foreground">{org.signatory_name}</span>
          {org.signatory_title && <span className="text-muted-foreground">, {org.signatory_title}</span>}
          <span className="block text-xs text-muted-foreground">{t(`${N}.signer.signsSecond`, { email: org.signatory_email ?? '' })}</span>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{t(`${N}.signer.none`)}</p>
      )}
      <p className="text-sm">
        <GuardedNavLink to={`${SETTINGS_BASE_PATH}/signataire`} className="text-link underline-offset-[3px] hover:underline">
          {t(`${N}.signer.link`)}
        </GuardedNavLink>
      </p>
    </SettingsCard>
  )
}

import { useMemo, useState } from 'react'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { useOrganization } from '@/core/settings/organization/hooks'
import { SETTINGS_BASE_PATH } from '@/core/settings/paths'
import { useSettingsSection } from '@/core/settings/section-context'
import { DocumentTemplateEditor, type TemplateEditorOptions } from '@/core/signing/templates/DocumentTemplateEditor'
import { VALIDATION_BANNER } from '@/core/signing/templates/markup'
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
import { useContractEditorHandlers, useContractTemplates } from '../../hooks/use-contracts'

const N = 'modules.professionals.settings.contracts'
const E = `${N}.editor`

/** Where the service contract prints Annexe A (`pricing.annexe_a`, filled by `professionals-contract-send`). */
const ANNEXE_PLACEHOLDER = '{{pricing.annexe_a}}'

/**
 * Professionnels' words for the shared editor (CC-12): the professional's initials on every page,
 * Annexe A (required wherever the template declares it, with a sample grid in the preview), the
 * « à faire valider » line, and « Publier » here.
 */
function contractEditorOptions(): Omit<TemplateEditorOptions, 'handlers'> {
  return {
    initials: { role: 'professional', label: t(`${E}.form.initials`), help: t(`${E}.form.initialsHelp`) },
    block: {
      placeholder: ANNEXE_PLACEHOLDER,
      required: true,
      note: t(`${E}.variables.annexe`),
      missing: t(`${E}.annexeMissing`, { placeholder: ANNEXE_PLACEHOLDER }),
      blocked: t(`${E}.publishBlocked.annexe`, { placeholder: ANNEXE_PLACEHOLDER }),
      sample: {
        caption: t(`${E}.preview.annexeCaption`),
        columns: [t(`${E}.preview.annexeColumns.sessions`), t(`${E}.preview.annexeColumns.d60`), t(`${E}.preview.annexeColumns.d50`), t(`${E}.preview.annexeColumns.d30`)],
        rows: [
          [t(`${E}.preview.annexeRows.first`), '144 $', '126 $', '93,60 $'],
          [t(`${E}.preview.annexeRows.second`), '145 $', '126,88 $', '94,25 $'],
          [t(`${E}.preview.annexeRows.last`), '150 $', '131,25 $', '97,50 $'],
        ],
      },
    },
    banner: { text: VALIDATION_BANNER, notice: t(`${E}.bannerNotice`, { banner: VALIDATION_BANNER }), blocked: t(`${E}.publishBlocked.banner`) },
    canPublish: true,
  }
}

const FILTERS = ['all', 'published', 'draft', 'unpublished', 'retired'] as const
type Filter = (typeof FILTERS)[number]

/**
 * The filters and the search show from this many templates, when the list can outgrow a screen
 * (audit 2026-10-09 §2.6): five filters and a search for two templates were noise.
 */
const FILTERS_FROM = 8

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
 * Paramètres → Contrats et formulaires (Task 4d.3, A5.7; P4-482): the module's document templates
 * (« Contrat de service », « Consentement au droit à l'image »), with a status filter and a search once
 * they are `FILTERS_FROM` or more, the selected one's editor (core's `DocumentTemplateEditor`), and the
 * clinic's signer from « Signataire ». Seen with `professionals.manage` or `.settings`, changed
 * with `professionals.settings` (the template's edit permission; read-only otherwise, one notice).
 */
export function ContractsSettingsPage() {
  const { readOnly } = useSettingsSection()
  const templates = useContractTemplates()
  const handlers = useContractEditorHandlers()
  const editorOptions = useMemo(contractEditorOptions, [])
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const all = templates.data ?? []
  const filtering = all.length >= FILTERS_FROM
  const needle = filtering ? query.trim().toLocaleLowerCase('fr-CA') : ''
  const shown = filtering ? all.filter((tpl) => matches(tpl, filter) && (needle === '' || tpl.title.toLocaleLowerCase('fr-CA').includes(needle))) : all
  // A single template opens by itself; with several, « Ouvrir » picks one.
  const open = all.find((tpl) => tpl.id === selected) ?? (all.length === 1 ? all[0] : null)

  return (
    <div className="space-y-5">
      <div className="max-w-form space-y-5">
        <PageHeader level={1} title={t(`${N}.title`)} description={t(`${N}.description`)} />
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
              {filtering && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {/* Five filters do not fit a phone: they scroll inside the card, never the page. */}
                  <div className="max-w-full overflow-x-auto">
                    <SegmentedToggle
                      label={t(`${N}.list.filterLabel`)}
                      value={filter}
                      onChange={setFilter}
                      options={FILTERS.map((value) => ({
                        value,
                        label: t(`${N}.list.filter`, { label: t(`${N}.list.filters.${value}`), count: String(all.filter((tpl) => matches(tpl, value)).length) }),
                      }))}
                    />
                  </div>
                  <Input
                    type="search"
                    aria-label={t(`${N}.list.search`)}
                    placeholder={t(`${N}.list.search`)}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="sm:w-56"
                  />
                </div>
              )}
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
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="self-start"
                          aria-label={t(`${N}.list.open`, { title: tpl.title })}
                          onClick={() => setSelected(tpl.id)}
                        >
                          {t(`${N}.list.openShort`)}
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
        <section aria-label={t(`${N}.editorLabel`, { title: open.title })} className="max-w-form">
          <DocumentTemplateEditor template={open} readOnly={readOnly || !open.canEdit} options={{ ...editorOptions, handlers }} />
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

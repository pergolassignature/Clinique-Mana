import { useId } from 'react'
import { t, type TranslationKey } from '@/i18n'
import type { EmailTemplate } from '@/core/email/api'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { focusRing } from '@/shared/ui/field-classes'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { SectionHeading } from '@/shared/components/SectionHeading'

/** « Plateforme » for core; the module's name (`modules.<key>.name`), else its key. */
function groupLabel(moduleKey: string): string {
  if (moduleKey === 'core') return t('settings.email.templates.coreGroup')
  const key = `modules.${moduleKey}.name` as TranslationKey
  const name = t(key)
  return name === key ? moduleKey : name
}

/** The templates by module, in the RPC's order (core first). */
function byModule(templates: EmailTemplate[]): [string, EmailTemplate[]][] {
  const groups = new Map<string, EmailTemplate[]>()
  for (const template of templates) groups.set(template.module_key, [...(groups.get(template.module_key) ?? []), template])
  return [...groups]
}

interface TemplatesTableProps {
  templates: EmailTemplate[]
  /** `trigger`: the row's button, where focus returns when the editor closes. */
  onOpen: (key: string, trigger: HTMLButtonElement) => void
}

/**
 * « Modèles »: one table per module, a row per template: its name (a button that opens the editor)
 * and what it is for, « Personnalisé » or « Par défaut », and the last change (date, who).
 */
export function TemplatesTable({ templates, onOpen }: TemplatesTableProps) {
  return (
    <div className="space-y-5">
      {byModule(templates).map(([moduleKey, rows]) => (
        <TemplateGroup key={moduleKey} title={groupLabel(moduleKey)} rows={rows} onOpen={onOpen} />
      ))}
    </div>
  )
}

function TemplateGroup({ title, rows, onOpen }: { title: string; rows: EmailTemplate[]; onOpen: TemplatesTableProps['onOpen'] }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <SectionHeading id={headingId}>{title}</SectionHeading>
      <div className="rounded-lg border border-border">
        {/* Fixed layout from `sm`: every module's table has its columns at the same place. */}
        <Table
          aria-labelledby={headingId}
          scrollLabel={t('settings.email.templates.scrollLabel')}
          className="sm:table-fixed max-sm:[&_td]:px-2 max-sm:[&_th]:px-2"
        >
          <TableHeader>
            <TableRow className="[&>th]:whitespace-nowrap">
              <TableHead>{t('settings.email.templates.columns.template')}</TableHead>
              <TableHead className="sm:w-32">{t('settings.email.templates.columns.state')}</TableHead>
              <TableHead className="text-right max-sm:hidden sm:w-60">{t('settings.email.templates.columns.lastChange')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((template) => (
              <TableRow
                key={template.key}
                className="cursor-pointer"
                onClick={(event) => {
                  // Selecting text is not a click on the row.
                  if (window.getSelection()?.toString()) return
                  const button = event.currentTarget.querySelector('button')
                  if (button) onOpen(template.key, button)
                }}
              >
                <TableCell className="align-top">
                  <button
                    type="button"
                    className={`rounded-sm text-left font-medium hover:underline ${focusRing}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      onOpen(template.key, event.currentTarget)
                    }}
                  >
                    {template.label}
                  </button>
                  <span className="block text-xs text-muted-foreground">{template.description}</span>
                </TableCell>
                <TableCell className="whitespace-nowrap align-top">
                  {template.is_custom ? t('settings.email.templates.custom') : t('settings.email.templates.default')}
                </TableCell>
                <TableCell className="text-right align-top text-muted-foreground max-sm:hidden">
                  {template.is_custom && template.updated_at
                    ? template.updated_by_name
                      ? t('settings.email.templates.changedBy', { date: formatClinicDateShort(template.updated_at), name: template.updated_by_name })
                      : formatClinicDateShort(template.updated_at)
                    : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

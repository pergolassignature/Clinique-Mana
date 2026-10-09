import { t } from '@/i18n'
import type { DocumentTemplate } from '@/core/signing/api'
import { moduleLabel } from '@/core/signing/labels'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { Badge } from '@/shared/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'

/**
 * « Modèles de documents », read-only: each template the caller may see, its module, and its
 * publication state (the published version is what is sent; a draft in progress; a template
 * retired with `set_document_template_active`). Templates are edited with their module (Phase 4).
 */
export function DocumentTemplatesTable({ templates }: { templates: DocumentTemplate[] }) {
  return (
    <div className="rounded-lg border border-border">
      <Table aria-label={t('settings.signing.tabs.templates')} scrollLabel={t('settings.signing.templates.scrollLabel')} className="max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
        <TableHeader>
          <TableRow className="[&>th]:whitespace-nowrap">
            <TableHead>{t('settings.signing.templates.columns.template')}</TableHead>
            <TableHead className="max-sm:hidden">{t('settings.signing.templates.columns.module')}</TableHead>
            <TableHead>{t('settings.signing.templates.columns.version')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {templates.map((template) => (
            <TableRow key={template.id}>
              <TableCell className="align-top sm:min-w-64">
                <span className="block font-medium">{template.title}</span>
                {template.description && <span className="block text-xs text-muted-foreground">{template.description}</span>}
              </TableCell>
              <TableCell className="whitespace-nowrap align-top text-muted-foreground max-sm:hidden">{moduleLabel(template.module_key)}</TableCell>
              <TableCell className="align-top">
                <span className="block">
                  {template.published_version !== null && template.published_at !== null
                    ? t('settings.signing.templates.published', {
                        version: String(template.published_version),
                        date: formatClinicDateShort(template.published_at),
                      })
                    : t('settings.signing.templates.notPublished')}
                </span>
                <span className="flex flex-wrap gap-x-3">
                  {template.draft_version_id !== null && <Badge variant="info">{t('settings.signing.templates.draft')}</Badge>}
                  {!template.is_active && <Badge variant="warning">{t('settings.signing.templates.inactive')}</Badge>}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

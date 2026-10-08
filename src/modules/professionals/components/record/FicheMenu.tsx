import { ChevronDown, Download, FileText, LoaderCircle } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { preloadFicheRenderer, useDownloadFiche } from '../../hooks/use-fiche'
import { ficheTitles } from '../../lib/fiche'
import { useRecordData } from './record-context'

const M = 'modules.professionals.fiche.menu'

/**
 * « Fiche PDF » (design §5.3, Task 4c.5): its own outline button in the record header, not the
 * « … » menu, which holds the status actions only (P4-110, P4-206). « Télécharger » makes the PDF
 * in the browser; with two titles, one item per title (one fiche per title, A2.19), the primary
 * first. The renderer's chunk starts loading as the menu opens. While a fiche is being made the
 * button shows a spinner and further choices wait (`aria-busy`).
 */
export function FicheMenu() {
  const { record, catalog } = useRecordData()
  const download = useDownloadFiche()
  const titles = ficheTitles(record, catalog)
  const busy = download.isPending

  const downloadFor = (titleId: string | null) => {
    if (!busy) download.mutate({ record, catalog, titleId })
  }

  return (
    <DropdownMenu onOpenChange={(open) => open && preloadFicheRenderer()}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" aria-busy={busy || undefined}>
          {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <FileText aria-hidden />}
          {t(`${M}.trigger`)}
          <ChevronDown className="text-subtle" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {titles.length > 1 ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t(`${M}.download`)}</DropdownMenuLabel>
            {titles.map((title) => (
              <DropdownMenuItem
                key={title.titleId}
                disabled={busy}
                aria-label={t(`${M}.downloadTitle`, { title: title.name })}
                onSelect={() => downloadFor(title.titleId)}
              >
                <Download className="text-subtle" aria-hidden />
                {title.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ) : (
          <DropdownMenuItem disabled={busy} onSelect={() => downloadFor(titles[0]?.titleId ?? null)}>
            <Download className="text-subtle" aria-hidden />
            {t(`${M}.download`)}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

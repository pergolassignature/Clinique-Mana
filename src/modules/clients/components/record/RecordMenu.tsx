import { useRef, useState } from 'react'
import { Combine, Download, Eraser, LoaderCircle, MoreHorizontal } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess, useReadyAccess } from '@/core/access/access-context'
import { Button } from '@/shared/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { preloadPrivacyRenderer, useExportClientPrivacy } from '../../hooks/use-privacy'
import { AnonymizeDialog } from './AnonymizeDialog'
import { MergeDialog } from './MergeDialog'
import { useClientRecordData } from './record-context'

const R = 'modules.clients.record.menu'

type Asked = 'merge' | 'anonymize' | null

/**
 * The record's « … » menu (plan C4.1, C4.2): « Fusionner avec un autre dossier… » (clients.merge),
 * then « Confidentialité » (clients.privacy): « Exporter le dossier (PDF) » and « Anonymiser le
 * dossier… ». Hidden when the person may do none of them; nothing but the export on a merged or
 * anonymised file. A dialog opens once the menu has closed (its focus handled), as « Fiche PDF ».
 */
export function RecordMenu() {
  const { can } = useAccess()
  const { org_name: clinic } = useReadyAccess()
  const { summary, reference } = useClientRecordData()
  const client = summary.client
  const exporting = useExportClientPrivacy()
  const [open, setOpen] = useState<Asked>(null)
  const asked = useRef<Asked>(null)
  const closed = client.mergedIntoId !== null || client.anonymizedAt !== null
  const canMerge = can('clients.merge') && !closed
  const canPrivacy = can('clients.privacy')
  if (!canMerge && !canPrivacy) return null
  const busy = exporting.isPending

  return (
    <>
      <DropdownMenu
        onOpenChange={(isOpen) => {
          if (!isOpen) return
          asked.current = null
          if (canPrivacy) preloadPrivacyRenderer()
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="icon" aria-label={t(`${R}.label`)} aria-busy={busy || undefined}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <MoreHorizontal aria-hidden />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            if (!asked.current) return
            event.preventDefault()
            setOpen(asked.current)
            asked.current = null
          }}
        >
          {canMerge && (
            <DropdownMenuItem onSelect={() => (asked.current = 'merge')}>
              <Combine className="text-subtle" aria-hidden />
              {t(`${R}.merge`)}
            </DropdownMenuItem>
          )}
          {canMerge && canPrivacy && <DropdownMenuSeparator />}
          {canPrivacy && (
            <>
              <DropdownMenuLabel>{t(`${R}.privacy`)}</DropdownMenuLabel>
              <DropdownMenuItem disabled={busy} onSelect={() => !busy && exporting.mutate({ id: client.id, reference, clinic })}>
                <Download className="text-subtle" aria-hidden />
                {t(`${R}.export`)}
              </DropdownMenuItem>
              {!client.anonymizedAt && (
                <DropdownMenuItem onSelect={() => (asked.current = 'anonymize')} className="text-destructive">
                  <Eraser aria-hidden />
                  {t(`${R}.anonymize`)}
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {open === 'merge' && <MergeDialog current={summary} onClose={() => setOpen(null)} />}
      {open === 'anonymize' && <AnonymizeDialog client={client} onClose={() => setOpen(null)} />}
    </>
  )
}

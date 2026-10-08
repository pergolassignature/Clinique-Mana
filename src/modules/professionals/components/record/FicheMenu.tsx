import { useRef, useState } from 'react'
import { ChevronDown, Download, FileText, LoaderCircle, Mail } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { preloadFicheRenderer, useDownloadFiche } from '../../hooks/use-fiche'
import { ficheTitles } from '../../lib/fiche'
import { useRecordData } from './record-context'
import { SendFicheDialog } from './SendFicheDialog'

const M = 'modules.professionals.fiche.menu'

/**
 * « Fiche PDF » (design §5.3, Task 4c.5): its own outline button in the record header, not the
 * « … » menu, which holds the status actions only (P4-110, P4-206). « Télécharger » makes the PDF
 * in the browser; with two titles, one item per title (one fiche per title, A2.19), the primary
 * first. « Envoyer par courriel… » opens `SendFicheDialog`, for an active professional only (the
 * function refuses the others: « Seuls les professionnels actifs peuvent être proposés. »). The
 * renderer's chunk starts loading as the menu opens. While a fiche is being made the button shows
 * a spinner and its items wait (`aria-busy`).
 */
export function FicheMenu() {
  const { record, catalog } = useRecordData()
  const download = useDownloadFiche()
  const [sending, setSending] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  // The item only asks; the dialog opens once the menu has closed (its focus handling done).
  const emailAsked = useRef(false)
  const titles = ficheTitles(record, catalog)
  const busy = download.isPending
  const active = record.professional.status === 'active'

  const downloadFor = (titleId: string | null) => {
    if (!busy) download.mutate({ record, catalog, titleId })
  }

  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          if (!open) return
          emailAsked.current = false
          preloadFicheRenderer()
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button ref={trigger} type="button" variant="outline" aria-busy={busy || undefined}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <FileText aria-hidden />}
            {t(`${M}.trigger`)}
            <ChevronDown className="text-subtle" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            if (!emailAsked.current) return
            emailAsked.current = false
            event.preventDefault()
            setSending(true)
          }}
        >
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
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={busy || !active} onSelect={() => (emailAsked.current = true)}>
            <Mail className="text-subtle" aria-hidden />
            {t(`${M}.email`)}
          </DropdownMenuItem>
          {!active && <p className="px-2 pb-1.5 pl-8 text-xs text-muted-foreground">{t(`${M}.emailActiveOnly`)}</p>}
        </DropdownMenuContent>
      </DropdownMenu>
      {sending && (
        <SendFicheDialog
          titles={titles}
          onClose={() => setSending(false)}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            trigger.current?.focus()
          }}
        />
      )}
    </>
  )
}

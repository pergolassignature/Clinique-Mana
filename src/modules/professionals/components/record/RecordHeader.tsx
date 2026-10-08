import type { ReactNode } from 'react'
import { t } from '@/i18n'
import { initialsOf } from '@/shared/lib/format'
import { Avatar, AvatarFallback } from '@/shared/ui/avatar'
import { Badge } from '@/shared/ui/badge'
import type { ProfessionalRecord } from '../../api/parse'
import type { CatalogView } from '../../lib/catalog-view'
import { fullName, languagesLabel, primaryProfession, professionLine, statusLabel, statusTone } from '../../lib/display'

const H = 'modules.professionals.record.header'

interface RecordHeaderProps {
  record: ProfessionalRecord
  catalog: CatalogView
}

/**
 * The record's band (design §5.3): avatar 48 (initials until the photo, 4c), the name (the page's
 * h1) with its status, « Psychologue · OPQ 12345 · courriel », then quiet chips for the languages
 * and « N'accepte pas de nouveaux clients ». The actions (« Activer », the « … » menu) come with
 * activation and deactivation (4a.14).
 */
export function RecordHeader({ record, catalog }: RecordHeaderProps) {
  const { professional, matchingProfile, languageIds } = record
  const name = fullName(professional)
  const line = [professionLine(primaryProfession(record), catalog), professional.email].filter(Boolean).join(' · ')
  const languages = languagesLabel(languageIds, catalog)
  return (
    <header className="flex min-w-0 items-start gap-3">
      <Avatar size="lg" aria-hidden>
        <AvatarFallback className="text-muted-foreground">{initialsOf(name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {/* Focusable (not tabbable), like PageHeader's, so focus can be moved to the page. */}
          <h1 tabIndex={-1} className="min-w-0 break-words text-xl font-semibold tracking-tight text-foreground outline-none">
            {name}
          </h1>
          <Badge variant={statusTone(professional.status)}>{statusLabel(professional.status)}</Badge>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground [overflow-wrap:anywhere]">{line}</p>
        {(languages || !matchingProfile.acceptingNewClients) && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {languages && (
              <Chip>
                <span className="sr-only">{t(`${H}.languages`)} </span>
                {languages}
              </Chip>
            )}
            {!matchingProfile.acceptingNewClients && <Chip>{t(`${H}.notAccepting`)}</Chip>}
          </ul>
        )}
      </div>
    </header>
  )
}

/** A quiet tag: hairline border, secondary 12px text, no fill (design system: no pastel). */
function Chip({ children }: { children: ReactNode }) {
  return (
    <li className="inline-flex h-5 min-w-0 max-w-full items-center rounded-sm border border-border px-1.5 text-xs text-muted-foreground">
      {/* `truncate` on the text, not the flex item: a flex container draws no ellipsis. */}
      <span className="min-w-0 truncate">{children}</span>
    </li>
  )
}

import type { ReactNode, Ref } from 'react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'
import type { Onboarding, ProfessionalRecord } from '../../api/parse'
import type { CatalogView } from '../../lib/catalog-view'
import { fullName, languagesLabel, primaryProfession, professionLine, statusLabel, statusTone } from '../../lib/display'
import { displayStatus } from '../../lib/onboarding'
import { ProfessionalPhotoAvatar } from '../ProfessionalAvatar'
import { Chip, ChipList } from './Chips'

const H = 'modules.professionals.record.header'

interface RecordHeaderProps {
  record: ProfessionalRecord
  /** For the status as staff read it (P4-43: « À réviser » or « En préparation »). */
  onboarding: Onboarding | null
  catalog: CatalogView
  /** The h1, so focus can be moved there (`RecordData.focusHeading`). */
  headingRef?: Ref<HTMLHeadingElement>
  /** The status actions (`RecordActions`), at the right; under the name on a phone. */
  actions?: ReactNode
  /**
   * Once the page has scrolled (the header sticks under the top bar from `md`): the name, the
   * status and the actions only, with a smaller avatar; the top bar's crumb still names the record.
   */
  compact?: boolean
}

/**
 * The record's band (design §5.3): avatar 48 (the newest verified photo, else the initials), the name (the page's
 * h1) with its status, « Travailleuse sociale · OTSTCFQ 12345 · courriel » (the title in the
 * professional's form, P4-342), then quiet chips for the languages
 * and « N'accepte pas de nouveaux clients »; the actions at the right. The identity keeps at least
 * 16rem: below that the actions wrap under it rather than squeezing the name (375 px).
 */
export function RecordHeader({ record, onboarding, catalog, headingRef, actions, compact = false }: RecordHeaderProps) {
  const { professional, matchingProfile, languageIds } = record
  const name = fullName(professional)
  const line = [professionLine(primaryProfession(record), catalog, professional.gender), professional.email].filter(Boolean).join(' · ')
  const languages = languagesLabel(languageIds, catalog)
  const status = displayStatus(professional.status, onboarding)
  return (
    <header className={cn('flex min-w-0 flex-wrap gap-3', compact ? 'items-center' : 'items-start')}>
      <div className={cn('flex min-w-0 flex-1 basis-64 gap-3', compact ? 'items-center' : 'items-start')}>
        <ProfessionalPhotoAvatar name={name} fileId={record.photoFileId} size={compact ? 'md' : 'lg'} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {/* Focusable (not tabbable), like PageHeader's, so focus can be moved to the page. */}
            <h1 ref={headingRef} tabIndex={-1} className="min-w-0 break-words text-xl font-semibold tracking-tight text-foreground outline-none">
              {name}
            </h1>
            <Badge variant={statusTone(status)}>{statusLabel(status)}</Badge>
          </div>
          {!compact && <p className="mt-0.5 text-sm text-muted-foreground [overflow-wrap:anywhere]">{line}</p>}
          {!compact && (languages || !matchingProfile.acceptingNewClients) && (
            <ChipList className="mt-2">
              {languages && (
                <Chip>
                  <span className="sr-only">{t(`${H}.languages`)} </span>
                  {languages}
                </Chip>
              )}
              {!matchingProfile.acceptingNewClients && <Chip>{t(`${H}.notAccepting`)}</Chip>}
            </ChipList>
          )}
        </div>
      </div>
      {actions}
    </header>
  )
}

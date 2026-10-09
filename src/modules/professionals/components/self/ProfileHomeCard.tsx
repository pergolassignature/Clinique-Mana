import { useId } from 'react'
import { Link } from 'react-router-dom'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { useMySubmission } from '../../hooks/use-my-submission'
import { listLabel } from '../../lib/display'
import { QUESTIONNAIRE_PATH } from '../../lib/my-profile'
import { sectionLabel } from '../../lib/onboarding'

const H = 'modules.professionals.myProfile.home'

/**
 * Accueil « Complétez votre profil » (P4-319, Task 4b.5): while the professional has a questionnaire
 * to fill in, one card that says which (the onboarding, an update and its sections, asked by the
 * clinic or started by her, or a profile the clinic sent back) and leads to it. Nothing otherwise: nothing open, the profile sent, no file
 * linked to the account (an admin), or the read failing (the questionnaire still says it).
 */
export function ProfileHomeCard() {
  const headingId = useId()
  const { data } = useMySubmission()
  if (!data || data.status !== 'draft') return null
  // A sent-back profile first; an update says who chose its sections (the clinic, or she, P4-375).
  const key = data.decisionNote ? 'returned' : data.kind === 'update' && data.startedByMe ? 'self' : data.kind
  const body =
    key === 'update' || key === 'self'
      ? t(`${H}.${key}.body`, { sections: listLabel(data.requestedSections.map(sectionLabel)) })
      : t(`${H}.${key}.body`)
  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-border bg-card p-4">
      <h2 id={headingId} className="text-base font-semibold text-foreground">
        {t(`${H}.${key}.title`)}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      <Button asChild size="sm" className="mt-3">
        <Link to={QUESTIONNAIRE_PATH}>{t(`${H}.${key}.action`)}</Link>
      </Button>
    </section>
  )
}

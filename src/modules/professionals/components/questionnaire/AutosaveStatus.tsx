import { CircleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { formatClinicDateTime, formatClinicTime, isClinicToday } from '@/shared/lib/timezone'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import type { AutosaveState } from '../../hooks/use-my-submission'

const S = 'modules.professionals.questionnaire.autosave'

/**
 * « Enregistrement… »; « Des modifications ne sont pas enregistrées. » while a save failed or was
 * refused (the banner or the page's alert says which and why); else « Enregistré à 14:32 » (today,
 * clinic time), « Enregistré le 7 oct. 2026 à 9:05 », or nothing yet.
 */
function autosaveText(state: AutosaveState): string {
  if (state.saving) return t(`${S}.saving`)
  if (state.failed || Object.keys(state.refused).length > 0) return t(`${S}.unsaved`)
  if (!state.savedAt) return ''
  return isClinicToday(state.savedAt) ? t(`${S}.savedAt`, { time: formatClinicTime(state.savedAt) }) : t(`${S}.savedOn`, { date: formatClinicDateTime(state.savedAt) })
}

interface AutosaveStatusProps {
  state: AutosaveState
  onRetry: () => void
  /** The step saves only on « Continuer » (private data, the signature): says so instead. */
  savesOnContinue?: boolean
}

/**
 * The autosave's state, politely announced (« Enregistrer le brouillon » sits with the step's
 * buttons); a save failed in transit shows the banner « Vos dernières modifications n'ont pas été
 * enregistrées… » with « Réessayer » until a save succeeds (4b.4).
 */
export function AutosaveStatus({ state, onRetry, savesOnContinue = false }: AutosaveStatusProps) {
  return (
    <div className="space-y-2">
      <p role="status" className="min-h-5 text-xs text-muted-foreground">
        {savesOnContinue ? t(`${S}.onContinue`) : autosaveText(state)}
      </p>
      {state.failed && (
        <Alert variant="destructive" role="alert">
          <CircleAlert aria-hidden />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-foreground">
            <span>{t(`${S}.failed`)}</span>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              {t(`${S}.retry`)}
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

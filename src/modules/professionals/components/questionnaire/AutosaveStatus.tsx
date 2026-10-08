import { CircleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { formatClinicDateTime, formatClinicTime, isClinicToday } from '@/shared/lib/timezone'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import type { AutosaveState } from '../../hooks/use-my-submission'

const S = 'modules.professionals.questionnaire.autosave'

/** « Enregistrement… », « Enregistré à 14:32 » (today, clinic time), « Enregistré le 7 oct. 2026 à 9:05 », or nothing yet. */
function autosaveText(state: AutosaveState): string {
  if (state.saving) return t(`${S}.saving`)
  if (!state.savedAt) return ''
  return isClinicToday(state.savedAt) ? t(`${S}.savedAt`, { time: formatClinicTime(state.savedAt) }) : t(`${S}.savedOn`, { date: formatClinicDateTime(state.savedAt) })
}

interface AutosaveStatusProps {
  state: AutosaveState
  /** « Enregistrer le brouillon »: sends what is pending now. */
  onSaveNow: () => void
  onRetry: () => void
  /** The step saves only on « Continuer » (private data, the signature): says so instead of the draft button. */
  savesOnContinue?: boolean
}

/**
 * The autosave's state, politely announced, with « Enregistrer le brouillon »; a failed save shows
 * the banner « Vos dernières modifications n'ont pas été enregistrées… » with « Réessayer » until a
 * save succeeds (4b.4).
 */
export function AutosaveStatus({ state, onSaveNow, onRetry, savesOnContinue = false }: AutosaveStatusProps) {
  return (
    <div className="space-y-2">
      <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1">
        <p role="status" className="text-xs text-muted-foreground">
          {savesOnContinue ? t(`${S}.onContinue`) : autosaveText(state)}
        </p>
        {!savesOnContinue && (
          <Button type="button" variant="ghost" size="sm" className="-ml-2 h-7 px-2 text-xs" onClick={onSaveNow}>
            {t(`${S}.saveDraft`)}
          </Button>
        )}
      </div>
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

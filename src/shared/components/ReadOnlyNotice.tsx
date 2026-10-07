import { Lock } from 'lucide-react'
import { t } from '@/i18n'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'

/**
 * « Lecture seule — Seule l'administration peut modifier ces informations. » (design system,
 * Paramètres). Shown at the top of a section the user can see but not change. Static: no live role.
 */
export function ReadOnlyNotice({ className }: { className?: string }) {
  return (
    <Alert className={className}>
      <Lock aria-hidden />
      <AlertTitle>{t('settings.readOnly.title')}</AlertTitle>
      <AlertDescription>{t('settings.readOnly.body')}</AlertDescription>
    </Alert>
  )
}

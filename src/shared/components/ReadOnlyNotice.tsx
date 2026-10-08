import { Lock } from 'lucide-react'
import { t } from '@/i18n'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'

interface ReadOnlyNoticeProps {
  /** Who can change it, when not the administration (default « Seule l'administration peut modifier ces informations. »). */
  body?: string
  className?: string
}

/**
 * « Lecture seule » notice (design system, Paramètres): shown once, at the top of a page the user
 * can see but not change. Static: no live role.
 */
export function ReadOnlyNotice({ body = t('common.readOnlyNotice.body'), className }: ReadOnlyNoticeProps) {
  return (
    <Alert className={className}>
      <Lock aria-hidden />
      <AlertTitle>{t('common.readOnlyNotice.title')}</AlertTitle>
      <AlertDescription>{body}</AlertDescription>
    </Alert>
  )
}

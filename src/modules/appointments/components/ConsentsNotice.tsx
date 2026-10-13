import { FileWarning } from 'lucide-react'
import { t } from '@/i18n'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import type { RequiredConsent } from '../api/changes'

const C = 'modules.appointments.editor.consents'

/**
 * The consents a booking or an appointment still needs (AP-32): every one not signed, by name and
 * in plain words (« manquant », « envoyé, pas encore signé », « à signer de nouveau »), per client
 * when there are two. Never blocks (R-47); nothing when all are in force or none is required.
 */
export function ConsentsNotice({ consents, clientName, failed = false }: { consents: RequiredConsent[] | undefined; clientName?: (clientId: string) => string; failed?: boolean }) {
  if (failed) {
    return <p className="text-sm text-muted-foreground">{t(`${C}.loadError`)}</p>
  }
  const open = (consents ?? []).filter((c) => c.state !== 'signed')
  if (open.length === 0) return null
  const several = new Set(open.map((c) => c.clientId)).size > 1
  return (
    <Alert variant="warning">
      <FileWarning aria-hidden />
      <AlertDescription className="space-y-1 text-foreground">
        <p className="font-medium">{t(`${C}.title`)}</p>
        <ul className="space-y-0.5 text-sm">
          {open.map((c) => {
            const state = t(`${C}.state.${c.state as 'missing' | 'pending' | 'resign'}`)
            return (
              <li key={`${c.clientId}:${c.consentKey}`}>
                {several && clientName
                  ? t(`${C}.lineFor`, { client: clientName(c.clientId), name: c.consentName, state })
                  : t(`${C}.line`, { name: c.consentName, state })}
              </li>
            )
          })}
        </ul>
        <p className="text-sm text-muted-foreground">{t(`${C}.help`)}</p>
      </AlertDescription>
    </Alert>
  )
}

import { useRef, useState } from 'react'
import { ClipboardList } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { useProfessionalContract } from '../../hooks/use-contracts'
import { useProfessionalSubmissions } from '../../hooks/use-submissions'
import { sectionsStillToAsk } from '../../lib/questionnaire'
import { useRecordData } from './record-context'
import { RequestUpdateDialog } from './RequestUpdateDialog'

const R = 'modules.professionals.onboarding.restOfProfile'
const Q = 'modules.professionals.questionnaire'

/**
 * « Demander le reste du profil » (P4-565, « L'entente d'abord »): once the entente is in force and
 * nothing is open, the sections no questionnaire has asked yet, named, and one button that opens
 * « Demander une mise à jour » with them ticked — the same update request and email as ever.
 * Nothing for a file onboarded with the whole questionnaire, nor without an account, nor for
 * whoever may not send invitations.
 */
export function RestOfProfileCard() {
  const { record } = useRecordData()
  const { can } = useAccess()
  const { professional } = record
  const allowed = can('professionals.invite') && professional.profileId !== null
  const contract = useProfessionalContract(professional.id, allowed)
  const submissions = useProfessionalSubmissions(allowed ? professional.id : '')
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  if (!allowed || !contract.data || !submissions.data) return null
  const rest = sectionsStillToAsk(submissions.data, contract.data.current !== null)
  if (!rest) return null

  return (
    <>
      <Alert>
        <ClipboardList aria-hidden />
        <AlertTitle>{t(`${R}.title`)}</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>{t(`${R}.body`, { firstName: professional.firstName, sections: rest.map((s) => t(`${Q}.steps.${s}.title`)).join(', ') })}</p>
          <Button ref={button} size="sm" onClick={() => setOpen(true)}>
            {t(`${R}.action`)}
          </Button>
        </AlertDescription>
      </Alert>
      {open && (
        <RequestUpdateDialog
          initial={rest}
          onClose={() => setOpen(false)}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            button.current?.focus()
          }}
        />
      )}
    </>
  )
}

import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { Loading, LoadError } from '@/shared/components/LoadState'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { useProfessionalImageConsent } from '../../hooks/use-contracts'
import { SigningBody } from './ContractCard'
import { useRecordData } from './record-context'

const I = 'modules.professionals.imageConsent'

/**
 * « Consentement droit à l'image » sent through Documenso (P4-481 – P4-486), inside that type's
 * required-document card on the Documents tab: the latest request's state in words (« Envoyé le … »,
 * « Signé le … »), its signer, and « Envoyer pour signature », « Renvoyer le courriel »,
 * « Régénérer », « Synchroniser », « Envoyer un nouveau consentement » for whoever manages the
 * file (`professionals.manage`). Once signed, the PDF is a verified document of the card (core's
 * capture stores it, the database files it), so readiness, « Mes documents » and the list agree.
 * `standalone`: its own card, when the clinic made the type optional (it then sits under « Autres
 * documents »).
 */
export function ImageConsentSigning({ standalone = false }: { standalone?: boolean }) {
  const { record } = useRecordData()
  const consent = useProfessionalImageConsent(record.professional.id)
  const body = consent.isPending ? (
    <Loading />
  ) : consent.data === undefined ? (
    <LoadError
      message={moduleErrorMessage(consent.error, t(`${I}.loadError`), 'professionals')}
      retrying={consent.isFetching}
      onRetry={() => void consent.refetch()}
    />
  ) : consent.data === null ? null : (
    <SigningBody form="image_consent" contract={consent.data} />
  )
  if (standalone) {
    return (
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>{t(`${I}.standaloneTitle`)}</CardTitle>
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>
    )
  }
  return (
    <div className="mt-3 border-t border-border-light pt-3">
      <p className="mb-2 text-xs font-medium text-foreground">{t(`${I}.heading`)}</p>
      {body}
    </div>
  )
}

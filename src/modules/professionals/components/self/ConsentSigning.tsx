import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CircleCheck } from 'lucide-react'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { Loading, LoadError } from '@/shared/components/LoadState'
import { softDisabledClasses } from '@/shared/components/soft-disabled'
import { Button } from '@/shared/ui/button'
import type { SigningReturn } from '../../api/consent-sign'
import { useConsentSigning, useMyImageConsent } from '../../hooks/use-consent-sign'
import { RefusalAlert } from '../compensation/DatedRowParts'
import { consentInForceText, SIGNED_PARAM } from '../../lib/consent-sign'
import { EmbeddedSigning } from './EmbeddedSigning'

const S = 'modules.professionals.consentSign'
/**
 * The professional's image consent, filled in and signed in the app (P4-487 – P4-489): the
 * questionnaire's « Consentement » step (`variant="step"`) and « Mes documents »' card
 * (`variant="documents"`). In force → « Signé le … · valide jusqu'au … »; the form not published →
 * the clinic sends it later (never a block); otherwise a short summary and « Signer le
 * consentement » (« Remplir et signer », « Renouveler : remplir et signer » once expired), which
 * opens Documenso's page inside this one (`EmbeddedSigning`, with its fallback). Back from the full
 * signing page (`?consentement=signe`), the signature is synced at once.
 */
export function ConsentSigning({ back, variant }: { back: SigningReturn; variant: 'step' | 'documents' }) {
  const consent = useMyImageConsent()
  const signing = useConsentSigning(back)
  const [params, setParams] = useSearchParams()
  const returned = useRef(false)
  const { completed } = signing

  // Back from Documenso's page: sync once, then drop the marker (a reload never syncs again).
  useEffect(() => {
    if (returned.current || params.get(SIGNED_PARAM) !== 'signe') return
    returned.current = true
    completed()
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev)
        out.delete(SIGNED_PARAM)
        return out
      },
      { replace: true },
    )
  }, [params, setParams, completed])

  if (consent.isPending) return <Loading />
  if (consent.data === undefined) {
    return (
      <LoadError
        message={moduleErrorMessage(consent.error, t(`${S}.loadError`), 'professionals')}
        retrying={consent.isFetching}
        onRetry={() => void consent.refetch()}
      />
    )
  }
  if (consent.data === null) return null
  const data = consent.data
  const inForce = consentInForceText(data)

  if (signing.checking) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t(`${S}.checking`)}
      </p>
    )
  }
  if (inForce) {
    return (
      <p role="status" className="flex items-start gap-2 text-sm text-foreground">
        <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
        <span>{inForce}</span>
      </p>
    )
  }
  if (!data.available) {
    return <p className="text-sm text-muted-foreground">{t(variant === 'step' ? `${S}.notPublished` : `${S}.notPublishedDocuments`)}</p>
  }
  if (signing.link) {
    return <EmbeddedSigning link={signing.link} onCompleted={signing.completed} onClose={signing.close} />
  }
  const renew = data.request?.status === 'signed'
  const label = variant === 'step' ? t(`${S}.sign`) : renew ? t(`${S}.renew`) : t(`${S}.fill`)
  return (
    <div className="space-y-3">
      {variant === 'step' && <p className="text-sm text-foreground">{t(`${S}.summary`)}</p>}
      {signing.error && (
        <div className="space-y-2">
          <RefusalAlert message={signing.error} />
        </div>
      )}
      <Button
        type="button"
        size={variant === 'step' ? 'default' : 'sm'}
        aria-disabled={signing.opening || undefined}
        className={softDisabledClasses}
        onClick={() => {
          if (!signing.opening) void signing.open()
        }}
      >
        {signing.opening ? t(`${S}.opening`) : signing.error ? t(`${S}.retry`) : label}
      </Button>
    </div>
  )
}

/** « Révision »'s line for the consent: in force (with its dates), to sign later, or not signed yet. */
export function MyConsentSummary() {
  const consent = useMyImageConsent()
  if (consent.isPending) return <Loading />
  const data = consent.data
  const text = !data ? null : (consentInForceText(data) ?? (data.available ? t(`${S}.notSignedYet`) : t(`${S}.notPublishedShort`)))
  return text ? <p className="text-sm text-foreground">{text}</p> : null
}

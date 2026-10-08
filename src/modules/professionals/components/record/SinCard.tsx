import { useRef, useState } from 'react'
import { t } from '@/i18n'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { Button } from '@/shared/ui/button'
import type { ProfessionalPrivate } from '../../api/private'
import { useClearPrivateField, useRevealedPrivateValue, type Refusal } from '../../hooks/use-private'
import { ConfirmDeleteDialog, RefusalAlert } from '../compensation/DatedRowParts'
import { RevealedValue } from './RevealedValue'
import { SinDialog } from './SinDialog'

const N = 'modules.professionals.record.compensation.sin'

interface SinCardProps {
  professionalId: string
  data: ProfessionalPrivate
  /** The clinic collects SINs (`collect_sin`, P4-7): without it, no entry is offered. */
  collect: boolean
}

/**
 * « Numéro d'assurance sociale (NAS) » (`professionals.private`): « •••286 » with « Afficher »
 * (audited; shown 60 s at most, component state only), « Saisir le NAS » or « Remplacer » while the
 * clinic collects SINs, and « Retirer » (confirmed) whenever one is stored, collection on or off
 * (Loi 25: removal stays possible). Collection off and nothing stored: « Non recueilli ». A new
 * `updated_at` (any private save or removal, here or elsewhere) masks a revealed SIN again
 * (`useRevealedPrivateValue`), so it never outlives the row it was read from.
 */
export function SinCard({ professionalId, data, collect }: SinCardProps) {
  const revealed = useRevealedPrivateValue(professionalId, 'sin', data.updatedAt)
  const [confirming, setConfirming] = useState(false)
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const clear = useClearPrivateField(professionalId, 'sin', setRefusal)
  const removeButton = useRef<HTMLButtonElement | null>(null)
  const entryButton = useRef<HTMLButtonElement>(null)
  // After « Retirer » with collection off, no button is left in the card: focus goes to its title.
  const heading = useRef<HTMLHeadingElement>(null)
  const stored = data.sinLast3 !== null
  const shownRefusal = refusal ?? revealed.refusal

  let value
  if (stored) {
    value = (
      <RevealedValue
        masked={`•••${data.sinLast3}`}
        maskedLabel={t(`${N}.masked`, { last3: data.sinLast3 ?? '' })}
        value={revealed.value}
        pending={revealed.pending}
        onReveal={() => {
          setRefusal(null)
          void revealed.reveal()
        }}
        onHide={revealed.hide}
        labels={{
          show: t(`${N}.show`),
          showLabel: t(`${N}.showLabel`),
          revealing: t(`${N}.revealing`),
          revealingLabel: t(`${N}.revealingLabel`),
          hide: t(`${N}.hide`),
          hideLabel: t(`${N}.hideLabel`),
        }}
      />
    )
  } else if (collect) {
    value = <span className="text-muted-foreground">{t(`${N}.none`)}</span>
  } else {
    value = (
      <>
        <span>{t(`${N}.notCollected`)}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{t(`${N}.notCollectedHelp`)}</span>
      </>
    )
  }

  const actions = (collect || stored) && (
    <>
      {stored && (
        <Button
          ref={removeButton}
          type="button"
          variant="outline"
          aria-label={t(`${N}.removeLabel`)}
          onClick={() => {
            setRefusal(null)
            setConfirming(true)
          }}
        >
          {t(`${N}.remove`)}
        </Button>
      )}
      {collect && <SinDialog ref={entryButton} professionalId={professionalId} replacing={stored} updatedAt={data.updatedAt} />}
    </>
  )

  return (
    <SettingsCard as="section" title={t(`${N}.title`)} footer={actions || undefined} headingRef={heading}>
      <dl>
        <dt className="text-xs text-muted-foreground">{t(`${N}.label`)}</dt>
        <dd className="mt-0.5 text-sm text-foreground">{value}</dd>
      </dl>
      {stored && !collect && <p className="text-xs text-muted-foreground">{t(`${N}.collectionOff`)}</p>}
      {!confirming && shownRefusal && <RefusalAlert message={shownRefusal.message} detail={shownRefusal.detail} />}
      <ConfirmDeleteDialog
        open={confirming}
        title={t(`${N}.removeTitle`)}
        body={t(collect ? `${N}.removeBody` : `${N}.removeBodyOff`, { last3: data.sinLast3 ?? '' })}
        pending={clear.isPending}
        refusal={confirming && refusal ? refusal.message : null}
        refusalDetail={refusal?.detail}
        onConfirm={() => {
          setRefusal(null)
          clear.mutate(undefined, { onSuccess: () => setConfirming(false) })
        }}
        onOpenChange={(next) => {
          if (next) return
          clear.reset()
          setConfirming(false)
          setRefusal(null)
        }}
        triggerRef={removeButton}
        fallbackRef={collect ? entryButton : heading}
        confirmLabel={t(`${N}.remove`)}
        pendingLabel={t(`${N}.removing`)}
      />
    </SettingsCard>
  )
}

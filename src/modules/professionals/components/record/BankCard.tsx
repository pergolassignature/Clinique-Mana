import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/EmptyState'
import { FormActions } from '@/shared/components/FormActions'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { SENSITIVE_INPUT_PROPS } from '@/shared/lib/sensitive-input'
import { useSettingsForm } from '@/shared/lib/use-settings-form'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import type { ProfessionalPrivate } from '../../api/private'
import { professionalKeys } from '../../hooks/keys'
import { useClearPrivateField, useExpectedVersion, useRevealedPrivateValue, useSaveBank, type Refusal } from '../../hooks/use-private'
import { bankSchema, toBankFormValues } from '../../schemas/private'
import { ConfirmDeleteDialog, RefusalAlert } from '../compensation/DatedRowParts'
import { RevealedValue } from './RevealedValue'

const B = 'modules.professionals.record.compensation.bank'
const P2 = 'settings.bank'

interface BankCardProps {
  professionalId: string
  data: ProfessionalPrivate
}

/**
 * « Banque » (`professionals.private`), as Phase 2's « Coordonnées bancaires »: the institution,
 * the transit and the account « ••••4567 » with an audited « Afficher »; « Modifier » swaps in the
 * form (the account never prefilled: empty keeps it, « Inchangé »), saved alone with
 * `set_professional_bank` (P4-148); « Retirer le numéro de compte » (confirmed) removes the account
 * only. Closing the form returns focus to the button that opened it.
 */
export function BankCard({ professionalId, data }: BankCardProps) {
  const [editing, setEditing] = useState(false)
  const actionRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)

  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false
      actionRef.current?.focus()
    }
  }, [editing])

  const close = () => {
    returnFocus.current = true
    setEditing(false)
  }
  if (editing) return <BankForm professionalId={professionalId} data={data} onClose={close} />
  return <BankDisplay professionalId={professionalId} data={data} onEdit={() => setEditing(true)} actionRef={actionRef} />
}

function Item({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{children}</dd>
    </div>
  )
}

interface BankDisplayProps extends BankCardProps {
  onEdit: () => void
  actionRef: RefObject<HTMLButtonElement | null>
}

function BankDisplay({ professionalId, data, onEdit, actionRef }: BankDisplayProps) {
  const revealed = useRevealedPrivateValue(professionalId, 'bank_account', data.updatedAt)
  const [confirming, setConfirming] = useState(false)
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const clear = useClearPrivateField(professionalId, 'bank_account', setRefusal)
  const removeButton = useRef<HTMLButtonElement | null>(null)
  const hasAccount = data.bankAccountLast4 !== null
  const empty = !hasAccount && data.bankInstitution === null && data.bankTransit === null
  const shownRefusal = refusal ?? revealed.refusal

  if (empty) {
    return (
      <SettingsCard as="section" title={t(`${B}.title`)} description={t(`${B}.description`)}>
        <EmptyState
          title={t(`${B}.empty.title`)}
          body={t(`${B}.empty.body`)}
          action={
            <Button ref={actionRef} type="button" variant="outline" onClick={onEdit}>
              <Plus aria-hidden />
              {t(`${B}.empty.add`)}
            </Button>
          }
        />
      </SettingsCard>
    )
  }

  return (
    <SettingsCard
      as="section"
      title={t(`${B}.title`)}
      description={t(`${B}.description`)}
      footer={
        <>
          {hasAccount && (
            <Button
              ref={removeButton}
              type="button"
              variant="outline"
              onClick={() => {
                setRefusal(null)
                setConfirming(true)
              }}
            >
              {t(`${B}.removeAccount`)}
            </Button>
          )}
          <Button ref={actionRef} type="button" variant="outline" aria-label={t(`${P2}.display.editLabel`)} onClick={onEdit}>
            <Pencil aria-hidden />
            {t(`${P2}.display.edit`)}
          </Button>
        </>
      }
    >
      <dl className="grid gap-3 sm:grid-cols-3">
        <Item term={t(`${P2}.display.institution`)}>
          <span className="tabular">{data.bankInstitution ?? '—'}</span>
        </Item>
        <Item term={t(`${P2}.display.transit`)}>
          <span className="tabular">{data.bankTransit ?? '—'}</span>
        </Item>
        <Item term={t(`${P2}.display.account`)}>
          {hasAccount ? (
            <RevealedValue
              masked={`••••${data.bankAccountLast4}`}
              maskedLabel={t(`${P2}.display.masked`, { last4: data.bankAccountLast4 ?? '' })}
              value={revealed.value}
              pending={revealed.pending}
              onReveal={() => {
                setRefusal(null)
                void revealed.reveal()
              }}
              onHide={revealed.hide}
              labels={{
                show: t(`${P2}.display.show`),
                showLabel: t(`${P2}.display.showLabel`),
                revealing: t(`${P2}.display.revealing`),
                revealingLabel: t(`${P2}.display.revealingLabel`),
                hide: t(`${P2}.display.hide`),
                hideLabel: t(`${P2}.display.hideLabel`),
              }}
            />
          ) : (
            <span className="text-muted-foreground">{t(`${B}.noAccount`)}</span>
          )}
        </Item>
      </dl>
      {!confirming && shownRefusal && <RefusalAlert message={shownRefusal.message} detail={shownRefusal.detail} />}
      <ConfirmDeleteDialog
        open={confirming}
        title={t(`${B}.removeTitle`)}
        body={t(`${B}.removeBody`, { last4: data.bankAccountLast4 ?? '' })}
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
        fallbackRef={actionRef}
        confirmLabel={t('modules.professionals.record.compensation.sin.remove')}
        pendingLabel={t(`${B}.removing`)}
      />
    </SettingsCard>
  )
}

function BankForm({ professionalId, data, onClose }: BankCardProps & { onClose: () => void }) {
  const queryClient = useQueryClient()
  const values = useMemo(() => toBankFormValues(data), [data])
  const { form, handleSave } = useSettingsForm({ schema: bankSchema, values })
  const { isDirty, errors } = form.formState
  // The version the form opened on (a clean form follows the masks, a dirty one keeps it).
  const version = useExpectedVersion(data.updatedAt, isDirty)
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const save = useSaveBank(professionalId, (next) => {
    if (next.stale) version.acceptLatest(next.refetched)
    setRefusal(next)
  })
  useUnsavedChanges(isDirty)
  const hasAccount = data.bankAccountLast4 !== null

  useEffect(() => form.setFocus('institution'), [form])

  const onSubmit = handleSave((input, onSaved) => {
    setRefusal(null)
    save.mutate(
      { input, expectedUpdatedAt: version.expected() },
      {
        onSuccess: (savedAt) => {
          version.saved(savedAt)
          const fresh = queryClient.getQueryData<ProfessionalPrivate>(professionalKeys.private(professionalId)) ?? data
          onSaved(toBankFormValues(fresh))
          onClose()
        },
      },
    )
  })

  return (
    <SettingsCard
      title={t(`${B}.title`)}
      description={t(`${B}.description`)}
      pending={save.isPending}
      onSubmit={(event) => void onSubmit(event)}
      footer={<FormActions onCancel={onClose} dirty={isDirty} pending={save.isPending} cancelCloses />}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t(`${P2}.fields.institution`)} help={t(`${P2}.fields.institutionHelp`)} error={errors.institution?.message}>
          {(field) => <Input {...field} {...form.register('institution')} inputMode="numeric" autoComplete="off" />}
        </FormField>
        <FormField label={t(`${P2}.fields.transit`)} help={t(`${P2}.fields.transitHelp`)} error={errors.transit?.message}>
          {(field) => <Input {...field} {...form.register('transit')} inputMode="numeric" autoComplete="off" />}
        </FormField>
        <FormField
          label={t(`${P2}.fields.account`)}
          help={hasAccount ? t(`${P2}.fields.accountKeepHelp`, { last4: data.bankAccountLast4 ?? '' }) : t(`${P2}.fields.accountHelp`)}
          error={errors.account?.message}
        >
          {(field) => (
            <Input
              {...field}
              {...form.register('account')}
              inputMode="numeric"
              // Password managers ignore autocomplete="off": their own attributes keep them away too.
              {...SENSITIVE_INPUT_PROPS}
              placeholder={hasAccount ? t(`${P2}.fields.accountUnchanged`) : undefined}
            />
          )}
        </FormField>
      </div>
      {refusal && <RefusalAlert message={refusal.message} detail={refusal.detail} />}
    </SettingsCard>
  )
}

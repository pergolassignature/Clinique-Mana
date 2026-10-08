import { useMemo, useRef } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import type { z } from 'zod'
import { t } from '@/i18n'
import { rpcErrorHint } from '@/core/modules/errors'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Select } from '@/shared/ui/select'
import { Textarea } from '@/shared/ui/textarea'
import { professionalCatalogKeys, professionalKeys } from '../../hooks/keys'
import { useDeactivateProfessional } from '../../hooks/use-professional-mutations'
import { fullName } from '../../lib/display'
import { isLiveInvitation } from '../../lib/onboarding'
import { deactivateSchema, type DeactivateValues } from '../../schemas/status'
import { useRecordData } from './record-context'
import { useSettled, type StatusDialogProps } from './status-dialog'
import { DialogCancel, DialogRefusal } from './StatusDialogParts'

const D = 'modules.professionals.record.deactivate'

type DeactivateOutput = z.output<ReturnType<typeof deactivateSchema>>

/**
 * « Désactiver » (4a.14, design §5.3): a reason among the clinic's active ones, a note when that
 * reason asks for one, and the warning that the professional can no longer sign in when the reason
 * disables the account they have (P4-11), and, once invited, that the invitation link stops working
 * and the questionnaire in progress is closed (4b.1, P4-301). Choosing a reason changes the draft only: no form, only
 * « Désactiver » acts (decision #36), destructive here and nowhere else. Refusals by HINT: `reason`
 * (archived meanwhile) and `note` (now required) under their field with the catalogue refetched;
 * anything else (`status`: already inactive) above the buttons, with the record refetched.
 */
export function DeactivateDialog({ onClose, onCloseAutoFocus }: StatusDialogProps) {
  const { record: current, catalog, onboarding } = useRecordData()
  const queryClient = useQueryClient()
  const reasonSelect = useRef<HTMLSelectElement | null>(null)
  const reasons = useMemo(() => catalog.deactivationReasons.filter((r) => r.isActive), [catalog])
  const schema = useMemo(() => deactivateSchema(reasons), [reasons])
  const form = useForm<DeactivateValues, unknown, DeactivateOutput>({ resolver: zodResolver(schema), defaultValues: { reasonId: '', note: '' } })
  // Runs when the call fails, from the latest render's closure (React Query hands a pending
  // mutation the latest options): `professional`, declared below because it follows `saving`, is
  // then the one confirmed (`useSettled` holds it while saving).
  const mutation = useDeactivateProfessional({
    onErrorMessage: (message, error) => {
      const hint = rpcErrorHint(error)
      if (hint === 'reason' || hint === 'note') {
        // The list changed since it loaded: an archived reason leaves the choices, a note became required.
        if (hint === 'reason') form.setValue('reasonId', '')
        form.setError(hint === 'reason' ? 'reasonId' : 'note', { message }, { shouldFocus: true })
        void queryClient.invalidateQueries({ queryKey: professionalCatalogKeys.catalog() })
        return
      }
      form.setError('root.server', { message })
      void queryClient.invalidateQueries({ queryKey: professionalKeys.record(professional.id) })
    },
  })
  const saving = mutation.isPending
  const { professional } = useSettled(current, saving)
  const reasonId = useWatch({ control: form.control, name: 'reasonId' })
  const reason = catalog.byId.deactivationReasons.get(reasonId)
  const accountOff = Boolean(reason?.disablesAccount && professional.profileId)
  const done = professional.status === 'inactive'
  // What the deactivation also ends (4b.1 SQL): the invitation link and the questionnaire in progress (P4-301).
  const linkStops = professional.profileId === null && isLiveInvitation(onboarding?.invitation)
  const questionnaireCloses = Boolean(onboarding?.submission)
  const { errors } = form.formState
  const { ref: registerReason, ...reasonField } = form.register('reasonId')

  const confirm = () => {
    form.clearErrors('root')
    void form.handleSubmit(({ reasonId, note }) => mutation.mutate({ id: professional.id, reasonId, note }, { onSuccess: onClose }))()
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <AlertDialogContent
        aria-busy={saving || undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          reasonSelect.current?.focus()
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`${D}.title`, { name: fullName(professional) })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(`${D}.body`, { firstName: professional.firstName })}
            {!done && linkStops && ` ${t(`${D}.invitationStops`, { email: professional.email })}`}
            {!done && questionnaireCloses && ` ${t(`${D}.questionnaireCloses`)}`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {/* Inert while saving (what is being saved stays what shows), and once only « Fermer » is left. */}
        <fieldset disabled={saving || done} className="contents">
          <div>
            <FormField label={t(`${D}.reason`)} required error={errors.reasonId?.message}>
              {(control) => (
                <Select
                  {...control}
                  {...reasonField}
                  ref={(element) => {
                    registerReason(element)
                    reasonSelect.current = element
                  }}
                  placeholder={t(`${D}.reasonPlaceholder`)}
                >
                  {reasons.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            {/* Polite: choosing « Fin de collaboration » says what it does to the account. */}
            <div aria-live="polite">
              {accountOff && (
                <Alert variant="warning" className="mt-2">
                  <TriangleAlert aria-hidden />
                  <AlertDescription className="text-foreground">{t(`${D}.accountOff`, { firstName: professional.firstName })}</AlertDescription>
                </Alert>
              )}
            </div>
          </div>
          <FormField label={t(`${D}.note`)} required={reason?.requiresNote ?? false} error={errors.note?.message}>
            {(control) => <Textarea {...control} {...form.register('note')} rows={3} className="min-h-0" />}
          </FormField>
        </fieldset>
        <DialogRefusal message={errors.root?.server?.message} />
        <AlertDialogFooter>
          <DialogCancel saving={saving} nothingToConfirm={done} />
          {!done && (
            <Button
              type="button"
              variant="destructive"
              aria-disabled={saving || undefined}
              onClick={ignoreWhenInactive(saving, confirm)}
              className={cn(softDisabledClasses, 'aria-disabled:hover:bg-destructive')}
            >
              {t(saving ? `${D}.pending` : `${D}.confirm`)}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

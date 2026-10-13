import { useState, type FormEvent } from 'react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Select } from '@/shared/ui/select'
import { toast } from '@/shared/ui/sonner'
import { useSetDemandeState } from '../../hooks/use-demandes'
import { useWaitlistLists } from '../../hooks/use-waitlist'
import { demandesError } from '../../lib/errors'

const J = 'modules.demandes.record.match'

/**
 * « Jumelée » by hand (D-38): the counselor names the professional (any active one of the clinic,
 * the list `set_demande_state` accepts) for a person booked by phone. The match links the request's
 * files to her and makes her the primary professional of those that have none (D-41); a pending
 * proposal is withdrawn and the waiting list closes. Opened from the state control (« Passer à
 * Jumelée ») and from a row of « Jumelage » (her preset).
 */
export function MatchDialog({
  demandeId,
  professionalId,
  open,
  onOpenChange,
}: {
  demandeId: string
  professionalId?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <MatchForm demandeId={demandeId} initial={professionalId ?? ''} onDone={() => onOpenChange(false)} />}
    </Dialog>
  )
}

function MatchForm({ demandeId, initial, onDone }: { demandeId: string; initial: string; onDone: () => void }) {
  const lists = useWaitlistLists()
  const setState = useSetDemandeState(demandeId)
  const [professionalId, setProfessionalId] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const professionals = (lists.data ?? []).filter((l) => l.target_kind === 'professional').sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  // Preset from « Jumelage »: kept even before the list arrives.
  const known = professionals.some((p) => p.target_id === professionalId)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (setState.isPending) return
    if (!professionalId) {
      setError(t(`${J}.needed`))
      return
    }
    setError(null)
    const name = professionals.find((p) => p.target_id === professionalId)?.name ?? ''
    setState.mutate(
      { state: 'matched', closedReason: null, professionalId },
      {
        onSuccess: () => {
          toast.success(name ? t(`${J}.done`, { name }) : t('modules.demandes.record.stateChanged', { state: t('modules.demandes.states.matched') }))
          onDone()
        },
        onError: (failure) => setError(demandesError(failure)),
      },
    )
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{t(`${J}.title`)}</DialogTitle>
        <DialogDescription>{t(`${J}.description`)}</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} noValidate className="space-y-3">
        <FormField label={t(`${J}.professional`)} help={lists.isError ? t(`${J}.loadError`) : undefined}>
          {(field) => (
            <Select {...field} value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
              <option value="">{lists.data ? t(`${J}.choose`) : t('common.loading')}</option>
              {!known && professionalId && lists.data === undefined && <option value={professionalId}>{t('common.loading')}</option>}
              {professionals.map((p) => (
                <option key={p.target_id} value={p.target_id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t(`${J}.effects.files`)}</li>
          <li>{t(`${J}.effects.primary`)}</li>
          <li>{t(`${J}.effects.pending`)}</li>
          <li>{t(`${J}.effects.book`)}</li>
        </ul>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="submit" aria-disabled={setState.isPending || undefined}>
            {setState.isPending ? t(`${J}.saving`) : t(`${J}.action`)}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

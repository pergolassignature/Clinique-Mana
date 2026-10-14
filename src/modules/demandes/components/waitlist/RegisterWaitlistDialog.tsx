import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { t } from '@/i18n'
import { SegmentedToggle } from '@/shared/components/SegmentedToggle'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Select } from '@/shared/ui/select'
import { Textarea } from '@/shared/ui/textarea'
import { toast } from '@/shared/ui/sonner'
import { useRegisterWaitlist, useWaitlistLists } from '../../hooks/use-waitlist'
import { demandesError } from '../../lib/errors'

const W = 'modules.demandes.waitlist.register'

/**
 * « Inscrire sur la liste d'attente » (D-15): a profession, a professional, or both; the priority
 * (« Prioritaire » with its reason). The criteria come from the request's Accueil. The request
 * needs its client file first. Opened from the state control (« Passer à Liste d'attente ») and
 * from Suivi.
 */
export function RegisterWaitlistDialog({
  demandeId,
  hasFile,
  open,
  onOpenChange,
}: {
  demandeId: string
  hasFile: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}>{open && <RegisterForm demandeId={demandeId} hasFile={hasFile} onDone={() => onOpenChange(false)} />}</Dialog>
}

function RegisterForm({ demandeId, hasFile, onDone }: { demandeId: string; hasFile: boolean; onDone: () => void }) {
  const lists = useWaitlistLists()
  const register = useRegisterWaitlist(demandeId)
  const [titleId, setTitleId] = useState('')
  const [professionalId, setProfessionalId] = useState('')
  const [priority, setPriority] = useState<'normal' | 'priority'>('normal')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const titles = (lists.data ?? []).filter((l) => l.target_kind === 'title')
  const professionals = (lists.data ?? []).filter((l) => l.target_kind === 'professional').sort((a, b) => a.name.localeCompare(b.name, 'fr'))

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (register.isPending) return
    if (!titleId && !professionalId) {
      setError(t(`${W}.targetNeeded`))
      return
    }
    if (priority === 'priority' && !reason.trim()) {
      setError(t(`${W}.reasonNeeded`))
      return
    }
    setError(null)
    register.mutate(
      { titleId: titleId || null, professionalId: professionalId || null, priority, priorityReason: reason },
      {
        onSuccess: () => {
          toast.success(t(`${W}.done`))
          onDone()
        },
        onError: (failure) => setError(demandesError(failure)),
      },
    )
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{t(`${W}.title`)}</DialogTitle>
        <DialogDescription>{t(`${W}.description`)}</DialogDescription>
      </DialogHeader>
      {!hasFile ? (
        <>
          <p role="alert" className="text-sm text-foreground">
            {t(`${W}.fileNeeded`)}
          </p>
          {/* A way on: to Accueil, where the file is attached, or out. */}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('common.close')}
              </Button>
            </DialogClose>
            <Button asChild>
              <Link to={`/demandes/${demandeId}/accueil`} onClick={onDone}>
                {t(`${W}.toAccueil`)}
              </Link>
            </Button>
          </DialogFooter>
        </>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-3">
          <FormField label={t(`${W}.profession`)} help={t(`${W}.titleHelp`)}>
            {(field) => (
              <Select {...field} value={titleId} onChange={(e) => setTitleId(e.target.value)}>
                <option value="">{t(`${W}.none`)}</option>
                {titles.map((l) => (
                  <option key={l.target_id} value={l.target_id}>
                    {t(`${W}.optionCount`, { name: l.name, count: String(l.open_count) })}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label={t(`${W}.professional`)} help={t(`${W}.professionalHelp`)}>
            {(field) => (
              <Select {...field} value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
                <option value="">{t(`${W}.none`)}</option>
                {professionals.map((l) => (
                  <option key={l.target_id} value={l.target_id}>
                    {t(`${W}.optionCount`, { name: l.name, count: String(l.open_count) })}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">{t(`${W}.priority`)}</p>
            <SegmentedToggle
              label={t(`${W}.priority`)}
              value={priority}
              onChange={setPriority}
              options={[
                { value: 'normal', label: t('modules.demandes.waitlist.priority.normal') },
                { value: 'priority', label: t('modules.demandes.waitlist.priority.priority') },
              ]}
            />
          </div>
          {priority === 'priority' && (
            <FormField label={t(`${W}.reason`)} help={t(`${W}.reasonHelp`)}>
              {(field) => <Textarea {...field} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={2} />}
            </FormField>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('common.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" aria-disabled={register.isPending || undefined}>
              {register.isPending ? t(`${W}.saving`) : t(`${W}.save`)}
            </Button>
          </DialogFooter>
        </form>
      )}
    </DialogContent>
  )
}

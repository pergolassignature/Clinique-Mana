import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess, useReadyAccess } from '@/core/access/access-context'
import { demandesError } from '../lib/errors'
import { CheckboxField } from '@/shared/components/CheckboxField'
import { parsePhone } from '@/shared/lib/format'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { Textarea } from '@/shared/ui/textarea'
import { toast } from '@/shared/ui/sonner'
import { CHANNELS } from '../api/demandes'
import { useCreateDemande } from '../hooks/use-demandes'
import { demandePath, optionLabel } from '../lib/display'

const N = 'modules.demandes.new'

/**
 * « Nouvelle demande », la saisie rapide (roadmap §2.3: « en 20 s »): a name, a phone or an email,
 * how it came in, urgent or not, « Je m'en occupe »; the rest of the intake is in the record,
 * which opens once created. The internal note only for whoever holds demandes.notes.
 */
export function NewDemandeDialog() {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          {t(`${N}.open`)}
        </Button>
      </DialogTrigger>
      {open && <NewDemandeForm onDone={() => setOpen(false)} />}
    </Dialog>
  )
}

function NewDemandeForm({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate()
  const { can } = useAccess()
  const { user_id: me } = useReadyAccess()
  const create = useCreateDemande()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [channel, setChannel] = useState<string>('phone')
  const [urgent, setUrgent] = useState(false)
  const [mine, setMine] = useState(true)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const dirty = Boolean(name || phone || email || note || urgent)
  useUnsavedChanges(dirty)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (create.isPending) return
    setError(null)
    const e164 = phone.trim() ? parsePhone(phone) : null
    if (phone.trim() && !e164) {
      setError(t(`${N}.badPhone`))
      return
    }
    if (!name.trim() && !e164 && !email.trim()) {
      setError(t(`${N}.someone`))
      return
    }
    create.mutate(
      {
        channel,
        ...(name.trim() && { contact_name: name.trim() }),
        ...(e164 && { contact_phone_e164: e164 }),
        ...(email.trim() && { contact_email: email.trim().toLowerCase() }),
        ...(urgent && { is_urgent: true }),
        ...(mine && can('demandes.manage') && { assigned_to: me }),
        ...(note.trim() && can('demandes.notes') && { internal_note: note.trim() }),
      },
      {
        onSuccess: (id) => {
          toast.success(t(`${N}.created`))
          onDone()
          navigate(demandePath(id))
        },
        onError: (failure) => setError(demandesError(failure)),
      },
    )
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{t(`${N}.title`)}</DialogTitle>
        <DialogDescription>{t(`${N}.description`)}</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} noValidate className="space-y-3">
        <FormField label={t(`${N}.name`)}>{(field) => <Input {...field} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoFocus />}</FormField>
        <FormField label={t(`${N}.phone`)}>
          {(field) => <Input {...field} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />}
        </FormField>
        <FormField label={t(`${N}.email`)}>
          {(field) => <Input {...field} type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />}
        </FormField>
        <FormField label={t(`${N}.channel`)}>
          {(field) => (
            <Select {...field} value={channel} onChange={(e) => setChannel(e.target.value)}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {optionLabel('channel', c)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <CheckboxField label={t(`${N}.urgent`)} checked={urgent} onCheckedChange={(v) => setUrgent(v === true)} />
        {can('demandes.manage') && <CheckboxField label={t(`${N}.mine`)} checked={mine} onCheckedChange={(v) => setMine(v === true)} />}
        {can('demandes.notes') && (
          <FormField label={t(`${N}.note`)} help={t(`${N}.noteHelp`)}>
            {(field) => <Textarea {...field} value={note} onChange={(e) => setNote(e.target.value)} rows={3} />}
          </FormField>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="submit" aria-disabled={create.isPending || undefined}>
            {create.isPending ? t(`${N}.creating`) : t(`${N}.create`)}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

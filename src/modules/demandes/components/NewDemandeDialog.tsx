import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess, useReadyAccess } from '@/core/access/access-context'
import { demandesError } from '../lib/errors'
import { CheckboxField } from '@/shared/components/CheckboxField'
import { EMAIL_PATTERN } from '@/shared/lib/email'
import { parsePhone } from '@/shared/lib/format'
import { useDebouncedValue } from '@/shared/lib/use-debounced-value'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { Button } from '@/shared/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogScrollBody,
  dialogScrollContent,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog'
import { FormField, FormRow } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { Textarea } from '@/shared/ui/textarea'
import { toast } from '@/shared/ui/sonner'
import { CHANNELS, type IntakeProbe } from '../api/demandes'
import { useCreateDemande, useDemandeMatches } from '../hooks/use-demandes'
import { ExistingFiles, type ChosenFile } from './ExistingFiles'
import { demandePath, optionLabel } from '../lib/display'

const N = 'modules.demandes.new'

/**
 * « Nouvelle demande », la saisie rapide (roadmap §2.3: « en 20 s »): the first name (the last name
 * if given, D-56), a phone or an email, how it came in, urgent or not, « Je m'en occupe »; the rest
 * of the intake is in the record, which opens once created. The internal note only for whoever
 * holds demandes.notes. While the person is typed, « Dossiers existants » (D-55) offers the files
 * the clinic already has for her: « Utiliser ce dossier » creates the request attached to it.
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
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [channel, setChannel] = useState<string>('phone')
  const [urgent, setUrgent] = useState(false)
  const [mine, setMine] = useState(true)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<ChosenFile | null>(null)
  const dirty = Boolean(firstName || lastName || phone || email || note || urgent || chosen)
  useUnsavedChanges(dirty)

  // « Dossiers existants »: 400 ms after the last keystroke, from what is meaningful only (a valid
  // phone or email, a first and a last name of 3 characters together); never in the URL.
  const canLookUp = can('demandes.manage') && can('clients.view')
  const probe = useDebouncedValue(
    useMemo((): IntakeProbe | null => {
      if (!canLookUp) return null
      const e164 = parsePhone(phone)
      const mail = email.trim().toLowerCase()
      const first = firstName.trim()
      const last = lastName.trim()
      const named = first !== '' && last !== '' && (first + last).length >= 3
      const next: IntakeProbe = {
        firstName: named ? first : null,
        lastName: named ? last : null,
        phone: e164,
        email: EMAIL_PATTERN.test(mail) ? mail : null,
      }
      return next.firstName || next.phone || next.email ? next : null
    }, [canLookUp, firstName, lastName, phone, email]),
    400,
  )
  const matches = useDemandeMatches(probe)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (create.isPending) return
    setError(null)
    const e164 = phone.trim() ? parsePhone(phone) : null
    if (phone.trim() && !e164) {
      setError(t(`${N}.badPhone`))
      return
    }
    if (!chosen && !firstName.trim()) {
      setError(t(`${N}.someone`))
      return
    }
    create.mutate(
      {
        channel,
        // « Utiliser ce dossier »: attached at creation, in the same call (D-55). What was typed
        // stays the request's own contact, as when a file is attached later.
        ...(chosen && { client_id: chosen.clientId }),
        ...(firstName.trim() && { contact_first_name: firstName.trim() }),
        ...(firstName.trim() && lastName.trim() && { contact_last_name: lastName.trim() }),
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

  // A dialog anchored at the top whose fields scroll: the matches grow downward and the footer's
  // « Créer la demande » stays in view.
  return (
    <DialogContent position="top" className={dialogScrollContent}>
      <DialogHeader>
        <DialogTitle>{t(`${N}.title`)}</DialogTitle>
        <DialogDescription>{t(`${N}.description`)}</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col gap-3.5">
        <DialogScrollBody className="gap-3">
          <FormRow columns={2}>
            <FormField label={t(`${N}.firstName`)} required={!chosen} help={chosen ? undefined : t(`${N}.firstNameHelp`)}>
              {(field) => <Input {...field} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="off" autoFocus maxLength={100} />}
            </FormField>
            <FormField label={t(`${N}.lastName`)}>
              {(field) => <Input {...field} value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="off" maxLength={100} />}
            </FormField>
          </FormRow>
          <FormField label={t(`${N}.phone`)}>
            {(field) => <Input {...field} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />}
          </FormField>
          <FormField label={t(`${N}.email`)}>
            {(field) => <Input {...field} type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />}
          </FormField>
          {(probe !== null || chosen !== null) && (
            <ExistingFiles
              matches={probe !== null ? (matches.data ?? null) : null}
              loading={probe !== null && matches.isFetching}
              failed={probe !== null && matches.isError}
              chosen={chosen}
              onChoose={(file) => {
                setChosen(file)
                setError(null)
              }}
            />
          )}
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
        </DialogScrollBody>
        <DialogFooter>
          <Button type="submit" aria-disabled={create.isPending || undefined}>
            {create.isPending ? t(`${N}.creating`) : t(`${N}.create`)}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

import { useState } from 'react'
import { t } from '@/i18n'
import { demandesError } from '../../lib/errors'
import { parsePhone } from '@/shared/lib/format'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog'
import { FormField, FormRow } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { toast } from '@/shared/ui/sonner'
import type { ClientDuplicate } from '../../api/demandes'
import { useClientSearch, useCreateClientFile, useUpdateDemande } from '../../hooks/use-demandes'
import { fileLabel } from '../../lib/display'
import { useDemandeRecord } from './record-context'

const C = 'modules.demandes.clientLink'

/** « Prénom Nom » → its two parts (the last word is the family name). */
function splitName(name: string | null): { first: string; last: string } {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length < 2) return { first: words[0] ?? '', last: '' }
  return { first: words.slice(0, -1).join(' '), last: words[words.length - 1] ?? '' }
}

/**
 * TEMPORAIRE (D-9): « Rattacher un dossier ». Search the clinic's files (Clients' `search_clients`)
 * or create one from the request's contact, with Clients' duplicate rules (a HIGH duplicate is
 * linked, never created again; a MEDIUM one needs « C'est une autre personne »). Replaced by the
 * Clients picker (lane A, C4) in the first Demandes batch after it.
 */
export function ClientLinkDialog({ label }: { label: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="max-sm:h-11">
          {label}
        </Button>
      </DialogTrigger>
      {open && <LinkPanel onDone={() => setOpen(false)} />}
    </Dialog>
  )
}

function LinkPanel({ onDone }: { onDone: () => void }) {
  const { id, bundle } = useDemandeRecord()
  const d = bundle.demande
  const update = useUpdateDemande(id)
  const create = useCreateClientFile()
  const [query, setQuery] = useState(d.contact_name ?? '')
  const results = useClientSearch(query)
  const initial = splitName(d.contact_name)
  const [first, setFirst] = useState(initial.first)
  const [last, setLast] = useState(initial.last)
  const [email, setEmail] = useState(d.contact_email ?? '')
  const [phone, setPhone] = useState(d.contact_phone_e164 ?? '')
  const [duplicates, setDuplicates] = useState<ClientDuplicate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pending = update.isPending || create.isPending

  const link = (clientId: string) =>
    update.mutate(
      { client_id: clientId },
      {
        onSuccess: () => {
          toast.success(t(`${C}.linked`))
          onDone()
        },
        onError: (failure) => setError(demandesError(failure)),
      },
    )

  const createFile = (confirmMedium: boolean) => {
    setError(null)
    const mobile = phone.trim() ? parsePhone(phone) : null
    if (!first.trim() || !last.trim()) {
      setError(t(`${C}.nameNeeded`))
      return
    }
    create.mutate(
      { client: { first_name: first.trim(), last_name: last.trim(), email: email.trim().toLowerCase() || null, mobile_e164: mobile }, confirmMedium },
      {
        onSuccess: ({ created, duplicates: found }) => {
          if (created) link(created)
          else setDuplicates(found)
        },
        onError: (failure) => setError(demandesError(failure)),
      },
    )
  }

  const onlyMedium = duplicates !== null && duplicates.length > 0 && duplicates.every((dup) => dup.level === 'medium')

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{t(`${C}.title`)}</DialogTitle>
        <DialogDescription>{t(`${C}.description`)}</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <FormField label={t(`${C}.search`)}>
          {(field) => <Input {...field} type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" autoFocus />}
        </FormField>
        <div role="status" className="text-sm">
          {query.trim().length >= 2 && results.data?.length === 0 && <p className="text-muted-foreground">{t(`${C}.none`)}</p>}
        </div>
        {results.data && results.data.length > 0 && (
          <ul aria-label={t(`${C}.results`)} className="divide-y divide-border-light">
            {results.data.map((client) => {
              const file = fileLabel(client.client_number, `${client.first_name} ${client.last_name}`)
              return (
                <li key={client.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0 text-sm">
                    {file}
                    {client.email && <span className="ml-2 text-xs text-muted-foreground">{client.email}</span>}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={t(`${C}.linkTo`, { file })}
                    aria-disabled={pending || undefined}
                    onClick={ignoreWhenInactive(pending, () => link(client.id))}
                    className={cn(softDisabledClasses, 'max-sm:h-11')}
                  >
                    {t(`${C}.link`)}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <section aria-labelledby="demande-create-file" className="space-y-2 border-t border-border-light pt-3">
        <h3 id="demande-create-file" className="text-sm font-medium">
          {t(`${C}.createTitle`)}
        </h3>
        <FormRow>
          <FormField label={t(`${C}.first`)}>{(field) => <Input {...field} value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="off" />}</FormField>
          <FormField label={t(`${C}.last`)}>{(field) => <Input {...field} value={last} onChange={(e) => setLast(e.target.value)} autoComplete="off" />}</FormField>
        </FormRow>
        <FormRow>
          <FormField label={t(`${C}.email`)}>
            {(field) => <Input {...field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />}
          </FormField>
          <FormField label={t(`${C}.phone`)}>{(field) => <Input {...field} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />}</FormField>
        </FormRow>
        {duplicates && duplicates.length > 0 && (
          <div role="alert" className="space-y-1.5 rounded-md border border-border p-2">
            <p className="text-sm font-medium">{onlyMedium ? t(`${C}.similar`) : t(`${C}.same`)}</p>
            <ul className="space-y-1">
              {duplicates.map((dup) => {
                const file = fileLabel(dup.client_number, dup.display_name)
                return (
                  <li key={dup.client_id} className="flex flex-wrap items-center gap-2">
                    <span className="text-sm">{file}</span>
                    <Button type="button" variant="outline" size="sm" aria-label={t(`${C}.linkTo`, { file })} onClick={() => link(dup.client_id)} className="max-sm:h-11">
                      {t(`${C}.link`)}
                    </Button>
                  </li>
                )
              })}
            </ul>
            {onlyMedium && (
              <Button type="button" variant="ghost" size="sm" onClick={() => createFile(true)} className="max-sm:h-11">
                {t(`${C}.createAnyway`)}
              </Button>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="button" aria-disabled={pending || undefined} onClick={ignoreWhenInactive(pending, () => createFile(false))} className={softDisabledClasses}>
          {create.isPending ? t(`${C}.creating`) : t(`${C}.create`)}
        </Button>
      </section>
    </DialogContent>
  )
}

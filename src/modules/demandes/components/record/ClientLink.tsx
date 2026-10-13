import { Suspense, useId, useState } from 'react'
import { t } from '@/i18n'
import { ClientPicker } from '@/modules/clients'
import { formatPhone } from '@/shared/lib/format'
import { Button } from '@/shared/ui/button'
import { toast } from '@/shared/ui/sonner'
import { useUpdateDemande } from '../../hooks/use-demandes'
import { demandesError } from '../../lib/errors'
import { useDemandeRecord } from './record-context'

const C = 'modules.demandes.clientLink'

/** « Prénom Nom » → its two parts (the last word is the family name). */
function splitName(name: string | null): { first: string; last: string } {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length < 2) return { first: words[0] ?? '', last: '' }
  return { first: words.slice(0, -1).join(' '), last: words[words.length - 1] ?? '' }
}

/**
 * « Rattacher un dossier » / « Changer de dossier » on the Accueil tab: Clients' picker
 * (`@/modules/clients`, lazy) opens in the card. A file chosen from the search, picked from the
 * duplicates panel or created through « Nouveau client » (prefilled with the request's contact)
 * becomes the request's file through `update_demande`.
 */
export function ClientLink({ label }: { label: string }) {
  const { id, bundle } = useDemandeRecord()
  const d = bundle.demande
  const update = useUpdateDemande(id)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleId = useId()

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} className="max-sm:h-11">
        {label}
      </Button>
    )
  }

  const link = (clientId: string) => {
    setError(null)
    update.mutate(
      { client_id: clientId },
      {
        onSuccess: () => {
          toast.success(t(`${C}.linked`))
          setOpen(false)
        },
        onError: (failure) => setError(demandesError(failure)),
      },
    )
  }
  const name = splitName(d.contact_name)

  return (
    <section aria-labelledby={titleId} className="space-y-2 rounded-md border border-border p-3">
      <h3 id={titleId} className="text-sm font-medium">
        {t(`${C}.title`)}
      </h3>
      <p className="text-sm text-muted-foreground">{t(`${C}.description`)}</p>
      <Suspense fallback={<p className="text-sm text-muted-foreground">{t('common.loading')}</p>}>
        <ClientPicker
          onSelect={(clientId) => link(clientId)}
          excludeIds={bundle.client ? [bundle.client.id] : []}
          initialValues={{
            firstName: name.first,
            lastName: name.last,
            email: d.contact_email ?? '',
            mobile: d.contact_phone_e164 ? formatPhone(d.contact_phone_e164) : '',
          }}
        />
      </Suspense>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} className="max-sm:h-11">
        {t('common.cancel')}
      </Button>
    </section>
  )
}

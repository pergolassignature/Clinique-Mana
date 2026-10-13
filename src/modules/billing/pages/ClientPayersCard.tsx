import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { t } from '@/i18n'
import { RefusalAlert } from '@/shared/components/RefusalAlert'
import { ignoreWhenInactive } from '@/shared/components/soft-disabled'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Select } from '@/shared/ui/select'
import type { ClientPayerBilling } from '../api/payers'
import { useClientPayersBilling, useCreatePayerInvoice, useSetClientPayerOrganisation } from '../hooks/use-payers'
import { formatCents } from '../lib/money'
import { organisationKindLabel, periodText, usageText } from '../lib/payers'

const C = 'modules.billing.payers.client'
/** The organisation found by itself (no choice saved): the select's empty value. */
const FOUND = ''

/**
 * « Payeurs tiers » in the dossier's Facturation panel (FP-8): per active payer of the client (IVAC,
 * a PAE), the organisation billed (chosen here, else the one found: IVAC's, the provider of the same
 * name), this agreement year's use against its maximum with « Budget bas » (80 %) and « Expiré »,
 * « À compléter » for a payer the split cannot use yet, what is still to claim, and « Facture à
 * l'organisme » (a report billed to IVAC). Nothing when the client has no payer.
 */
export function ClientPayersCard({ clientId, manage }: { clientId: string; manage: boolean }) {
  const payers = useClientPayersBilling(clientId)
  if (!payers.data || payers.data.length === 0) return null
  return (
    <section className="space-y-2" aria-labelledby="client-payers-title">
      <h3 id="client-payers-title" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t(`${C}.title`)}
      </h3>
      <ul className="space-y-3">
        {payers.data.map((p) => (
          <PayerItem key={p.clientPayerId} clientId={clientId} payer={p} manage={manage} />
        ))}
      </ul>
    </section>
  )
}

function PayerItem({ clientId, payer: p, manage }: { clientId: string; payer: ClientPayerBilling; manage: boolean }) {
  const navigate = useNavigate()
  const [refusal, setRefusal] = useState<string | null>(null)
  const setOrganisation = useSetClientPayerOrganisation({ onErrorMessage: setRefusal })
  const create = useCreatePayerInvoice({ onErrorMessage: setRefusal })
  const incomplete = p.isStub || p.organisation === null
  const period = periodText(p)
  return (
    <li className="space-y-2 rounded-md border border-border bg-card p-3 text-sm">
      <p className="flex flex-wrap items-center gap-2 font-medium">
        {organisationKindLabel(p.kind)}
        {p.fileNumber && <span className="font-normal">· {t(`${C}.fileNumber`, { number: p.fileNumber })}</span>}
        {p.isStub && <Badge variant="warning">{t(`${C}.stub`)}</Badge>}
        {p.expired && <Badge variant="error">{t(`${C}.expired`)}</Badge>}
        {!p.expired && p.budgetLow && <Badge variant="warning">{t(`${C}.budgetLow`)}</Badge>}
      </p>
      <p>{usageText(p)}</p>
      {period && <p className="text-muted-foreground">{period}</p>}
      {p.pendingCents > 0 && <p>{t(`${C}.pending`, { amount: formatCents(p.pendingCents) })}</p>}
      {incomplete && (
        <p className="text-muted-foreground">
          {t(p.isStub ? `${C}.stubHelp` : `${C}.noOrganisationHelp`)}{' '}
          <Link to={`/clients/${clientId}/assurance-et-payeurs`} className="text-primary underline-offset-2 hover:underline">
            {t(`${C}.openCoverage`)}
          </Link>
        </p>
      )}
      <FormField label={t(`${C}.organisation`)} help={t(`${C}.organisationHelp`)} width="md">
        {(field) => (
          <Select
            {...field}
            value={p.organisation?.chosen ? p.organisation.id : FOUND}
            readOnly={!manage}
            onChange={(e) => {
              setRefusal(null)
              setOrganisation.mutate({ clientPayerId: p.clientPayerId, organisationId: e.target.value === FOUND ? null : e.target.value })
            }}
          >
            <option value={FOUND}>
              {p.organisation && !p.organisation.chosen ? t(`${C}.found`, { name: p.organisation.name }) : t(`${C}.notFound`)}
            </option>
            {p.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      {refusal && <RefusalAlert message={refusal} />}
      {manage && !incomplete && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-disabled={create.isPending || undefined}
          onClick={ignoreWhenInactive(create.isPending, () => create.mutate(p.clientPayerId, { onSuccess: (invoiceId) => navigate(`/facturation/factures/${invoiceId}`) }))}
        >
          {t(`${C}.createInvoice`, { organisation: p.organisation?.name ?? '' })}
        </Button>
      )}
    </li>
  )
}

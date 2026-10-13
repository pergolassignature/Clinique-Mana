import { Link, useSearchParams } from 'react-router-dom'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { formatDateOnly } from '@/shared/lib/timezone'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import type { InvoiceStatus } from '../api/invoices'
import { useInvoices } from '../hooks/use-invoices'
import { formatCents, paymentLabel, paymentVariant, statusLabel, statusVariant } from '../lib/money'
import { FeeDecisions, OverdueInvoices } from './FollowUp'
import { MorningQueue } from './MorningQueue'

const L = 'modules.billing.list'
const VIEWS = ['file', 'impayes', 'frais', 'brouillons', 'emises', 'creditees', 'toutes'] as const
type View = (typeof VIEWS)[number]
type ListView = Exclude<View, 'file' | 'impayes' | 'frais'>
const STATUS_OF: Record<ListView, InvoiceStatus | null> = { brouillons: 'draft', emises: 'issued', creditees: 'credited', toutes: null }

/**
 * « Factures » (`/facturation`, `billing.view`): the morning queue first (F2, the default view),
 * « Impayés » and « Frais d'annulation » (F3), then the invoices newest first by state (real Radix tabs, the view in the URL): drafts to
 * finish, issued (with their payment state), credited, all. A row opens the invoice. New invoices
 * start from the client's « Visites et paiements ».
 */
export function InvoicesPage() {
  usePageTitle(t(`${L}.title`))
  const [params, setParams] = useSearchParams()
  const view: View = (VIEWS as readonly string[]).includes(params.get('vue') ?? '') ? (params.get('vue') as View) : 'file'
  return (
    <>
      <PageHeader level={1} title={t(`${L}.title`)} description={t(`${L}.description`)} />
      <Tabs value={view} onValueChange={(v) => setParams(v === 'file' ? {} : { vue: v }, { replace: true })} className="mb-3">
        <TabsList aria-label={t(`${L}.views`)}>
          {VIEWS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {t(`${L}.view.${v}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {view === 'file' ? (
        <MorningQueue />
      ) : view === 'impayes' ? (
        <OverdueInvoices />
      ) : view === 'frais' ? (
        <FeeDecisions />
      ) : (
        <InvoiceList view={view} />
      )}
    </>
  )
}

function InvoiceList({ view }: { view: ListView }) {
  const invoices = useInvoices(STATUS_OF[view])
  const rows = invoices.data?.pages.flat() ?? []
  return (
    <>
      {invoices.isError && !invoices.data ? (
        <LoadError message={t(`${L}.loadError`)} onRetry={() => void invoices.refetch()} retrying={invoices.isFetching} />
      ) : !invoices.data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState title={t(`${L}.empty.${view}`)} />
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 font-medium">{t(`${L}.number`)}</th>
                  <th className="px-3 py-2 font-medium">{t(`${L}.client`)}</th>
                  <th className="px-3 py-2 font-medium">{t(`${L}.payer`)}</th>
                  <th className="px-3 py-2 font-medium">{t(`${L}.issuedOn`)}</th>
                  <th className="px-3 py-2 text-right font-medium">{t(`${L}.total`)}</th>
                  <th className="px-3 py-2 font-medium">{t(`${L}.status`)}</th>
                  <th className="px-3 py-2 font-medium">{t(`${L}.payment`)}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/40">
                    <td className="px-3 py-2">
                      <Link to={`/facturation/factures/${r.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                        {r.number ?? t(`${L}.draft`)}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{r.clientName}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.payerId === r.clientId ? t(`${L}.payerSelf`) : r.payerName}</td>
                    <td className="tabular px-3 py-2">{r.issuedOn ? formatDateOnly(r.issuedOn) : '—'}</td>
                    <td className="tabular px-3 py-2 text-right">{formatCents(r.totalCents)}</td>
                    <td className="px-3 py-2">
                      <Badge variant={statusVariant(r.status)}>{statusLabel(r.status)}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      {r.status === 'issued' && <Badge variant={paymentVariant(r.paymentStatus)}>{paymentLabel(r.paymentStatus)}</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {invoices.hasNextPage && (
            <Button type="button" variant="outline" onClick={() => void invoices.fetchNextPage()} aria-disabled={invoices.isFetchingNextPage || undefined}>
              {t(`${L}.more`)}
            </Button>
          )}
        </div>
      )}
    </>
  )
}

import { useState } from 'react'
import { CreditCard, Building2, Plus, Pencil } from 'lucide-react'
import { t } from '@/i18n'
import { formatDateOnly } from '@/shared/lib/timezone'
import { AccordionItem, AccordionTrigger, AccordionContent } from '@/shared/ui/accordion'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import type { ClientWithRelations } from '../../types'
import {
  useClientExternalPayers,
  useClinicSettings,
  useProfessionalIvacNumber,
  IVAC_RATE_DISPLAY,
  type ClientExternalPayer,
  type ClientExternalPayerIvac,
  type ClientExternalPayerPae,
  type PAECoverageRule,
} from '@/external-payers'
import {
  AddExternalPayerDialog,
  EditIvacPayerDialog,
  EditPaePayerDialog,
} from './external-payer-dialogs'

interface ExternalPayersSectionProps {
  client: ClientWithRelations
  onUpdate?: () => void
}

export function ExternalPayersSection({ client, onUpdate }: ExternalPayersSectionProps) {
  // Fetch external payers for this client (use UUID id, not display clientId)
  const { data: payers = [], isLoading } = useClientExternalPayers(client.id)
  const { data: clinicSettings } = useClinicSettings()
  const { data: professionalIvac } = useProfessionalIvacNumber(client.primaryProfessionalId || undefined)

  // Dialog states
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [editIvacOpen, setEditIvacOpen] = useState(false)
  const [editPaeOpen, setEditPaeOpen] = useState(false)
  const [selectedPayer, setSelectedPayer] = useState<ClientExternalPayer | null>(null)

  // Find active payers
  const activePayers = payers.filter((p) => p.is_active)
  const ivacPayer = activePayers.find((p) => p.payer_type === 'ivac') as ClientExternalPayerIvac | undefined
  const paePayer = activePayers.find((p) => p.payer_type === 'pae') as ClientExternalPayerPae | undefined
  const inactivePayers = payers.filter((p) => !p.is_active)

  const handleEditIvac = (payer: ClientExternalPayerIvac) => {
    setSelectedPayer(payer)
    setEditIvacOpen(true)
  }

  const handleEditPae = (payer: ClientExternalPayerPae) => {
    setSelectedPayer(payer)
    setEditPaeOpen(true)
  }

  const handleDialogClose = () => {
    setAddDialogOpen(false)
    setEditIvacOpen(false)
    setEditPaeOpen(false)
    setSelectedPayer(null)
    onUpdate?.()
  }

  const formatDate = (date: string | null | undefined) => {
    // Use formatDateOnly for date-only fields (not timestamptz)
    // This prevents timezone shift (e.g., 2020-01-01 showing as 2019-12-31)
    return formatDateOnly(date, 'd MMMM yyyy')
  }

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency: 'CAD',
    }).format(cents / 100)
  }

  return (
    <>
      <AccordionItem value="external-payers" className="border rounded-lg px-4">
        <AccordionTrigger className="hover:no-underline">
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-sage-500" />
            <span>{t('externalPayers.title')}</span>
            {activePayers.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {activePayers.length}
              </Badge>
            )}
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-4">
            {/* Add button */}
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAddDialogOpen(true)}
                disabled={!!ivacPayer && !!paePayer}
              >
                <Plus className="h-4 w-4 mr-1" />
                {t('externalPayers.add')}
              </Button>
            </div>

            {isLoading ? (
              <div className="text-sm text-foreground-muted">{t('common.loading')}</div>
            ) : activePayers.length === 0 ? (
              <div className="text-sm text-foreground-muted italic py-4 text-center">
                {t('externalPayers.empty')}
              </div>
            ) : (
              <>
                {/* IVAC Card */}
                {ivacPayer && (
                  <IvacPayerCard
                    payer={ivacPayer}
                    clinicProviderNumber={clinicSettings?.ivac_provider_number}
                    professionalIvacNumber={professionalIvac?.ivac_number}
                    onEdit={() => handleEditIvac(ivacPayer)}
                    formatDate={formatDate}
                  />
                )}

                {/* PAE Card */}
                {paePayer && (
                  <PaePayerCard
                    payer={paePayer}
                    onEdit={() => handleEditPae(paePayer)}
                    formatDate={formatDate}
                    formatCurrency={formatCurrency}
                  />
                )}
              </>
            )}

            {/* Inactive payers */}
            {inactivePayers.length > 0 && (
              <div className="mt-4 pt-4 border-t border-border">
                <h5 className="text-xs font-medium text-foreground-muted mb-2">
                  {t('externalPayers.inactive')} ({inactivePayers.length})
                </h5>
                <div className="space-y-2">
                  {inactivePayers.map((payer) => (
                    <div
                      key={payer.id}
                      className="flex items-center justify-between text-sm text-foreground-muted bg-background-secondary/50 rounded px-3 py-2"
                    >
                      <span>
                        {payer.payer_type === 'ivac' ? 'IVAC' : 'PAE'} -{' '}
                        {payer.payer_type === 'ivac'
                          ? (payer as ClientExternalPayerIvac).ivac_details?.file_number
                          : (payer as ClientExternalPayerPae).pae_details?.file_number}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {t('externalPayers.status.inactive')}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* Dialogs */}
      <AddExternalPayerDialog
        clientId={client.id}
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onSuccess={handleDialogClose}
        hasIvac={!!ivacPayer}
        hasPae={!!paePayer}
      />

      {selectedPayer?.payer_type === 'ivac' && (
        <EditIvacPayerDialog
          payer={selectedPayer as ClientExternalPayerIvac}
          clientId={client.id}
          open={editIvacOpen}
          onOpenChange={setEditIvacOpen}
          onSuccess={handleDialogClose}
        />
      )}

      {selectedPayer?.payer_type === 'pae' && (
        <EditPaePayerDialog
          payer={selectedPayer as ClientExternalPayerPae}
          clientId={client.id}
          open={editPaeOpen}
          onOpenChange={setEditPaeOpen}
          onSuccess={handleDialogClose}
        />
      )}
    </>
  )
}

// =============================================================================
// IVAC PAYER CARD
// =============================================================================

interface IvacPayerCardProps {
  payer: ClientExternalPayerIvac
  clinicProviderNumber: string | null | undefined
  professionalIvacNumber: string | undefined
  onEdit: () => void
  formatDate: (date: string | null | undefined) => string
}

function IvacPayerCard({
  payer,
  clinicProviderNumber,
  professionalIvacNumber,
  onEdit,
  formatDate,
}: IvacPayerCardProps) {
  const details = payer.ivac_details
  const isExpired = details?.expiry_date && new Date(details.expiry_date) < new Date()

  return (
    <div className="border rounded-lg p-4 bg-background">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-sage-600" />
          <h4 className="font-medium">IVAC</h4>
          {isExpired && (
            <Badge variant="error" className="text-xs">
              {t('externalPayers.status.expired')}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="h-4 w-4" />
        </Button>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-foreground-secondary">{t('externalPayers.ivac.fileNumber')}</dt>
        <dd className="font-medium">{details?.file_number || '—'}</dd>

        <dt className="text-foreground-secondary">{t('externalPayers.ivac.eventDate')}</dt>
        <dd>{formatDate(details?.event_date)}</dd>

        <dt className="text-foreground-secondary">{t('externalPayers.ivac.expiryDate')}</dt>
        <dd className={isExpired ? 'text-wine-600' : ''}>{formatDate(details?.expiry_date)}</dd>

        <dt className="text-foreground-secondary">{t('externalPayers.ivac.rate')}</dt>
        <dd className="font-medium text-sage-600">{IVAC_RATE_DISPLAY}</dd>
      </dl>

      {/* Reference numbers */}
      <div className="mt-3 pt-3 border-t border-border">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-foreground-secondary">{t('externalPayers.ivac.clinicProviderNumber')}</dt>
          <dd className="text-foreground-muted">{clinicProviderNumber || '—'}</dd>

          <dt className="text-foreground-secondary">{t('externalPayers.ivac.professionalNumber')}</dt>
          <dd className="text-foreground-muted">{professionalIvacNumber || '—'}</dd>
        </dl>
      </div>
    </div>
  )
}

// =============================================================================
// PAE PAYER CARD
// =============================================================================

interface PaePayerCardProps {
  payer: ClientExternalPayerPae
  onEdit: () => void
  formatDate: (date: string | null | undefined) => string
  formatCurrency: (cents: number) => string
}

function PaePayerCard({ payer, onEdit, formatDate, formatCurrency }: PaePayerCardProps) {
  const details = payer.pae_details
  const isExpired = details?.expiry_date && new Date(details.expiry_date) < new Date()
  const budgetUsedPercent = details ? Math.round((details.amount_used_cents / details.maximum_amount_cents) * 100) : 0

  return (
    <div className="border rounded-lg p-4 bg-background">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-sage-600" />
          <h4 className="font-medium">PAE</h4>
          {isExpired && (
            <Badge variant="error" className="text-xs">
              {t('externalPayers.status.expired')}
            </Badge>
          )}
          {budgetUsedPercent >= 80 && !isExpired && (
            <Badge variant="warning" className="text-xs">
              {t('externalPayers.status.budgetLow')}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="h-4 w-4" />
        </Button>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-foreground-secondary">{t('externalPayers.pae.fileNumber')}</dt>
        <dd className="font-medium">{details?.file_number || '—'}</dd>

        <dt className="text-foreground-secondary">{t('externalPayers.pae.provider')}</dt>
        <dd>{details?.pae_provider_name || '—'}</dd>

        {details?.employer_name && (
          <>
            <dt className="text-foreground-secondary">{t('externalPayers.pae.employer')}</dt>
            <dd>{details.employer_name}</dd>
          </>
        )}

        <dt className="text-foreground-secondary">{t('externalPayers.pae.fileOpeningFee')}</dt>
        <dd>{details?.file_opening_fee ? t('common.yes') : t('common.no')}</dd>

        <dt className="text-foreground-secondary">{t('externalPayers.pae.reimbursementPercentage')}</dt>
        <dd>{details?.reimbursement_percentage ?? 0}%</dd>

        <dt className="text-foreground-secondary">{t('externalPayers.pae.maximumAmount')}</dt>
        <dd className="font-medium">{formatCurrency(details?.maximum_amount_cents || 0)}</dd>

        <dt className="text-foreground-secondary">{t('externalPayers.pae.expiryDate')}</dt>
        <dd className={isExpired ? 'text-wine-600' : ''}>{formatDate(details?.expiry_date)}</dd>
      </dl>

      {/* Coverage rules summary */}
      {details?.coverage_rules && details.coverage_rules.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border">
          <h5 className="text-xs font-medium text-foreground-secondary mb-2">
            {t('externalPayers.pae.coverageRules')}
          </h5>
          <div className="text-sm text-foreground-muted">
            {formatCoverageRulesSummary(details.coverage_rules as PAECoverageRule[])}
          </div>
        </div>
      )}

      {/* Budget tracking */}
      <div className="mt-3 pt-3 border-t border-border">
        <h5 className="text-xs font-medium text-foreground-secondary mb-2">
          {t('externalPayers.pae.budgetUsage')}
        </h5>
        <div className="flex items-center gap-4 text-sm">
          <div>
            <span className="text-foreground-secondary">{t('externalPayers.pae.appointmentsUsed')}:</span>{' '}
            <span className="font-medium">{details?.appointments_used || 0}</span>
          </div>
          <div>
            <span className="text-foreground-secondary">{t('externalPayers.pae.amountUsed')}:</span>{' '}
            <span className="font-medium">{formatCurrency(details?.amount_used_cents || 0)}</span>
          </div>
        </div>
        {/* Progress bar */}
        <div className="mt-2 h-2 bg-background-secondary rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${budgetUsedPercent >= 80 ? 'bg-wine-500' : 'bg-sage-500'}`}
            style={{ width: `${Math.min(budgetUsedPercent, 100)}%` }}
          />
        </div>
        <p className="text-xs text-foreground-muted mt-1 italic">
          {t('externalPayers.pae.budgetNote')}
        </p>
      </div>
    </div>
  )
}

// =============================================================================
// HELPERS
// =============================================================================

function formatCoverageRulesSummary(rules: PAECoverageRule[]): string {
  if (!rules || rules.length === 0) return '—'

  const sortedRules = [...rules].sort((a, b) => a.order - b.order)
  const summaryParts: string[] = []

  for (const rule of sortedRules) {
    switch (rule.type) {
      case 'free_appointments':
        summaryParts.push(`${rule.appointment_count} rendez-vous gratuits`)
        break
      case 'shared_cost':
        summaryParts.push(`puis ${rule.pae_percentage}% PAE / ${100 - rule.pae_percentage}% client`)
        break
      case 'fixed_client_amount':
        summaryParts.push(`puis client paie ${(rule.client_amount_cents / 100).toFixed(2)}$`)
        break
      case 'included_services':
        summaryParts.push(`services inclus: ${rule.services.join(', ')}`)
        break
    }
  }

  return summaryParts.join(' → ')
}

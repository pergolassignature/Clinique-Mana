import { useState } from 'react'
import { FileCheck, Plus, AlertCircle, CheckCircle, Clock } from 'lucide-react'
import { t } from '@/i18n'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import { AccordionItem, AccordionTrigger, AccordionContent } from '@/shared/ui/accordion'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import type { ClientWithRelations, ConsentStatus } from '../../types'
import { AddConsentDialog, type ConsentFormData } from './edit-dialogs'

interface ConsentsSectionProps {
  client: ClientWithRelations
  onAddConsent?: (consent: ConsentFormData) => void
}

export function ConsentsSection({ client, onAddConsent }: ConsentsSectionProps) {
  const [addConsentOpen, setAddConsentOpen] = useState(false)
  const consents = client.consents || []

  const formatDate = (date: string | null) => {
    if (!date) return '—'
    return formatClinicDateShort(date)
  }

  const getStatusIcon = (status: ConsentStatus) => {
    switch (status) {
      case 'valid':
        return <CheckCircle className="h-4 w-4 text-sage-500" />
      case 'expired':
        return <Clock className="h-4 w-4 text-honey-500" />
      case 'missing':
        return <AlertCircle className="h-4 w-4 text-wine-500" />
    }
  }

  const getStatusBadge = (status: ConsentStatus) => {
    switch (status) {
      case 'valid':
        return <Badge className="bg-sage-100 text-sage-700 text-xs">Valide</Badge>
      case 'expired':
        return <Badge className="bg-honey-100 text-honey-700 text-xs">Expire</Badge>
      case 'missing':
        return <Badge className="bg-wine-100 text-wine-700 text-xs">Manquant</Badge>
    }
  }

  const handleAddConsent = (data: ConsentFormData) => {
    console.log('Add consent:', data)
    onAddConsent?.(data)
  }

  // Check if any consent is missing or expired
  const hasMissingOrExpired = consents.some(c => c.status === 'missing' || c.status === 'expired')

  return (
    <>
      <AccordionItem value="consents" className="border rounded-lg px-4">
        <AccordionTrigger className="hover:no-underline">
          <div className="flex items-center gap-2">
            <FileCheck className="h-4 w-4 text-sage-500" />
            <span>{t('clients.drawer.sections.consents')}</span>
            {hasMissingOrExpired && (
              <AlertCircle className="h-4 w-4 text-wine-500 ml-1" />
            )}
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-4">
            {/* Warning banner if missing/expired */}
            {hasMissingOrExpired && (
              <div className="p-3 rounded-lg bg-wine-50 border border-wine-200">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-wine-500 mt-0.5" />
                  <p className="text-sm text-wine-800">
                    Un ou plusieurs consentements necessitent votre attention.
                  </p>
                </div>
              </div>
            )}

            {/* Add consent button */}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setAddConsentOpen(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              {t('clients.drawer.consents.addConsent')}
            </Button>

            {/* Consents list */}
            {consents.length > 0 ? (
              <ul className="space-y-3">
                {consents.map(consent => (
                  <li
                    key={consent.id}
                    className={cn(
                      'p-3 rounded-lg border',
                      consent.status === 'valid' && 'border-sage-200 bg-sage-50/50',
                      consent.status === 'expired' && 'border-honey-200 bg-honey-50/50',
                      consent.status === 'missing' && 'border-wine-200 bg-wine-50/50'
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-2">
                        {getStatusIcon(consent.status)}
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {consent.type}
                          </p>
                          {consent.signedAt && (
                            <p className="text-xs text-foreground-secondary mt-1">
                              Signé le {formatDate(consent.signedAt)}
                              {consent.signedBy && ` par ${consent.signedBy}`}
                            </p>
                          )}
                          {consent.expiresAt && consent.status !== 'missing' && (
                            <p className="text-xs text-foreground-muted mt-1">
                              {consent.status === 'expired' ? 'Expiré' : 'Expire'} le {formatDate(consent.expiresAt)}
                            </p>
                          )}
                        </div>
                      </div>
                      {getStatusBadge(consent.status)}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-foreground-muted italic py-2">
                {t('clients.drawer.consents.noConsents')}
              </p>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* Add Consent Dialog */}
      <AddConsentDialog
        open={addConsentOpen}
        onOpenChange={setAddConsentOpen}
        onSave={handleAddConsent}
      />
    </>
  )
}

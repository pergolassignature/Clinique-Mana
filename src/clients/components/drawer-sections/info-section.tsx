import { useState } from 'react'
import { User, Phone, MapPin, Briefcase } from 'lucide-react'
import { differenceInYears } from 'date-fns'
import { t } from '@/i18n'
import { formatInClinicTimezone, toClinicTime } from '@/shared/lib/timezone'
import { AccordionItem, AccordionTrigger, AccordionContent } from '@/shared/ui/accordion'
import type { ClientWithRelations } from '../../types'
import {
  EditButton,
  EditIdentityDialog,
  EditContactDialog,
  EditAddressDialog,
  EditProfessionalDialog,
  type IdentityFormData,
  type ContactFormData,
  type AddressFormData,
} from './edit-dialogs'
import { useProfessionals } from '../../hooks'

interface InfoSectionProps {
  client: ClientWithRelations
  onUpdate?: (updates: Partial<ClientWithRelations>) => void
}

export function InfoSection({ client, onUpdate }: InfoSectionProps) {
  // Dialog states
  const [editIdentityOpen, setEditIdentityOpen] = useState(false)
  const [editContactOpen, setEditContactOpen] = useState(false)
  const [editAddressOpen, setEditAddressOpen] = useState(false)
  const [editProfessionalOpen, setEditProfessionalOpen] = useState(false)

  const { data: professionals = [] } = useProfessionals()

  const formatDate = (date: string | null) => {
    if (!date) return '—'
    return formatInClinicTimezone(date, 'dd MMMM yyyy')
  }

  const calculateAge = (birthDate: string | null) => {
    if (!birthDate) return null
    // Use clinic timezone for consistent age calculation
    return differenceInYears(new Date(), toClinicTime(birthDate))
  }

  const formatPhone = (countryCode: string, phone: string | null, extension?: string | null) => {
    if (!phone) return null

    let formatted: string

    // If phone is already in E.164 format (starts with +), format it nicely
    if (phone.startsWith('+')) {
      // Format E.164 number: +14185551234 -> +1 (418) 555-1234
      const digits = phone.slice(1) // Remove the +
      if (digits.length === 11 && digits.startsWith('1')) {
        // North American number
        const area = digits.slice(1, 4)
        const first = digits.slice(4, 7)
        const last = digits.slice(7, 11)
        formatted = `+1 (${area}) ${first}-${last}`
      } else if (digits.length === 10) {
        // 10 digit number without country code stored
        const area = digits.slice(0, 3)
        const first = digits.slice(3, 6)
        const last = digits.slice(6, 10)
        formatted = `${countryCode} (${area}) ${first}-${last}`
      } else {
        // Other format, just display as-is
        formatted = phone
      }
    } else {
      // Legacy format: prepend country code
      formatted = `${countryCode} ${phone}`
    }

    if (extension) formatted += ` ext. ${extension}`
    return formatted
  }

  const formatAddress = () => {
    const parts: string[] = []

    if (client.streetNumber || client.streetName) {
      parts.push([client.streetNumber, client.streetName].filter(Boolean).join(' '))
    }
    if (client.apartment) {
      parts[0] = `${parts[0]}, app. ${client.apartment}`
    }
    if (client.city) {
      parts.push(client.city)
    }
    if (client.province) {
      const lastPart = parts[parts.length - 1]
      if (lastPart) {
        parts[parts.length - 1] = `${lastPart} (${client.province})`
      }
    }
    if (client.postalCode) {
      parts.push(client.postalCode)
    }
    if (client.country && client.country !== 'Canada') {
      parts.push(client.country)
    }

    return parts.length > 0 ? parts.join('\n') : null
  }

  // Handlers for saving edits
  const handleSaveIdentity = (data: IdentityFormData) => {
    console.log('Save identity:', data)
    onUpdate?.(data)
  }

  const handleSaveContact = (data: ContactFormData) => {
    console.log('Save contact:', data)
    onUpdate?.(data)
  }

  const handleSaveAddress = (data: AddressFormData) => {
    console.log('Save address:', data)
    onUpdate?.(data)
  }

  const handleSaveProfessional = (professionalId: string | null) => {
    console.log('Save professional:', professionalId)
    const professional = professionalId
      ? professionals.find((p: { id: string; displayName: string }) => p.id === professionalId) || null
      : null
    onUpdate?.({
      primaryProfessionalId: professionalId,
      primaryProfessional: professional,
    })
  }

  const cellPhone = formatPhone(client.cellPhoneCountryCode, client.cellPhone)
  const homePhone = formatPhone(client.homePhoneCountryCode, client.homePhone)
  const workPhone = formatPhone(client.workPhoneCountryCode, client.workPhone, client.workPhoneExtension)
  const address = formatAddress()

  return (
    <>
      <AccordionItem value="info" className="border rounded-lg px-4">
        <AccordionTrigger className="hover:no-underline">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-sage-500" />
            <span>{t('clients.drawer.sections.info')}</span>
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-6">
            {/* Identity */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-foreground-secondary">
                  {t('clients.drawer.info.identity')}
                </h4>
                <EditButton onClick={() => setEditIdentityOpen(true)} />
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {client.sex && (
                  <>
                    <dt className="text-foreground-secondary">{t('clients.drawer.info.sex')}</dt>
                    <dd className="text-foreground">{t(`clients.sex.${client.sex}`)}</dd>
                  </>
                )}
                <dt className="text-foreground-secondary">{t('clients.drawer.info.language')}</dt>
                <dd className="text-foreground">
                  {client.language === 'fr' ? 'Francais' : client.language === 'en' ? 'English' : 'Autre'}
                </dd>
                <dt className="text-foreground-secondary">{t('clients.drawer.info.birthday')}</dt>
                <dd className="text-foreground font-medium">
                  {formatDate(client.birthday)}
                  {calculateAge(client.birthday) !== null && (
                    <span className="text-foreground-secondary font-normal ml-1">
                      ({calculateAge(client.birthday)} ans)
                    </span>
                  )}
                </dd>
              </dl>
            </div>

            {/* Contact */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-foreground-secondary flex items-center gap-2">
                  <Phone className="h-4 w-4" />
                  {t('clients.drawer.info.contact')}
                </h4>
                <EditButton onClick={() => setEditContactOpen(true)} />
              </div>
              <dl className="space-y-2 text-sm">
                {client.email && (
                  <div className="flex justify-between">
                    <dt className="text-foreground-secondary">Courriel</dt>
                    <dd>
                      <a
                        href={`mailto:${client.email}`}
                        className="text-sage-600 hover:text-sage-700 hover:underline"
                      >
                        {client.email}
                      </a>
                    </dd>
                  </div>
                )}
                {cellPhone && (
                  <div className="flex justify-between">
                    <dt className="text-foreground-secondary">Cellulaire</dt>
                    <dd>
                      <a
                        href={`tel:${client.cellPhone}`}
                        className="text-sage-600 hover:text-sage-700 hover:underline"
                      >
                        {cellPhone}
                      </a>
                    </dd>
                  </div>
                )}
                {homePhone && (
                  <div className="flex justify-between">
                    <dt className="text-foreground-secondary">Domicile</dt>
                    <dd>
                      <a
                        href={`tel:${client.homePhone}`}
                        className="text-sage-600 hover:text-sage-700 hover:underline"
                      >
                        {homePhone}
                      </a>
                    </dd>
                  </div>
                )}
                {workPhone && (
                  <div className="flex justify-between">
                    <dt className="text-foreground-secondary">Travail</dt>
                    <dd>
                      <a
                        href={`tel:${client.workPhone}`}
                        className="text-sage-600 hover:text-sage-700 hover:underline"
                      >
                        {workPhone}
                      </a>
                    </dd>
                  </div>
                )}
                {!client.email && !cellPhone && !homePhone && !workPhone && (
                  <p className="text-foreground-muted italic">Aucune coordonnee</p>
                )}
              </dl>
            </div>

            {/* Address */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-foreground-secondary flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  {t('clients.drawer.info.address')}
                </h4>
                <EditButton onClick={() => setEditAddressOpen(true)} />
              </div>
              {address ? (
                <p className="text-sm text-foreground whitespace-pre-line">{address}</p>
              ) : (
                <p className="text-sm text-foreground-muted italic">Aucune adresse</p>
              )}
            </div>

            {/* Professional */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-foreground-secondary flex items-center gap-2">
                  <Briefcase className="h-4 w-4" />
                  {t('clients.drawer.info.professional')}
                </h4>
                <EditButton onClick={() => setEditProfessionalOpen(true)} />
              </div>
              {client.primaryProfessional ? (
                <p className="text-sm text-foreground font-medium">
                  {client.primaryProfessional.displayName}
                </p>
              ) : (
                <p className="text-sm text-foreground-muted italic">Aucun professionnel assigne</p>
              )}
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* Edit Dialogs */}
      <EditIdentityDialog
        client={client}
        open={editIdentityOpen}
        onOpenChange={setEditIdentityOpen}
        onSave={handleSaveIdentity}
      />
      <EditContactDialog
        client={client}
        open={editContactOpen}
        onOpenChange={setEditContactOpen}
        onSave={handleSaveContact}
      />
      <EditAddressDialog
        client={client}
        open={editAddressOpen}
        onOpenChange={setEditAddressOpen}
        onSave={handleSaveAddress}
      />
      <EditProfessionalDialog
        client={client}
        open={editProfessionalOpen}
        onOpenChange={setEditProfessionalOpen}
        onSave={handleSaveProfessional}
        professionals={professionals}
      />
    </>
  )
}

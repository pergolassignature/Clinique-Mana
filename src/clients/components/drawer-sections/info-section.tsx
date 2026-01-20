import { User, Phone, MapPin, Briefcase } from 'lucide-react'
import { format, differenceInYears } from 'date-fns'
import { fr } from 'date-fns/locale'
import { t } from '@/i18n'
import { AccordionItem, AccordionTrigger, AccordionContent } from '@/shared/ui/accordion'
import type { ClientWithRelations } from '../../types'

interface InfoSectionProps {
  client: ClientWithRelations
}

export function InfoSection({ client }: InfoSectionProps) {
  const formatDate = (date: string | null) => {
    if (!date) return '—'
    return format(new Date(date), 'dd MMMM yyyy', { locale: fr })
  }

  const calculateAge = (birthDate: string | null) => {
    if (!birthDate) return null
    return differenceInYears(new Date(), new Date(birthDate))
  }

  const formatPhone = (countryCode: string, phone: string | null, extension?: string | null) => {
    if (!phone) return null
    let formatted = `${countryCode} ${phone}`
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

  const cellPhone = formatPhone(client.cellPhoneCountryCode, client.cellPhone)
  const homePhone = formatPhone(client.homePhoneCountryCode, client.homePhone)
  const workPhone = formatPhone(client.workPhoneCountryCode, client.workPhone, client.workPhoneExtension)
  const address = formatAddress()

  return (
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
            <h4 className="text-sm font-medium text-foreground-secondary mb-3">
              {t('clients.drawer.info.identity')}
            </h4>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {client.birthFirstName && (
                <>
                  <dt className="text-foreground-secondary">{t('clients.drawer.info.birthFirstName')}</dt>
                  <dd className="text-foreground">{client.birthFirstName}</dd>
                </>
              )}
              {client.pronouns && (
                <>
                  <dt className="text-foreground-secondary">{t('clients.drawer.info.pronouns')}</dt>
                  <dd className="text-foreground">{client.pronouns}</dd>
                </>
              )}
              {client.sex && (
                <>
                  <dt className="text-foreground-secondary">{t('clients.drawer.info.sex')}</dt>
                  <dd className="text-foreground">{t(`clients.sex.${client.sex}`)}</dd>
                </>
              )}
              <dt className="text-foreground-secondary">{t('clients.drawer.info.language')}</dt>
              <dd className="text-foreground">
                {client.language === 'fr' ? 'Français' : client.language === 'en' ? 'English' : 'Autre'}
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
            <h4 className="text-sm font-medium text-foreground-secondary mb-3 flex items-center gap-2">
              <Phone className="h-4 w-4" />
              {t('clients.drawer.info.contact')}
            </h4>
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
                <p className="text-foreground-muted italic">Aucune coordonnée</p>
              )}
            </dl>
          </div>

          {/* Address */}
          <div>
            <h4 className="text-sm font-medium text-foreground-secondary mb-3 flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              {t('clients.drawer.info.address')}
            </h4>
            {address ? (
              <p className="text-sm text-foreground whitespace-pre-line">{address}</p>
            ) : (
              <p className="text-sm text-foreground-muted italic">Aucune adresse</p>
            )}
          </div>

          {/* Professional */}
          <div>
            <h4 className="text-sm font-medium text-foreground-secondary mb-3 flex items-center gap-2">
              <Briefcase className="h-4 w-4" />
              {t('clients.drawer.info.professional')}
            </h4>
            {client.primaryProfessional ? (
              <p className="text-sm text-foreground font-medium">
                {client.primaryProfessional.displayName}
              </p>
            ) : (
              <p className="text-sm text-foreground-muted italic">Aucun professionnel assigné</p>
            )}
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}

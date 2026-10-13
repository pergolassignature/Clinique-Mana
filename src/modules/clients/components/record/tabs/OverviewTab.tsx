import { t } from '@/i18n'
import { DescriptionList } from '@/shared/components/DescriptionList'
import { SectionSurface, SettingsCard } from '@/shared/components/SettingsCard'
import { formatDateOnlyFull, formatClinicDateShort } from '@/shared/lib/timezone'
import { useClientRecordData } from '../record-context'
import { clientNumberLabel, languageLabel, phoneLabel, relationTypeLabel, sexLabel } from '../../../lib/display'

const O = 'modules.clients.record.overview'
const F = 'modules.clients.fields'

/**
 * « Aperçu » (UI-3: a read-only view): who the person is, how to reach her and on which channels,
 * who acts for her (the main contact and the relations holding a right), the professionals who
 * see her file, the staff notes. Changes are made in « Informations », « Proches », « Assurance et
 * payeurs ».
 */
export function OverviewTab() {
  const { summary, reference } = useClientRecordData()
  const { client } = summary
  const channels = [client.remindersBySms && t(`${O}.bySms`), client.remindersByEmail && t(`${O}.byEmail`)].filter(Boolean).join(', ')
  const main = summary.relations.find((r) => r.relatedRights.main_contact)
  const proName = (id: string) => reference.professionals.find((p) => p.id === id)?.name ?? t(`${O}.formerProfessional`)
  return (
    <SectionSurface>
      <SettingsCard as="section" layout="section" title={t(`${O}.person`)}>
        <DescriptionList
          items={[
            { label: t(`${F}.number`), value: clientNumberLabel(client.clientNumber) },
            { label: t(`${F}.birthday`), value: client.birthday && formatDateOnlyFull(client.birthday) },
            { label: t(`${F}.sex`), value: client.sex && sexLabel(client.sex) },
            { label: t(`${F}.pronouns`), value: client.pronouns },
            { label: t(`${F}.birthFirstName`), value: client.birthFirstName },
            { label: t(`${F}.language`), value: languageLabel(client.language) },
          ]}
        />
      </SettingsCard>
      <SettingsCard as="section" layout="section" title={t(`${O}.reach`)}>
        <DescriptionList
          items={[
            { label: t(`${F}.email`), value: client.email },
            { label: t(`${F}.mobile`), value: phoneLabel(client.mobile) },
            { label: t(`${F}.home`), value: phoneLabel(client.home) },
            { label: t(`${F}.work`), value: client.work && [phoneLabel(client.work), client.workExt && t(`${O}.ext`, { ext: client.workExt })].filter(Boolean).join(' ') },
            { label: t(`${O}.reminders`), value: channels, empty: t(`${O}.noReminders`) },
            {
              label: t(`${O}.address`),
              value: [client.addressLine1, client.addressLine2, [client.city, client.province, client.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', '),
            },
          ]}
        />
      </SettingsCard>
      <SettingsCard as="section" layout="section" title={t(`${O}.actsFor`)}>
        <DescriptionList
          items={[
            { label: t(`${O}.mainContact`), value: main && `${main.relatedName} (${relationTypeLabel(main.type)})`, empty: t(`${O}.noMainContact`) },
            {
              label: t(`${O}.managesAppointments`),
              value: summary.relations.filter((r) => r.relatedRights.manages_appointments).map((r) => r.relatedName).join(', '),
              empty: t(`${O}.nobody`),
            },
            {
              label: t(`${O}.receivesInvoices`),
              value: summary.relations.filter((r) => r.relatedRights.receives_invoices).map((r) => r.relatedName).join(', '),
              empty: t(`${O}.onlyClient`),
            },
          ]}
        />
      </SettingsCard>
      <SettingsCard as="section" layout="section" title={t(`${O}.file`)}>
        <DescriptionList
          items={[
            { label: t(`${F}.primaryProfessional`), value: client.primaryProfessionalId && proName(client.primaryProfessionalId), empty: t(`${F}.none`) },
            {
              label: t(`${O}.seenBy`),
              value: summary.professionals.map((p) => proName(p.professionalId)).join(', '),
              empty: t(`${O}.nobody`),
            },
            { label: t(`${F}.referralSource`), value: reference.referralSources.find((s) => s.id === client.referralSourceId)?.name },
            { label: t(`${F}.referredBy`), value: client.referredBy },
            { label: t(`${O}.openedOn`), value: formatClinicDateShort(client.createdAt) },
            { label: t(`${F}.adminNotes`), value: summary.adminNotes && <span className="whitespace-pre-line">{summary.adminNotes}</span>, empty: t(`${O}.noNotes`) },
          ]}
        />
      </SettingsCard>
    </SectionSurface>
  )
}

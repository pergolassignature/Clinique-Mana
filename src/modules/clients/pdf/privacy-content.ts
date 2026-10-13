import { t } from '@/i18n'
import { formatClinicDateTime, formatDateOnlyFull } from '@/shared/lib/timezone'
import type { ClientsReference } from '../api/clients'
import type { ClientExport, ClientSummary } from '../api/parse'
import { RELATION_RIGHTS } from '../lib/constants'
import {
  centsLabel,
  clientNumberLabel,
  fullName,
  holderRelationLabel,
  languageLabel,
  payerKindLabel,
  phoneLabel,
  rateVariantLabel,
  relationTypeLabel,
  rightLabel,
  sexLabel,
} from '../lib/display'

/**
 * The Loi 25 export's content (plan C4.2), pure: every section of `export_client_privacy` as
 * labelled lines, in French, for the PDF (`PrivacyDocument`). Empty values read « Non indiqué »;
 * a section with nothing reads « Aucun ». No id is printed: names, numbers and dates only.
 */

export interface PrivacyLine {
  label: string
  value: string
}
export interface PrivacySection {
  title: string
  /** Groups of lines (one per relation, insurance, payer, consent…); empty → « Aucun ». */
  groups: PrivacyLine[][]
}
export interface PrivacyContent {
  title: string
  subtitle: string
  clinic: string
  exportedOn: string
  sections: PrivacySection[]
  /** The files merged into this one, each as its own sections. */
  merged: { heading: string; sections: PrivacySection[] }[]
}

const P = 'modules.clients.privacy.pdf'
const F = 'modules.clients.fields'
const yes = (value: boolean) => t(value ? `${P}.yes` : `${P}.no`)
const line = (label: string, value: string | null | undefined): PrivacyLine => ({ label, value: value && value.trim() ? value : t(`${P}.notGiven`) })

/** What the export prints about one file (the file itself, or one merged into it). */
function fileSections(summary: ClientSummary, reference: ClientsReference | undefined): PrivacySection[] {
  const c = summary.client
  const nameOf = (options: readonly { id: string; name: string }[] | undefined, id: string | null) => (id ? (options?.find((o) => o.id === id)?.name ?? null) : null)
  // The country alone (the default « CA ») is not an address.
  const address = c.addressLine1 || c.city || c.postalCode ? [c.addressLine1, c.addressLine2, c.city, c.province, c.postalCode, c.country].filter(Boolean).join(', ') : null
  return [
    {
      title: t(`${P}.identity`),
      groups: [
        [
          line(t(`${F}.number`), clientNumberLabel(c.clientNumber)),
          line(t(`${F}.firstName`), c.firstName),
          line(t(`${F}.lastName`), c.lastName),
          line(t(`${F}.birthFirstName`), c.birthFirstName),
          line(t(`${F}.pronouns`), c.pronouns),
          line(t(`${F}.sex`), c.sex && sexLabel(c.sex)),
          line(t(`${F}.birthday`), c.birthday && formatDateOnlyFull(c.birthday)),
          line(t(`${F}.language`), languageLabel(c.language)),
        ],
      ],
    },
    {
      title: t(`${P}.contact`),
      groups: [
        [
          line(t(`${F}.email`), c.email),
          line(t(`${F}.mobile`), c.mobile && phoneLabel(c.mobile)),
          line(t(`${F}.home`), c.home && phoneLabel(c.home)),
          line(t(`${F}.work`), c.work && [phoneLabel(c.work), c.workExt].filter(Boolean).join(' ')),
          line(t(`${F}.remindersBySms`), yes(c.remindersBySms)),
          line(t(`${F}.remindersByEmail`), yes(c.remindersByEmail)),
          line(t(`${P}.address`), address),
        ],
      ],
    },
    {
      title: t(`${P}.file`),
      groups: [
        [
          line(t(`${F}.referralSource`), nameOf(reference?.referralSources, c.referralSourceId)),
          line(t(`${F}.referredBy`), c.referredBy),
          line(t(`${F}.customField`), c.customField),
          line(t(`${F}.primaryProfessional`), nameOf(reference?.professionals, c.primaryProfessionalId)),
          line(t(`${F}.rateVariant`), c.rateVariant ? rateVariantLabel(c.rateVariant) : t(`${F}.regularRate`)),
          line(t(`${F}.taxExempt`), yes(c.taxExempt)),
          line(t(`${F}.specialAgreement`), yes(c.specialAgreement)),
          line(t(`${F}.sharedCustody`), yes(c.sharedCustody)),
          line(t(`${P}.openedOn`), formatClinicDateTime(c.createdAt)),
          line(t(`${P}.archivedOn`), c.archivedAt && formatClinicDateTime(c.archivedAt)),
        ],
      ],
    },
    {
      title: t(`${P}.notes`),
      groups:
        summary.adminNotes || summary.specialAgreementNote
          ? [[line(t(`${F}.adminNotes`), summary.adminNotes), line(t(`${F}.specialAgreementNote`), summary.specialAgreementNote)]]
          : [],
    },
    {
      title: t(`${P}.relations`),
      groups: summary.relations.map((r) => [
        line(t(`${P}.person`), `${r.relatedName} (${clientNumberLabel(r.relatedNumber)})`),
        line(t(`${P}.relation`), relationTypeLabel(r.type)),
        line(t(`${P}.theirRights`), RELATION_RIGHTS.filter((k) => r.relatedRights[k]).map(rightLabel).join(', ') || t(`${P}.none`)),
        line(t(`${P}.ownRights`), RELATION_RIGHTS.filter((k) => r.clientRights[k]).map(rightLabel).join(', ') || t(`${P}.none`)),
      ]),
    },
    {
      title: t(`${P}.insurances`),
      groups: summary.insurances.map((i) => [
        line(t(`${P}.rank`), t(i.rank === 1 ? `${P}.mainInsurance` : `${P}.secondaryInsurance`)),
        line(t(`${P}.insurer`), i.insurer),
        line(t(`${P}.policy`), i.policyNumber),
        line(t(`${P}.certificate`), i.certificateNumber),
        line(t(`${P}.holder`), [holderRelationLabel(i.holderRelation), i.holderName].filter(Boolean).join(' · ')),
      ]),
    },
    {
      title: t(`${P}.payers`),
      groups: summary.payers.map((x) => [
        line(t(`${P}.payerKind`), [payerKindLabel(x.kind), x.organisationName].filter(Boolean).join(' · ')),
        line(t(`${P}.fileNumber`), x.fileNumber),
        line(t(`${P}.sessionAmount`), x.sessionAmountCents !== null ? centsLabel(x.sessionAmountCents) : null),
        line(t(`${P}.period`), [x.startsOn && formatDateOnlyFull(x.startsOn), x.expiresOn && formatDateOnlyFull(x.expiresOn)].filter(Boolean).join(' – ')),
        line(t(`${P}.state`), t(x.isActive ? `${P}.active` : `${P}.ended`)),
        line(t(`${P}.note`), x.note),
      ]),
    },
    { title: t(`${P}.tags`), groups: summary.tags.length > 0 ? [[line(t(`${P}.tags`), summary.tags.map((tag) => tag.name).join(', '))]] : [] },
    {
      title: t(`${P}.professionals`),
      groups: summary.professionals.map((p) => [
        line(t(`${P}.professional`), nameOf(reference?.professionals, p.professionalId) ?? t(`${P}.formerProfessional`)),
        line(t(`${P}.since`), formatClinicDateTime(p.firstLinkedAt)),
      ]),
    },
  ]
}

/** Builds the export's content. `clinic` is the clinic's name (the access's `org_name`). */
export function buildPrivacyContent(data: ClientExport, reference: ClientsReference | undefined, clinic: string): PrivacyContent {
  const c = data.summary.client
  const consents: PrivacySection = {
    title: t(`${P}.consents`),
    groups: data.consents.map((x) => [
      line(t(`${P}.consent`), x.name),
      line(t(`${P}.version`), x.version),
      line(t(`${P}.signedOn`), formatClinicDateTime(x.signedAt)),
      line(t(`${P}.signedBy`), x.signers.join(', ')),
      line(t(`${P}.state`), x.withdrawnAt ? t(`${P}.withdrawn`, { date: formatClinicDateTime(x.withdrawnAt) }) : x.supersededAt ? t(`${P}.superseded`) : t(`${P}.inForce`)),
      ...(x.withdrawalNote ? [line(t(`${P}.note`), x.withdrawalNote)] : []),
    ]),
  }
  return {
    title: t(`${P}.title`),
    subtitle: `${fullName(c)} · ${clientNumberLabel(c.clientNumber)}`,
    clinic,
    exportedOn: formatClinicDateTime(data.exportedAt),
    sections: [...fileSections(data.summary, reference), consents],
    merged: data.mergedFiles.map((m) => ({
      heading: t(`${P}.mergedFile`, { client: `${fullName(m.client)} (${clientNumberLabel(m.client.clientNumber)})` }),
      sections: fileSections(m, reference),
    })),
  }
}

/**
 * Helvetica (react-pdf's built-in face) draws Windows-1252 only: the export's French is in it,
 * but a narrow or thin space, a non-breaking hyphen or a character from another script would print
 * garbled. Those spaces and hyphens become plain ones; anything else outside it becomes « ? ».
 */
const WIN_1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')
export function toWinAnsi(text: string): string {
  return Array.from(text.replace(/[\u2009\u202F\u2007]/g, ' ').replace(/[\u2010\u2011]/g, '-'))
    .map((ch) => (ch.charCodeAt(0) <= 0xff || WIN_1252_EXTRA.has(ch) ? ch : '?'))
    .join('')
}

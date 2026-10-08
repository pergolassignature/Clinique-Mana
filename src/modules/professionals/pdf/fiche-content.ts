import { t } from '@/i18n'
import { formatPhone } from '@/shared/lib/format'
import type { PublicFee } from '../api/fiche'
import type { ProfessionalRecord } from '../api/parse'
import { titleOrder, type CatalogView } from '../lib/catalog-view'
import { fullName, minClientAgeLabel } from '../lib/display'
import { ficheProfession } from '../lib/fiche'
import { matchingDigest } from '../lib/matching-digest'

/**
 * What the fiche prints (Task 4c.5 « Content », A2.19), already in words: the document only lays
 * it out. Pure, so `fiche-content.test.ts` checks every rule without rendering a PDF.
 */

/** The clinic identity the fiche prints (`organizations`, Settings → Identité légale). */
export interface FicheClinic {
  name: string
  /** E.164, as stored. */
  phone: string | null
  email: string | null
  website: string | null
}

/**
 * One motif category on paper: its name, then every motif held in it, by name (P4-211: the
 * staff screens' summaries, « Tous » and counts, never reach the client's document).
 */
export interface FicheMotifGroup {
  name: string
  /** The held active motifs, in the catalogue's order. */
  names: string[]
}

/** A clientèle; `specialized` is the record's ★, printed first and marked. */
export interface FicheItem {
  label: string
  specialized: boolean
}

export interface FicheContent {
  clinic: {
    /** The clinic's name: the PDF's author metadata only; the logo stands for it on the page (P4-214). */
    name: string
    /** Phone, email and website, as printed (empty ones left out). */
    contact: string[]
    /**
     * The logo printed in the band: the one uploaded in Settings (a data URL), else Clinique
     * MANA's full lockup bundled with the renderer (`brand`: placed by its known margins). Never
     * the clinic's name in text (P4-214).
     */
    logo: { src: string; brand: boolean }
    /** The website without its scheme, for the footer. */
    website: string | null
  }
  name: string
  /** The chosen title (one fiche per title, A2.19); null without one. */
  title: string | null
  /** « Membre de l’OPQ · N° de permis 08417 » (the clinic's public profiles); null for a title without an order. */
  credential: string | null
  /** The public email and phone (« Profil public »), null when neither is set. */
  publicContact: string | null
  /** The photo as a data URL: the slot 4c fills (P4-202); null → the initials monogram. */
  photo: string | null
  /** « GT », the monogram drawn in the photo's place while there is none (P4-214). */
  initials: string
  /**
   * « À propos »: the presentation of « Profil public », as paragraphs (blank lines split them);
   * empty → not printed. The free-text « Approche » is not printed (P4-216).
   */
  about: string[]
  motifs: FicheMotifGroup[]
  /** The youngest held age group reads the youngest client age: « Adolescents (14 ans et +) » (P4-245). */
  clienteles: FicheItem[]
  /**
   * The client limits the website shows under the clientèles, in the record's words (P4-245):
   * « Âge minimum : 14 ans » when no held age group carries the age, « Femmes seulement ».
   */
  clientLimits: string[]
  languages: string[]
  /**
   * « Honoraires »: the clinic's public fees, one line per duration as the website words them
   * (« Rencontre 50 min : 175 $ »), the client prices of the retention grid in force today for
   * the fiche's title (P4-218); null → « À confirmer ». Never a retention or a pay.
   */
  fees: string[] | null
  /** « 8 octobre 2026 », the day it was made, in the clinic's timezone. */
  generatedOn: string
}

export interface FicheInput {
  record: ProfessionalRecord
  catalog: CatalogView
  /** The title the fiche is for; null or unknown → the primary one. */
  titleId: string | null
  clinic: FicheClinic
  /** The logo uploaded in Settings as a data URL, or null. */
  logo: string | null
  /** Clinique MANA's bundled lockup (`MANA_LOGO_URL`), printed when Settings has no logo. */
  brandLogo: string
  photo: string | null
  /** The client prices of the fiche's title (`get_professional_public_fees`); empty → « À confirmer ». */
  fees: readonly PublicFee[]
  generatedOn: string
  /**
   * Whether the fonts can draw a character (`loadFicheFonts`). Others are dropped from every text
   * (after trying their base letter), so nothing falls back to a font that prints them garbled.
   */
  canDraw?: (codePoint: number) => boolean
}

const SEPARATOR = ' · '
const F = 'modules.professionals.fiche.pdf'

/** C0 and C1 control characters but the line break (a tab becomes a space first). */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g

/**
 * Text as the fonts can draw it: NFC, line breaks as `\n`, control characters out, the narrow
 * no-break space (French « : ») as a no-break space (Raleway's latin subset has no U+202F), and any
 * other character the fonts lack replaced by its base letter (« ǹ » → « n ») or dropped (emoji).
 */
export function toPdfText(text: string, canDraw: (codePoint: number) => boolean = () => true): string {
  const normal = text.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(CONTROL, '').replace(/\u202f/g, '\u00a0')
  let out = ''
  for (const char of normal) {
    if (char === '\n' || canDraw(char.codePointAt(0) ?? 0)) {
      out += char
      continue
    }
    const base = char.normalize('NFD').charAt(0)
    if (base !== char && canDraw(base.codePointAt(0) ?? 0)) out += base
  }
  return out
}

/** Free text as paragraphs: trimmed, blank lines between them, empty → none. */
function paragraphs(text: string | null, clean: (s: string) => string): string[] {
  if (!text) return []
  return clean(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
}

/** « https://www.cliniquemana.ca/ » → « www.cliniquemana.ca ». */
export function displayWebsite(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '')
}

/** « Geneviève Tremblay » → « GT », « Marc-André Pelletier » → « MP », « Étienne » → « É ». */
export function initialsOf(firstName: string, lastName: string): string {
  const first = (word: string) => [...word.trim()][0] ?? ''
  return (first(firstName) + first(lastName)).toLocaleUpperCase('fr-CA')
}

/** The website's order: the individual sessions, then the couple or family one. */
const FEE_ORDER = [50, 30, 60] as const

const wholeDollars = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 0 })
const centsDollars = new Intl.NumberFormat('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** A public fee as the website writes it: `17500` → « 175 $ », `12177` → « 121,77 $ » (a no-break space before the sign). */
export function formatPublicFee(cents: number): string {
  const amount = cents % 100 === 0 ? wholeDollars.format(cents / 100) : centsDollars.format(cents / 100)
  return `${amount}\u00a0$`
}

/** « Rencontre 50 min : 175 $ », 50 then 30 then 60 min; none → null (« À confirmer »). */
export function feeLines(fees: readonly PublicFee[]): string[] | null {
  const lines = FEE_ORDER.flatMap((duration) => {
    const fee = fees.find((f) => f.duration === duration)
    return fee ? [t(`${F}.feeLine`, { duration: t(`${F}.feeDurations.${duration}`), price: formatPublicFee(fee.clientPriceCents) })] : []
  })
  return lines.length > 0 ? lines : null
}

export function buildFicheContent({ record, catalog, titleId, clinic, logo, brandLogo, photo, fees, generatedOn, canDraw }: FicheInput): FicheContent {
  const clean = (s: string) => toPdfText(s, canDraw)
  const profession = ficheProfession(record, titleId)
  const title = profession ? (catalog.byId.titles.get(profession.titleId) ?? null) : null
  const order = profession ? titleOrder(catalog, profession.titleId) : null
  const credential = order
    ? [
        // « l’ » before a vowel (every Québec order: « Ordre … » → OPQ, OTSTCFQ…).
        t(/^[aeiouyh]/i.test(order.acronym) ? `${F}.memberElided` : `${F}.member`, { acronym: order.acronym }),
        profession?.licenceNumber ? `${order.licenceLabel}\u00a0${profession.licenceNumber}` : null,
      ]
        .filter(Boolean)
        .join(SEPARATOR)
    : null

  const { publicEmail, publicPhone } = record.publicProfile
  const publicContact = [publicEmail, publicPhone ? formatPhone(publicPhone) : null].filter(Boolean).join(SEPARATOR)

  const digest = matchingDigest(record, catalog)
  // Archived items are the clinic's past wording: never printed for a client (P4-211).
  const current = (items: typeof digest.clienteles): FicheItem[] =>
    items.filter((i) => !i.archived).map((i) => ({ label: clean(i.label), specialized: i.specialized }))
  const motifs = digest.motifs.groups.map(
    (group): FicheMotifGroup => ({ name: clean(group.name), names: group.motifs.filter((m) => !m.archived).map((m) => clean(m.name)) }),
  )

  const website = clinic.website ? displayWebsite(clinic.website) : null
  return {
    clinic: {
      name: clean(clinic.name),
      contact: [clinic.phone ? formatPhone(clinic.phone) : null, clinic.email, website].filter((v): v is string => Boolean(v)).map(clean),
      logo: logo ? { src: logo, brand: false } : { src: brandLogo, brand: true },
      website: website ? clean(website) : null,
    },
    name: clean(fullName(record.professional)),
    title: title ? clean(title.name) : null,
    credential: credential ? clean(credential) : null,
    publicContact: publicContact ? clean(publicContact) : null,
    photo,
    initials: clean(initialsOf(record.professional.firstName, record.professional.lastName)),
    // The free-text « Approche » is not printed (P4-216).
    about: paragraphs(record.publicProfile.bio, clean),
    motifs,
    clienteles: current(digest.clienteles),
    clientLimits: [
      digest.minClientAge !== null ? minClientAgeLabel(digest.minClientAge) : null,
      digest.womenOnly ? t('modules.professionals.display.womenOnly') : null,
    ]
      .filter((line): line is string => line !== null)
      .map(clean),
    languages: digest.languages.filter((l) => !l.archived).map((l) => clean(l.label)),
    fees: feeLines(fees)?.map(clean) ?? null,
    generatedOn,
  }
}

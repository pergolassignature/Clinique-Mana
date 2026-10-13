// The rows the import sends (plan §9, I1): a client record of `readClients` → `import_client`'s JSON,
// and the reviewed relations file → `import_client_relation`'s. Pure.
import { readTable } from './table.mjs'
import { foldText, parseYesNo } from './normalize.mjs'

const COUNTRIES = new Map([
  ['', 'CA'], ['ca', 'CA'], ['can', 'CA'], ['canada', 'CA'],
  ['us', 'US'], ['usa', 'US'], ['etats-unis', 'US'], ['etats unis', 'US'], ['united states', 'US'],
  ['fr', 'FR'], ['france', 'FR'], ['be', 'BE'], ['belgique', 'BE'], ['ch', 'CH'], ['suisse', 'CH'],
])

/** « Canada » → CA, « États-Unis » → US, a two-letter code as is; else null (unknown). */
export function countryCode(value) {
  const key = foldText(value)
  if (COUNTRIES.has(key)) return COUNTRIES.get(key)
  return /^[a-z]{2}$/.test(key) ? key.toUpperCase() : null
}

export const PAYLOAD_REASON_LABELS = {
  unknown_country: 'pays non reconnu (Canada par défaut)',
  unknown_primary_professional: 'professionnel principal absent du fichier des employés (laissé vide)',
}

/**
 * `import_client`'s row for one record of `readClients`, and the reasons to flag (codes).
 * `professionalFor(label)` → `{ id }`, `{ excluded }` or null (no employees file: always null).
 */
export function clientPayload(record, professionalFor = () => null) {
  const flags = []
  const country = countryCode(record.address.country ?? '')
  if (country === null) flags.push('unknown_country')
  let primary = null
  if (record.primary_professional_label) {
    const pro = professionalFor(record.primary_professional_label)
    if (pro?.id) primary = pro.id
    else if (!pro?.excluded) flags.push('unknown_primary_professional')
  }
  const notes = record.tagNotes ?? []
  const row = {
    external_ref: record.externalRef,
    first_name: record.first_name,
    last_name: record.last_name,
    sex: record.sex,
    birthday: record.birthday,
    email: record.email,
    mobile_e164: record.mobile_e164,
    home_e164: record.home_e164,
    work_e164: record.work_e164,
    work_ext: record.work_ext,
    language: record.language,
    address_line1: record.address.line1,
    address_line2: record.address.line2,
    city: record.address.city,
    province: record.address.province,
    postal_code: record.address.postal_code,
    country: country ?? 'CA',
    referred_by: record.referred_by,
    primary_professional_id: primary,
    archived: record.archived,
    ...record.tagFields,
    ...(notes.length > 0 && { special_agreement_note: `${notes.join(', ')} (étiquette GOrendezvous)` }),
    tags: record.freeTags,
    insurance: record.insurance,
  }
  return { row, flags }
}

// --- Relations -------------------------------------------------------------------------------------

/**
 * The relations file, prepared and reviewed by the clinic (GOrendezvous's clients export has no
 * family links): one line per pair, by GOrendezvous ClientId, what the related person is to the
 * client, and what she may do for the client.
 */
export const RELATION_COLUMNS = {
  client: ['Client', 'ClientId', 'Client (ClientId)', 'Id client'],
  related: ['Proche', 'Proche (ClientId)', 'RelatedClientId', 'Related'],
  type: ['Lien', 'Type', 'Relation'],
  mainContact: ['Contact principal', 'Principal', 'Main contact'],
  managesAppointments: ['Gère les rendez-vous', 'Gere les rendez-vous et formulaires', 'Rendez-vous', 'Manages appointments'],
  receivesCommunications: ['Reçoit les communications', 'Communications', 'Receives communications'],
  receivesInvoices: ['Reçoit les factures', 'Factures', 'Receives invoices'],
}

/** French (and English) relation words → C2's types (what the related person is to the client). */
export const RELATION_TYPES = new Map([
  ['parent', 'parent'], ['pere', 'parent'], ['mere', 'parent'],
  ['enfant', 'child'], ['fils', 'child'], ['fille', 'child'], ['child', 'child'],
  ['tuteur', 'guardian'], ['tutrice', 'guardian'], ['guardian', 'guardian'],
  ['pupille', 'ward'], ['ward', 'ward'],
  ['conjoint', 'spouse'], ['conjointe', 'spouse'], ['spouse', 'spouse'],
  ['frere', 'sibling'], ['soeur', 'sibling'], ['fratrie', 'sibling'], ['sibling', 'sibling'],
  ['autre', 'other'], ['other', 'other'],
])

export const RELATION_REASON_LABELS = {
  missing_ids: 'ClientId du client ou du proche manquant',
  same_person: 'le client et le proche sont la même fiche',
  unknown_type: 'lien non reconnu (parent, enfant, tuteur, pupille, conjoint, fratrie, autre)',
  invalid_right: 'droit : oui ou non',
  duplicate_pair: 'paire déjà vue plus haut',
}

/** Reads the relations file → `{ relations: [{ line, row }], rejected }` (rows for import_client_relation). */
export function readRelations(text) {
  const { rows } = readTable(text, { columns: RELATION_COLUMNS, required: ['client', 'related', 'type'] })
  const relations = []
  const rejected = []
  const pairs = new Set()
  for (const row of rows) {
    const reasons = []
    const client = row.get('client')
    const related = row.get('related')
    if (client === '' || related === '') reasons.push('missing_ids')
    else if (client === related) reasons.push('same_person')
    const type = RELATION_TYPES.get(foldText(row.get('type')).replace(/œ/g, 'oe'))
    if (!type) reasons.push('unknown_type')
    const right = (field) => {
      const value = parseYesNo(row.get(field))
      if (value === null) reasons.push('invalid_right')
      return value === true
    }
    const rights = {
      main_contact: right('mainContact'),
      manages_appointments: right('managesAppointments'),
      receives_communications: right('receivesCommunications'),
      receives_invoices: right('receivesInvoices'),
    }
    const pair = [client, related].sort().join('|')
    if (reasons.length === 0 && pairs.has(pair)) reasons.push('duplicate_pair')
    if (reasons.length > 0) {
      rejected.push({ line: row.line, reasons: [...new Set(reasons)] })
      continue
    }
    pairs.add(pair)
    relations.push({
      line: row.line,
      row: { client_ref: `gorendezvous:${client}`, related_ref: `gorendezvous:${related}`, type, related_rights: rights, client_rights: {} },
    })
  }
  return { relations, rejected }
}

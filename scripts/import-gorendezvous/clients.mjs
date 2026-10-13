// The GOrendezvous clients export (« Exporter mes clients », liste globale; tour notes §11) → client
// records for `private.import_client` (plan §6.2, §9). Pure: text in, records and issues out.
import { mapTags, splitTags } from './tags.mjs'
import { readTable } from './table.mjs'
import {
  normalizeEmail,
  normalizeLanguage,
  normalizeName,
  normalizePostalCode,
  normalizeProvince,
  normalizeSex,
  parseDateOnly,
  parseYesNo,
  toE164,
} from './normalize.mjs'

/**
 * The export's columns (tour notes §11: ClientId, FirstName, LastName, Email, Sex, Language,
 * Cell/Home/WorkPhone with their country codes, WorkPhoneExtension, StreetNumber…, birthday, last
 * appointment), with the French forms the clinic may meet. Tags, archived and the primary
 * professional are « à vérifier » in the tour notes: read when present.
 */
export const CLIENT_COLUMNS = {
  clientId: ['ClientId', 'Client ID', 'Id client', 'Numéro de client'],
  firstName: ['FirstName', 'First Name', 'Prénom'],
  lastName: ['LastName', 'Last Name', 'Nom', 'Nom de famille'],
  email: ['Email', 'E-mail', 'Courriel'],
  sex: ['Sex', 'Gender', 'Sexe'],
  language: ['Language', 'Langue'],
  cellPhone: ['CellPhone', 'Cell Phone', 'Mobile', 'Cellulaire'],
  cellPhoneCountryCode: ['CellPhoneCountryCode', 'Cell Phone Country Code'],
  homePhone: ['HomePhone', 'Home Phone', 'Téléphone maison', 'Maison'],
  homePhoneCountryCode: ['HomePhoneCountryCode', 'Home Phone Country Code'],
  workPhone: ['WorkPhone', 'Work Phone', 'Téléphone travail', 'Travail'],
  workPhoneCountryCode: ['WorkPhoneCountryCode', 'Work Phone Country Code'],
  workPhoneExtension: ['WorkPhoneExtension', 'Work Phone Extension', 'Poste'],
  streetNumber: ['StreetNumber', 'Street Number', 'Numéro civique'],
  streetName: ['StreetName', 'Street Name', 'Street', 'Rue'],
  apartment: ['Apartment', 'Suite', 'Unit', 'Appartement'],
  city: ['City', 'Ville'],
  province: ['Province', 'State', 'Region'],
  country: ['Country', 'Pays'],
  postalCode: ['PostalCode', 'Postal Code', 'ZipCode', 'Code postal'],
  birthday: ['Birthday', 'BirthDate', 'Birth Date', 'DateOfBirth', 'Anniversaire', 'Date de naissance'],
  lastAppointment: ['LastAppointment', 'Last Appointment', 'LastAppointmentDate', 'Dernier rendez-vous'],
  tags: ['Tags', 'Étiquettes'],
  archived: ['Archived', 'IsArchived', 'Archivé'],
  primaryProfessional: ['PrimaryProfessional', 'Primary Professional', 'Professionnel principal'],
  referredBy: ['ReferredBy', 'Referred By', 'Référé par'],
  // The main insurance, when the export carries it (« à vérifier »: the first export confirms, I-2).
  insurer: ['Insurance', 'InsuranceCompany', 'Insurance Company', 'Insurer', 'Assurance', 'Assureur', 'Compagnie d’assurance', "Compagnie d'assurance"],
  policyNumber: ['PolicyNumber', 'Policy Number', 'Numéro de police', 'No de police', 'Police'],
  certificateNumber: ['CertificateNumber', 'Certificate Number', 'MemberId', 'Member ID', 'Numéro de certificat', 'Certificat'],
}

/** The fields without which the file is refused. */
export const CLIENT_REQUIRED = ['clientId', 'firstName', 'lastName']

/**
 * Reasons a row is rejected (not imported) or flagged (imported, the value left out), as codes;
 * `REASON_LABELS` gives the report's French. Never a value.
 */
export const REASON_LABELS = {
  missing_client_id: 'ClientId manquant',
  duplicate_client_id: 'ClientId déjà vu plus haut dans le fichier',
  missing_name: 'prénom et nom manquants',
  invalid_email: 'courriel illisible (laissé vide)',
  invalid_cell_phone: 'cellulaire illisible (laissé vide)',
  invalid_home_phone: 'téléphone maison illisible (laissé vide)',
  invalid_work_phone: 'téléphone travail illisible (laissé vide)',
  invalid_birthday: 'date de naissance illisible (laissée vide)',
  future_birthday: 'date de naissance dans le futur (laissée vide)',
  invalid_last_appointment: 'date du dernier rendez-vous illisible (laissée vide)',
  invalid_sex: 'sexe non reconnu (laissé vide)',
  invalid_language: 'langue non reconnue (français par défaut)',
  invalid_archived: 'archivé : valeur non reconnue (actif)',
  rate_conflict: 'étiquettes « Tarif étudiant » et « Tarif réduit » ensemble (tarif à choisir)',
  free_tags_over_limit: 'plus de 5 étiquettes libres (les 5 premières gardées)',
  unknown_tag: 'étiquette inconnue (gardée comme étiquette libre)',
}

/**
 * Reads the clients export. `today` (« YYYY-MM-DD », the clinic's date) bounds a birthday.
 * Returns `{ clients, rejected, columns }`:
 * - `clients`: one record per kept row: `line`, `externalRef` (« gorendezvous:<ClientId> »), the
 *   `clients` fields (names, `sex`, `birthday`, `email`, `mobile_e164`, `home_e164`, `work_e164`,
 *   `work_ext`, `language`, the address, `archived`, `last_appointment_on`, `referred_by`,
 *   `primary_professional_label`, `insurance`), the tag mapping (`tagFields`, `tagNotes`, `payers`,
 *   `freeTags`) and `flags`
 *   (reason codes for the values left out);
 * - `rejected`: `{ line, reasons }` for the rows not imported;
 * - `columns`: the fields found and the headers not read.
 */
export function readClients(text, { today }) {
  const table = readTable(text, { columns: CLIENT_COLUMNS, required: CLIENT_REQUIRED })
  const clients = []
  const rejected = []
  const seenIds = new Set()
  for (const row of table.rows) {
    const reasons = []
    const flags = []
    const id = row.get('clientId')
    if (id === '') reasons.push('missing_client_id')
    else if (seenIds.has(id)) reasons.push('duplicate_client_id')
    const firstName = normalizeName(row.get('firstName'))
    const lastName = normalizeName(row.get('lastName'))
    if (!firstName && !lastName) reasons.push('missing_name')
    if (reasons.length > 0) {
      rejected.push({ line: row.line, reasons })
      continue
    }
    seenIds.add(id)

    const optional = (field, parse, flag) => {
      const cell = row.get(field)
      if (cell === '') return null
      const value = parse(cell)
      if (value === null) flags.push(flag)
      return value
    }
    const phone = (field, flag) => {
      const cell = row.get(field)
      if (cell === '') return null
      const value = toE164(cell, row.get(`${field}CountryCode`))
      if (value === null) flags.push(flag)
      return value
    }
    let birthday = optional('birthday', parseDateOnly, 'invalid_birthday')
    if (birthday && today && birthday > today) {
      flags.push('future_birthday')
      birthday = null
    }
    let language = optional('language', normalizeLanguage, 'invalid_language')
    language ??= 'fr'
    let archived = false
    if (row.get('archived') !== '') {
      const value = parseYesNo(row.get('archived'))
      if (value === null) flags.push('invalid_archived')
      else archived = value
    }
    const tags = mapTags(splitTags(row.get('tags')))
    flags.push(...tags.issues)
    if (tags.unknown.length > 0) flags.push('unknown_tag')

    clients.push({
      line: row.line,
      externalRef: `gorendezvous:${id}`,
      first_name: firstName ?? '',
      last_name: lastName ?? '',
      sex: optional('sex', normalizeSex, 'invalid_sex'),
      birthday,
      email: optional('email', normalizeEmail, 'invalid_email'),
      mobile_e164: phone('cellPhone', 'invalid_cell_phone'),
      home_e164: phone('homePhone', 'invalid_home_phone'),
      work_e164: phone('workPhone', 'invalid_work_phone'),
      work_ext: row.get('workPhoneExtension').replace(/[^0-9]/g, '') || null,
      language,
      address: {
        line1: [row.get('streetNumber'), row.get('streetName')].filter(Boolean).join(' ') || null,
        line2: row.get('apartment') || null,
        city: row.get('city') || null,
        province: normalizeProvince(row.get('province')),
        postal_code: normalizePostalCode(row.get('postalCode')),
        country: row.get('country') || null,
      },
      archived,
      last_appointment_on: optional('lastAppointment', parseDateOnly, 'invalid_last_appointment'),
      referred_by: row.get('referredBy') || null,
      primary_professional_label: row.get('primaryProfessional') || null,
      insurance: row.get('insurer')
        ? { insurer: row.get('insurer'), policy_number: row.get('policyNumber') || null, certificate_number: row.get('certificateNumber') || null }
        : null,
      tagFields: tags.fields,
      tagNotes: tags.notes,
      payers: tags.payers,
      freeTags: tags.freeTags,
      unknownTags: tags.unknown,
      flags,
    })
  }
  return { clients, rejected, columns: { found: table.fields, unused: table.unused } }
}

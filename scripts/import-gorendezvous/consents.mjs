// The signed consents (I2 prep): GOrendezvous's consent forms export (one row per client and form
// signed) → rows for Clients' `import_client_consent(row, dry_run)`. Pure: no file, no database.
// The export's columns are not documented: the aliases are the on-screen labels (decision I-2).
// **The report never prints a value from the file** (decision I-6).
import { readTable } from './table.mjs'
import { foldText, normalizeName, parseDateOnly } from './normalize.mjs'

export const CONSENT_COLUMNS = {
  clientId: ['ClientId', 'Client Id', 'Id du client', 'No client', 'N° client GOrendezvous'],
  client: ['Client', 'Nom du client', 'Client Name'],
  form: ['Formulaire', 'Consentement', 'Nom du formulaire', 'Form', 'Consent'],
  signedOn: ['Signé le', 'Date de signature', 'Date', 'Signed on', 'Signed'],
  version: ['Version', 'Version du formulaire'],
  signer: ['Signé par', 'Signataire', 'Signed by', 'Signer'],
}

/**
 * The clinic's 7 consents (CC-2) by the names GOrendezvous gives its forms (folded, any part of the
 * label): the first match wins, so the specific ones come first.
 */
const CONSENT_KEYS = [
  ['waitlist', /liste d.?attente|waiting ?list/],
  ['file_transfer', /transfert/],
  ['intern', /stagiaire|intern/],
  ['coaching', /coaching/],
  ['naturopathy', /naturopath/],
  ['eap', /\bpae\b|eap|programme d.?aide/],
  ['general', /general|consentement aux services|consent to (care|services)/],
]

export const consentKeyFor = (label) => CONSENT_KEYS.find(([, pattern]) => pattern.test(foldText(label).replace(/[’]/g, "'")))?.[0] ?? null

export const CONSENT_REASON_LABELS = {
  missing_client: 'client manquant',
  unknown_form: 'formulaire qui n’est pas un des 7 consentements de la clinique',
  invalid_signed_on: 'date de signature illisible (attendu AAAA-MM-JJ)',
  duplicate_consent: 'même client et même consentement plus haut (la signature la plus récente est gardée)',
}

/**
 * The export → `{ consents, rejected }`. A client's same consent twice keeps the latest signature
 * (the earlier line is set aside, `duplicate_consent`). `signed_at`: noon, clinic time, on the day
 * signed (the export holds the day only).
 */
export function readConsents(text) {
  const { rows } = readTable(text, { columns: CONSENT_COLUMNS, required: ['client', 'form', 'signedOn'] })
  const kept = new Map()
  const rejected = []
  for (const row of rows) {
    const reasons = []
    const client = normalizeName(row.get('client'))
    if (!client) reasons.push('missing_client')
    const key = consentKeyFor(row.get('form'))
    if (!key) reasons.push('unknown_form')
    const signedOn = parseDateOnly(row.get('signedOn'))
    if (!signedOn) reasons.push('invalid_signed_on')
    if (reasons.length > 0) {
      rejected.push({ line: row.line, reasons })
      continue
    }
    const clientId = /^[0-9A-Za-z_-]{1,40}$/.test(row.get('clientId')) ? row.get('clientId') : null
    const record = {
      line: row.line,
      signedOn,
      row: {
        client_ref: clientId ? `gorendezvous:${clientId}` : null,
        client_name: client,
        consent_key: key,
        signed_at: `${signedOn}T12:00:00-05:00`,
        version_label: row.get('version') || null,
        signer_name: normalizeName(row.get('signer')),
      },
    }
    const id = `${clientId ?? foldText(client)}|${key}`
    const previous = kept.get(id)
    if (!previous) kept.set(id, record)
    else if (previous.signedOn < signedOn) {
      rejected.push({ line: previous.line, reasons: ['duplicate_consent'] })
      kept.set(id, record)
    } else rejected.push({ line: row.line, reasons: ['duplicate_consent'] })
  }
  return { consents: [...kept.values()].sort((a, b) => a.line - b.line), rejected }
}

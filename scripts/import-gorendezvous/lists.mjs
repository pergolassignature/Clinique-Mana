// Two smaller exports (tour notes §8, §9, §11): the waitlist (« Liste d'attente » → Exporter, per
// professional; empty for every account checked on 2026-10-11, §18: the real waitlist is the fake
// « Inscription – Liste attente » appointments, read in I2 from the support's appointment export)
// and the « Annulations / clients à relancer » report (Impressions → Exporter), for Demandes and
// Rapports. Headers as shown on screen; confirmed by the first real export (decision I-2).
import { readTable } from './table.mjs'
import { foldText, normalizeName, parseDateOnly } from './normalize.mjs'

export const WAITLIST_COLUMNS = {
  client: ['Client', 'Nom du client'],
  professional: ['Professionnel', 'Professionnelle', 'Employé', 'Professional'],
  service: ['Service'],
  priority: ['Priorité', 'Priority'],
  availability: ['Disponibilités', 'Disponibilité', 'Availability'],
  validUntil: ['Valide jusqu’au', "Valide jusqu'au", 'Validité', 'Valid until', 'Expiration'],
  createdOn: ['Date', 'Ajouté le', 'Date d’ajout', "Date d'ajout", 'Created'],
  secondPerson: ['Deuxième personne', 'Second person'],
  notes: ['Notes', 'Note'],
}

export const CANCELLATION_COLUMNS = {
  appointmentDate: ['Date', 'Date du rendez-vous', 'Rendez-vous', 'Appointment Date'],
  client: ['Client', 'Nom du client'],
  professional: ['Professionnel', 'Professionnelle', 'Employé', 'Professional'],
  service: ['Service'],
  reason: ['Raison', 'Motif', 'Raison de l’annulation', "Raison de l'annulation", 'Reason'],
  cancelledOn: ['Annulé le', 'Date d’annulation', "Date d'annulation", 'Cancelled on'],
  cancelledBy: ['Annulé par', 'Cancelled by'],
}

export const LIST_REASON_LABELS = {
  missing_client: 'client manquant',
  invalid_date: 'date illisible',
  invalid_valid_until: 'date de validité illisible (laissée vide)',
  invalid_priority: 'priorité illisible (laissée vide)',
}

/** The waitlist export → `{ entries, rejected }`. One entry per row; deduplicated per client and target in I2. */
export function readWaitlist(text) {
  const { rows } = readTable(text, { columns: WAITLIST_COLUMNS, required: ['client'] })
  const entries = []
  const rejected = []
  for (const row of rows) {
    const client = normalizeName(row.get('client'))
    if (!client) {
      rejected.push({ line: row.line, reasons: ['missing_client'] })
      continue
    }
    const flags = []
    let validUntil = null
    if (row.get('validUntil') !== '') {
      validUntil = parseDateOnly(row.get('validUntil'))
      if (!validUntil) flags.push('invalid_valid_until')
    }
    let priority = null
    if (row.get('priority') !== '') {
      priority = Number(row.get('priority'))
      if (!Number.isInteger(priority)) {
        priority = null
        flags.push('invalid_priority')
      }
    }
    entries.push({
      line: row.line,
      client,
      professional: row.get('professional') || null,
      service: row.get('service') || null,
      priority,
      availability: row.get('availability') || null,
      valid_until: validUntil,
      created_on: parseDateOnly(row.get('createdOn')),
      second_person: row.get('secondPerson') || null,
      notes: row.get('notes') || null,
      flags,
    })
  }
  return { entries, rejected }
}

/** The cancellations / clients to call back export → `{ cancellations, rejected, reasons }` (`reasons`: the count per cancellation reason, the clinic's labels). */
export function readCancellations(text) {
  const { rows } = readTable(text, { columns: CANCELLATION_COLUMNS, required: ['appointmentDate', 'client'] })
  const cancellations = []
  const rejected = []
  const reasons = new Map()
  for (const row of rows) {
    const issues = []
    const date = parseDateOnly(row.get('appointmentDate'))
    if (!date) issues.push('invalid_date')
    const client = normalizeName(row.get('client'))
    if (!client) issues.push('missing_client')
    if (issues.length > 0) {
      rejected.push({ line: row.line, reasons: issues })
      continue
    }
    const reason = row.get('reason') || null
    if (reason) reasons.set(foldText(reason), (reasons.get(foldText(reason)) ?? 0) + 1)
    cancellations.push({
      line: row.line,
      appointment_on: date,
      client,
      professional: row.get('professional') || null,
      service: row.get('service') || null,
      reason,
      cancelled_on: parseDateOnly(row.get('cancelledOn')),
      cancelled_by: row.get('cancelledBy') || null,
    })
  }
  return { cancellations, rejected, reasons: Object.fromEntries(reasons) }
}

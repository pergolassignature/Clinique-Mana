// The appointments import (I2): support's appointment export → one row per appointment for
// Rendez-vous' `import_appointment(row, dry_run)`, and the waiting list GOrendezvous kept as fake
// « Inscription – Liste attente » appointments (tour notes §18) → rows for Demandes'
// `import_waitlist_entry(row, dry_run)`. Pure: no file, no database.
//
// The export's columns are not known yet (support sends it at the cutover): the aliases below are
// GOrendezvous's on-screen labels in French and English; the first real export confirms them
// (decision I-2), and only this table should need to change. Notes are never read (D8): no column
// of the export but those below is looked at.
//
// **The report never prints a value from the file** (decision I-6): line numbers, counts, months
// and French reasons only.
import { createHash } from 'node:crypto'
import { readTable } from './table.mjs'
import { foldText, normalizeName, parseDateOnly } from './normalize.mjs'

export const APPOINTMENT_COLUMNS = {
  id: ['Id', 'Id du rendez-vous', 'No de rendez-vous', 'N° de rendez-vous', 'Numéro du rendez-vous', 'AppointmentId', 'Appointment Id', 'Appointment ID'],
  date: ['Date', 'Date du rendez-vous', 'Appointment Date', 'StartDate', 'Start Date'],
  start: ['Heure', 'Début', 'Heure de début', 'Start', 'Start Time', 'StartTime', 'From'],
  end: ['Fin', 'Heure de fin', 'End', 'End Time', 'EndTime', 'To'],
  duration: ['Durée', 'Durée (min)', 'Duration', 'Minutes'],
  clientId: ['ClientId', 'Client Id', 'Id du client', 'No client', 'N° client GOrendezvous'],
  client: ['Client', 'Nom du client', 'Client Name'],
  client2Id: ['ClientId 2', 'Client Id 2', 'Id du client 2', 'Second ClientId'],
  client2: ['Client 2', 'Deuxième client', 'Deuxième personne', 'Second client', 'Second person'],
  professional: ['Professionnel', 'Professionnelle', 'Employé', 'Intervenant', 'Agenda', 'Staff', 'Professional', 'Employee'],
  service: ['Service', 'Service / Produit', 'Nom du service', 'Service Name'],
  serviceCode: ['Code', 'Code du service', 'Service Code'],
  status: ['Statut', 'État', 'Status', 'State'],
  mode: ['Mode', 'Type de rendez-vous', 'Modalité', 'Location', 'Lieu'],
  cancelReason: ['Raison de l’annulation', "Raison de l'annulation", 'Motif d’annulation', "Motif d'annulation", 'Cancellation Reason', 'Raison'],
  cancelledOn: ['Annulé le', 'Date d’annulation', "Date d'annulation", 'Cancelled on', 'Cancellation Date'],
  videoUrl: ['Lien vidéo', 'Lien de la rencontre', 'Lien Zoom', 'Video Link', 'Meeting Link', 'Lien'],
}

export const APPOINTMENT_REASON_LABELS = {
  invalid_date: 'date illisible (attendu AAAA-MM-JJ)',
  invalid_time: 'heure de début illisible',
  invalid_end: 'heure de fin ou durée illisible',
  missing_client: 'client manquant',
  missing_professional: 'agenda (professionnel) manquant',
  unknown_employee: 'agenda absent du fichier des employés (--employees)',
  unknown_service: 'service sans code au catalogue (ajoutez-le au fichier des services)',
  unknown_status: 'statut inconnu',
  duplicate_appointment: 'rendez-vous en double dans l’export',
  admin_agenda: 'agenda administratif (conseillère, Bureau administratif) : pas une séance, laissé de côté',
  waitlist_cancelled: 'inscription à la liste d’attente annulée : laissée de côté',
  client_not_found: 'aucun dossier importé à ce nom (ajoutez son ClientId à l’export ou à --clients-map)',
  client_ambiguous: 'plusieurs dossiers importés à ce nom (départagez avec son ClientId)',
}

/** GOrendezvous's statuses (folded) → what the row says: cancelled, absent, confirmed, done, booked. */
const STATUSES = {
  annule: 'cancelled', annulee: 'cancelled', cancelled: 'cancelled', canceled: 'cancelled', 'annule par le client': 'cancelled',
  'annule par la clinique': 'cancelled', 'annulation tardive': 'cancelled',
  absent: 'absent', absente: 'absent', 'no show': 'absent', 'no-show': 'absent', 'ne s est pas presente': 'absent', 'ne s est pas presente(e)': 'absent',
  confirme: 'confirmed', confirmee: 'confirmed', confirmed: 'confirmed',
  present: 'done', presente: 'done', complete: 'done', completed: 'done', termine: 'done', terminee: 'done', arrive: 'done', arrivee: 'done', 'arrived': 'done',
  reserve: 'booked', reservee: 'booked', booked: 'booked', 'a confirmer': 'booked', 'en attente': 'booked', '': 'booked',
}

/** The fake appointments GOrendezvous used as its waiting list (« Inscription – Liste attente »). */
export const isWaitlistService = (label) => /liste ?d?'? ?attente|waiting ?list|waitlist/.test(foldText(label).replace(/[’]/g, "'"))

/** « 9:00 », « 09h00 », « 9 h 30 », « 9:00 AM », « 13:05:00 » → minutes after midnight, or null. */
export function parseTime(value) {
  const text = foldText(value).replace(/\s+/g, '')
  const match = /^([0-9]{1,2})(?:[:h]([0-9]{2}))?(?::([0-9]{2}))?(am|pm)?$/.exec(text)
  if (!match || (match[2] === undefined && !match[4] && !text.includes('h'))) return null
  let hours = Number(match[1])
  const minutes = Number(match[2] ?? 0)
  if (match[4]) {
    if (hours < 1 || hours > 12) return null
    hours = (hours % 12) + (match[4] === 'pm' ? 12 : 0)
  }
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/** A date cell that may hold its time too (« 2026-11-03 09:00 », « 2026-11-03T09:00:00 »): the time part, or null. */
const timeInDate = (value) => {
  const match = /^[0-9]{4}[-/.][0-9]{1,2}[-/.][0-9]{1,2}[ T](.+)$/.exec(String(value ?? '').trim())
  return match ? parseTime(match[1]) : null
}

const pad = (n) => String(n).padStart(2, '0')

/**
 * A clinic-time wall clock (date « YYYY-MM-DD », minutes after midnight) → an ISO instant with its
 * offset (`2026-11-03T09:00:00-05:00`), through the zone's own rules (both daylight-saving changes).
 */
export function clinicInstant(date, minutes, timeZone = 'America/Toronto') {
  const [y, m, d] = date.split('-').map(Number)
  const wall = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60)
  const offsetAt = (instant) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        .formatToParts(new Date(instant))
        .map((p) => [p.type, p.value]),
    )
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute)) - instant
  }
  let instant = wall - offsetAt(wall)
  instant = wall - offsetAt(instant)
  const offset = Math.round((wall - instant) / 60000)
  const sign = offset < 0 ? '-' : '+'
  const abs = Math.abs(offset)
  return `${date}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

const idRef = (id) => (/^[0-9A-Za-z_-]{1,40}$/.test(id) ? id : null)

/**
 * The export → `{ appointments, rejected }`, one record per row (the waiting list's fake ones
 * included, `waitlist: true`); `rejected`: `{ line, reasons }`. The appointment's reference is
 * GOrendezvous's id when the export has one, else a hash of its agenda, start and client (stable
 * from one export to the next, so a re-run resumes).
 */
export function readAppointments(text, { timeZone = 'America/Toronto' } = {}) {
  const { rows } = readTable(text, { columns: APPOINTMENT_COLUMNS, required: ['date', 'client', 'professional', 'service'] })
  const appointments = []
  const rejected = []
  const seen = new Set()
  for (const row of rows) {
    const reasons = []
    const date = parseDateOnly(row.get('date'))
    if (!date) reasons.push('invalid_date')
    const start = row.get('start') !== '' ? parseTime(row.get('start')) : timeInDate(row.get('date'))
    if (start === null) reasons.push('invalid_time')
    let end = null
    if (row.get('end') !== '') {
      end = parseTime(row.get('end')) ?? timeInDate(row.get('end'))
      if (end === null || (start !== null && end <= start)) reasons.push('invalid_end')
    } else if (row.get('duration') !== '') {
      const minutes = Number(row.get('duration').replace(/[^0-9]/g, ''))
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 720 || start === null) reasons.push('invalid_end')
      else end = start + minutes
    }
    const client = normalizeName(row.get('client'))
    if (!client) reasons.push('missing_client')
    const professional = row.get('professional')
    if (professional === '') reasons.push('missing_professional')
    const status = STATUSES[foldText(row.get('status')).replace(/[^a-z() -]/g, ' ').replace(/\s+/g, ' ').trim()]
    if (status === undefined) reasons.push('unknown_status')
    if (reasons.length > 0) {
      rejected.push({ line: row.line, reasons })
      continue
    }
    const clientId = idRef(row.get('clientId'))
    const ownId = idRef(row.get('id'))
    const key = ownId ?? createHash('sha256').update([foldText(professional), date, start, clientId ?? foldText(client)].join('|')).digest('hex').slice(0, 20)
    if (seen.has(key)) {
      rejected.push({ line: row.line, reasons: ['duplicate_appointment'] })
      continue
    }
    seen.add(key)
    const client2 = normalizeName(row.get('client2'))
    const client2Id = idRef(row.get('client2Id'))
    appointments.push({
      line: row.line,
      key,
      date,
      month: date.slice(0, 7),
      starts_at: clinicInstant(date, start, timeZone),
      ends_at: end === null ? null : end >= 24 * 60 ? null : clinicInstant(date, end, timeZone),
      professional,
      service: row.get('service'),
      service_code: /^[0-9]{5}$/.test(row.get('serviceCode')) ? row.get('serviceCode') : null,
      status,
      mode: /telephon|phone/.test(foldText(row.get('mode'))) ? 'phone' : 'video',
      clients: [
        { client_ref: clientId ? `gorendezvous:${clientId}` : null, client_name: client },
        ...(client2 || client2Id ? [{ client_ref: client2Id ? `gorendezvous:${client2Id}` : null, client_name: client2 }] : []),
      ],
      cancel_reason: row.get('cancelReason') || null,
      cancelled_on: parseDateOnly(row.get('cancelledOn')),
      video_url: /^https:\/\/\S+$/.test(row.get('videoUrl')) ? row.get('videoUrl') : null,
      waitlist: isWaitlistService(row.get('service')),
    })
  }
  return { appointments, rejected }
}

/**
 * The records → the two RPCs' rows. `professionalFor(label)` is the employees file's lookup
 * (`{ id }`, `{ excluded: true }`, or null); `codeFor(record)` the services file's (a catalogue
 * code or null); `now` the run's instant (what is history). Returns `{ appointments, waitlist,
 * setAside, rejected }`: `appointments`: `{ line, month, past, row }`; `waitlist`: `{ line, row }`,
 * oldest first per client (a request's date is its first registration); `setAside`: lines left
 * out on purpose (an administrative agenda, a cancelled registration), `{ line, reasons }`;
 * `rejected`: lines that stop a commit (an agenda or a service the mapping files do not resolve).
 */
export function buildAppointmentRows(records, { professionalFor = () => null, codeFor = (r) => r.service_code, now = new Date(), waitlistProfession = 'psychologue', feePaid = () => false } = {}) {
  const appointments = []
  const waitlist = []
  const setAside = []
  const rejected = []
  for (const r of records) {
    const agenda = professionalFor(r.professional)
    if (agenda === null) {
      rejected.push({ line: r.line, reasons: ['unknown_employee'] })
      continue
    }
    if (r.waitlist) {
      if (r.status === 'cancelled') {
        setAside.push({ line: r.line, reasons: ['waitlist_cancelled'] })
        continue
      }
      const client = r.clients[0]
      waitlist.push({
        line: r.line,
        startsAt: r.starts_at,
        row: {
          external_ref: `gorendezvous:attente:${r.key}`,
          client_ref: client.client_ref,
          client_name: client.client_name,
          ...(agenda.excluded ? { profession_key: waitlistProfession } : { professional_id: agenda.id }),
          registered_at: r.starts_at,
          fee_paid: feePaid(client) ? 'true' : 'false',
        },
      })
      continue
    }
    if (agenda.excluded) {
      setAside.push({ line: r.line, reasons: ['admin_agenda'] })
      continue
    }
    const code = codeFor(r)
    if (!code) {
      rejected.push({ line: r.line, reasons: ['unknown_service'] })
      continue
    }
    const past = new Date(r.starts_at).getTime() <= now.getTime()
    const state =
      r.status === 'cancelled' ? 'cancelled' : past ? 'completed' : r.status === 'confirmed' ? 'confirmed' : 'booked'
    appointments.push({
      line: r.line,
      month: r.month,
      past,
      row: {
        external_ref: `gorendezvous:rdv:${r.key}`,
        professional_id: agenda.id,
        service_code: code,
        clients: r.clients.map((c) => ({ client_ref: c.client_ref, client_name: c.client_name, ...(r.status === 'absent' && past ? { absent: 'true' } : {}) })),
        starts_at: r.starts_at,
        ends_at: r.ends_at,
        mode: r.mode,
        state,
        cancel_reason: state === 'cancelled' ? r.cancel_reason : null,
        cancelled_at: state === 'cancelled' && r.cancelled_on ? `${r.cancelled_on}T12:00:00Z` : null,
        video_url: !past && state !== 'cancelled' ? r.video_url : null,
      },
    })
  }
  // A request's date never changes: each client's registrations oldest first.
  waitlist.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  return { appointments, waitlist, setAside, rejected }
}

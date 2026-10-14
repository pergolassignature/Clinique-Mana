// Synthetic GOrendezvous exports shaped like the real ones (made-up people only), for a rehearsal
// of the whole import on the local stack (runbook « Répétition »): the clients export, the
// relations, the employees and services files, and the three « Revenus » exports, consistent with
// each other (18 clients with a homonym pair and an archived file; 40 invoices over three months,
// every payment mode, a refund, partial payments, a taxable line, an invoice for the homonyms, one
// for a person not in the export, one without lines; a payment without an invoice number; two
// invoices « Payé par » a relative, one allowed and one not), and for I2 the appointments (history
// and coming, an absence, a cancellation, a couple, a phone call, a video link, an overlap, the
// homonyms, the waiting list's fake appointments, an administrative agenda) and the consents.
//
//   node scripts/import-gorendezvous/synthetic-exports.mjs ~/Clinique-MANA-import/essai
//
// The directory must be outside this repository (the tool refuses files inside it).
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const out = process.argv[2]
if (!out) {
  console.error('Usage : node scripts/import-gorendezvous/synthetic-exports.mjs <dossier hors du dépôt>')
  process.exit(2)
}
mkdirSync(out, { recursive: true })
const repo = realpathSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'))
const rel = path.relative(repo, realpathSync(out))
if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
  console.error('Le dossier doit être hors du dépôt git (par exemple ~/Clinique-MANA-import/essai).')
  process.exit(2)
}
const write = (name, text) => writeFileSync(path.join(out, name), text, 'utf8')
const money = (cents) => `${(cents / 100).toFixed(2).replace('.', ',')} $`

// Clients: 18 people, a homonym pair, one archived, a few edge values.
const clients = []
for (let i = 1; i <= 16; i++) {
  const n = String(i).padStart(2, '0')
  clients.push({
    id: 9000 + i,
    first: ['Camille', 'Léa', 'Noah', 'Émile', 'Zoé', 'Félix', 'Rose', 'Jacob'][i % 8],
    last: `Essai-${n}`,
    email: `essai.${n}@exemple.test`,
    sex: i % 2 ? 'F' : 'M',
    cell: `51455501${n}`,
    birthday: `19${70 + i}-0${(i % 9) + 1}-1${i % 9}`,
    archived: i === 16 ? 'Oui' : 'Non',
    pro: i % 3 ? 'Pro Alpha' : 'Pro Beta',
  })
}
clients.push({ id: 9101, first: 'Sam', last: 'Homonyme', email: 'sam.a@exemple.test', sex: 'M', cell: '5145550191', birthday: '1985-01-01', archived: 'Non', pro: 'Pro Alpha' })
clients.push({ id: 9102, first: 'Sam', last: 'Homonyme', email: 'sam.b@exemple.test', sex: 'M', cell: '5145550192', birthday: '1986-02-02', archived: 'Non', pro: 'Pro Beta' })

const header = 'ClientId,FirstName,LastName,Email,Sex,Language,CellPhone,CellPhoneCountryCode,HomePhone,HomePhoneCountryCode,WorkPhone,WorkPhoneCountryCode,WorkPhoneExtension,StreetNumber,StreetName,Apartment,City,Province,Country,PostalCode,Birthday,LastAppointment,Tags,Archived,PrimaryProfessional'
write('clients.csv', ['Liste globale des clients (données fictives)', '', header,
  ...clients.map((c) => [c.id, c.first, c.last, c.email, c.sex, 'fr', c.cell, '1', '', '', '', '', '', '12', 'rue des Essais', '', 'Montréal', 'Québec', 'Canada', 'h2x1a1', c.birthday, '2026-09-30', '', c.archived, c.pro].join(','))].join('\n') + '\n')
write('liens.csv', 'Client;Proche;Lien;Contact principal;Gère les rendez-vous;Reçoit les communications;Reçoit les factures\n9003;9004;parent;oui;oui;oui;oui\n')
write('employes.csv', 'Employé;Professionnel;Exclure\nPro Alpha;Félix Gauthier;non\nPro Beta;Julie Morin;non\nconseillère;;oui\n')
write('services.csv', 'Service;Code\nPsychothérapie individuelle (ancien);10150\n')

// Invoices: 2026-08 to 2026-10, one or two lines, payments in every mode, a refund, a partial.
const invoices = []
const lines = []
const payments = []
let seq = 1200
const day = (m, d) => `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const named = clients.filter((c) => c.last.startsWith('Essai')).slice(0, 12)
const modes = ['Argent comptant', 'Interac', 'Accès D', 'Stripe', 'Chèque']
for (const [k, c] of named.entries()) {
  for (const m of [8, 9, 10]) {
    seq += 1
    const number = `2026-${String(seq).padStart(7, '0')}`
    const d = day(m, 3 + k)
    const pro = c.pro
    const items = [{ service: 'Psychothérapie individuelle 50 min', code: '10150', price: 13000 }]
    if (k % 4 === 0) items.push({ service: 'Psychothérapie individuelle (ancien)', code: '', price: 2500 })
    const subtotal = items.reduce((s, x) => s + x.price, 0)
    // « Payé par »: IVAC (an organisation); a parent with the right to the invoices (9003 ← 9004, liens.csv); a relative without it.
    const payer = k === 5 ? 'IVAC' : k === 2 && m === 10 ? 'Zoé Essai-04' : k === 8 && m === 10 ? 'Rose Essai-06' : ''
    invoices.push({ d, number, client: `${c.first} ${c.last}`, pro, subtotal, total: subtotal, payer })
    for (const x of items) lines.push({ d, number, client: `${c.first} ${c.last}`, pro, ...x })
    if (k % 6 !== 5) {
      const mode = modes[(k + m) % modes.length]
      const amount = k % 5 === 4 && m === 10 ? subtotal - 3000 : subtotal
      payments.push({ d, number, client: `${c.first} ${c.last}`, mode, amount })
      if (k === 2 && m === 9) payments.push({ d: day(m, 20), number, client: `${c.first} ${c.last}`, mode, amount: -2500 })
    }
  }
}
// A taxable sale (GST + QST), the homonyms, a client not in the export, an invoice without lines.
seq += 1
invoices.push({ d: day(10, 20), number: `2026-${String(seq).padStart(7, '0')}`, client: 'Camille Essai-08', pro: 'Pro Alpha', subtotal: 1891, gst: 95, qst: 189, total: 2175 })
lines.push({ d: day(10, 20), number: `2026-${String(seq).padStart(7, '0')}`, client: 'Camille Essai-08', pro: 'Pro Alpha', service: 'Inscription – Liste attente', code: '50100', price: 1891, gst: 95, qst: 189 })
for (const [name, extra] of [['Sam Homonyme', 1], ['Inconnu Absent', 2]]) {
  seq += 1
  const number = `2026-${String(seq).padStart(7, '0')}`
  invoices.push({ d: day(10, 21 + extra), number, client: name, pro: 'Pro Beta', subtotal: 13000, total: 13000 })
  lines.push({ d: day(10, 21 + extra), number, client: name, pro: 'Pro Beta', service: 'Psychothérapie individuelle 50 min', code: '10150', price: 13000 })
}
seq += 1
invoices.push({ d: day(10, 25), number: `2026-${String(seq).padStart(7, '0')}`, client: 'Léa Essai-01', pro: 'Pro Alpha', subtotal: 5000, total: 5000 })

write('revenus-factures.csv', ['Revenus par facture', 'Période : 2026-08-01 au 2026-10-31', '',
  'Date,Facture,Client,Professionnel,Sous-total,TPS,TVQ,Total,Payé,Solde,Payé par',
  ...invoices.map((i) => [i.d, i.number, i.client, i.pro, `"${money(i.subtotal)}"`, `"${money(i.gst ?? 0)}"`, `"${money(i.qst ?? 0)}"`, `"${money(i.total)}"`, '', '', i.payer ?? ''].join(','))].join('\n') + '\n')
write('revenus-services.csv', ['Revenus par service-produit (données fictives)', '',
  'Date;Facture;Client;Professionnel;Service;Code;Quantité;Prix;TPS;TVQ;Total',
  ...lines.map((l) => [l.d, l.number, l.client, l.pro, l.service, l.code, '1', money(l.price), money(l.gst ?? 0), money(l.qst ?? 0), money(l.price + (l.gst ?? 0) + (l.qst ?? 0))].join(';'))].join('\n') + '\n')
write('revenus-paiements.csv', ['Date;Facture;Client;Mode de paiement;Montant',
  ...payments.map((p) => [p.d, p.number, p.client, p.mode, p.amount < 0 ? `(${money(-p.amount)})` : money(p.amount)].join(';')),
  `2026-10-30;;Léa Essai-01;Interac;${money(1000)}`].join('\n') + '\n')

// I2: the appointments export (support's, columns as I2's aliases), history and coming.
const appts = []
let apptId = 70000
const at = (date, time, rest) => appts.push({ id: (apptId += 1), date, time, ...rest })
for (const [k, c] of named.entries()) {
  const time = `${9 + (k % 6)}:00`
  const who = { client: `${c.first} ${c.last}`, clientId: c.id, pro: c.pro }
  at(day(8, 3 + k), time, { ...who, status: 'Présent' })
  at(day(9, 3 + k), time, { ...who, status: k === 3 ? 'Absent' : k === 4 ? 'Annulé' : 'Présent', reason: k === 4 ? 'Maladie' : '' })
  at(day(11, 9 + k), time, { ...who, status: k % 2 ? 'Confirmé' : 'Réservé', mode: k === 6 ? 'Téléphone' : '', link: k === 1 ? 'https://visio.exemple.test/essai-1' : '' })
}
// A couple, an overlap with a coming appointment, the homonyms (with and without their ClientId).
at(day(9, 28), '16:00', { client: 'Émile Essai-03', clientId: 9003, client2: 'Zoé Essai-04', client2Id: 9004, pro: 'Pro Alpha', service: 'Thérapie de couple', code: '20170', status: 'Présent' })
at(day(11, 9), '9:30', { client: 'Rose Essai-06', clientId: 9006, pro: 'Pro Alpha', status: 'Réservé' })
at(day(11, 24), '15:00', { client: 'Sam Homonyme', pro: 'Pro Beta', status: 'Réservé' })
at(day(11, 25), '15:00', { client: 'Sam Homonyme', clientId: 9102, pro: 'Pro Beta', status: 'Réservé' })
// The waiting list as GOrendezvous kept it; an administrative agenda's call.
at(day(7, 2), '8:00', { client: 'Camille Essai-08', clientId: 9008, pro: 'conseillère', service: 'Inscription – Liste attente', status: 'Réservé' })
at(day(7, 3), '8:00', { client: 'Félix Essai-05', clientId: 9005, pro: 'conseillère', service: 'Inscription – Liste attente', status: 'Réservé' })
at(day(7, 4), '8:00', { client: 'Rose Essai-14', clientId: 9014, pro: 'Pro Alpha', service: 'Inscription - Liste d’attente', status: 'Réservé' })
at(day(7, 5), '8:00', { client: 'Jacob Essai-07', clientId: 9007, pro: 'Bureau administratif', service: 'Appel de suivi', status: 'Réservé' })
write('rendez-vous.csv', ['Rendez-vous (données fictives)', '',
  'Id;Date;Heure;Durée;Client;ClientId;Client 2;ClientId 2;Professionnel;Service;Code;Statut;Mode;Raison de l’annulation;Lien vidéo;Notes',
  ...appts.map((a) => [a.id, a.date, a.time, a.code === '20170' ? '80' : '50', a.client, a.clientId ?? '', a.client2 ?? '', a.client2Id ?? '', a.pro,
    a.service ?? 'Psychothérapie individuelle 50 min', a.code ?? (a.service ? '' : '10150'), a.status, a.mode ?? '', a.reason ?? '', a.link ?? '', 'note fictive jamais importée'].join(';'))].join('\n') + '\n')

// I2: the consents GOrendezvous holds as signed (two unknown or repeated lines).
const consentRows = named.slice(0, 10).map((c, k) => [c.id, `${c.first} ${c.last}`, 'Consentement général', day(8, 1 + k), 'GOrendezvous 2024', `${c.first} ${c.last}`])
consentRows.push([9008, 'Camille Essai-08', 'Liste d’attente en psychologie et psychothérapie', day(7, 2), '', 'Camille Essai-08'])
consentRows.push([9005, 'Félix Essai-05', 'Liste d’attente en psychologie et psychothérapie', day(7, 3), '', 'Félix Essai-05'])
consentRows.push([9011, 'Émile Essai-11', 'Coaching', day(9, 1), '', ''])
consentRows.push([9001, 'Léa Essai-01', 'Sondage de satisfaction', day(9, 2), '', ''])
consentRows.push([9001, 'Léa Essai-01', 'Consentement général', day(7, 1), 'GOrendezvous 2023', 'Léa Essai-01'])
write('consentements.csv', ['ClientId;Client;Formulaire;Signé le;Version;Signé par', ...consentRows.map((r) => r.join(';'))].join('\n') + '\n')
console.log(`Écrits dans ${out} : ${clients.length} clients, ${invoices.length} factures, ${lines.length} lignes, ${payments.length + 1} paiements, ${appts.length} rendez-vous, ${consentRows.length} consentements (données fictives).`)

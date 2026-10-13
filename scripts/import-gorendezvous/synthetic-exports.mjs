// Synthetic GOrendezvous exports shaped like the real ones (made-up people only), for a rehearsal
// of the whole import on the local stack (runbook « Répétition »): the clients export, the
// relations, the employees and services files, and the three « Revenus » exports, consistent with
// each other (18 clients with a homonym pair and an archived file; 40 invoices over three months,
// every payment mode, a refund, partial payments, a taxable line, an invoice for the homonyms, one
// for a person not in the export, one without lines; a payment without an invoice number).
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
    invoices.push({ d, number, client: `${c.first} ${c.last}`, pro, subtotal, total: subtotal, payer: k === 5 ? 'IVAC' : '' })
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
console.log(`Écrits dans ${out} : ${clients.length} clients, ${invoices.length} factures, ${lines.length} lignes, ${payments.length + 1} paiements (données fictives).`)

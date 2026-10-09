import { assert, assertEquals } from '@std/assert'
import { checkDocument } from '../_shared/pdf/model.ts'
import {
  annexeBlocks,
  type AnnexeTerms,
  decimal,
  durationLabel,
  money,
  percent,
  TAX_WORDING,
  tierLabel,
} from './annexe.ts'

const NBSP = ' '

/** The psychologue grid of the seed (28 % → 25 %), 78 sessions, 27,5 % in force (pgTAP 070's fixture). */
const terms: AnnexeTerms = {
  title_label: 'Psychologue',
  prices: [
    { duration: 60, client_price_cents: 20000 },
    { duration: 50, client_price_cents: 17500 },
    { duration: 30, client_price_cents: 13000 },
  ],
  tiers: [
    {
      from: 0,
      to: 50,
      pay: [{ duration: 60, cents: 14400 }, { duration: 50, cents: 12600 }, {
        duration: 30,
        cents: 9360,
      }],
    },
    {
      from: 51,
      to: 100,
      pay: [{ duration: 60, cents: 14500 }, { duration: 50, cents: 12688 }, {
        duration: 30,
        cents: 9425,
      }],
    },
    {
      from: 301,
      to: null,
      pay: [{ duration: 60, cents: 15000 }, { duration: 50, cents: 13125 }, {
        duration: 30,
        cents: 9750,
      }],
    },
  ],
  sessions_total: 78,
  current_tier_from: 51,
  in_force: {
    pay: [{ duration: 60, cents: 14500 }, { duration: 50, cents: 12688 }, {
      duration: 30,
      cents: 9425,
    }],
  },
  other: [
    { kind: 'workshop', name: 'Ateliers et conférences', retention_pct: 25 },
    {
      kind: 'late_cancellation',
      name: 'Annulation tardive',
      retention_pct: 30,
    },
    { kind: 'other_fees', name: 'Autres frais', retention_pct: 15 },
  ],
}

const texts = (blocks: ReturnType<typeof annexeBlocks>) =>
  blocks.flatMap((b) =>
    b.type === 'paragraph' ? [b.runs.map((r) => r.text).join('')] : []
  )

Deno.test('annexe: French amounts, percentages and labels', () => {
  assertEquals(money(12600), `126${NBSP}$`)
  assertEquals(money(9360), `93,60${NBSP}$`)
  assertEquals(money(12688), `126,88${NBSP}$`)
  assertEquals(money(120000), `1${NBSP}200${NBSP}$`)
  assertEquals(money(5), `0,05${NBSP}$`)
  assertEquals(percent(27.5), `27,5${NBSP}%`)
  assertEquals(percent(75), `75${NBSP}%`)
  assertEquals(decimal(78.5), '78,5')
  assertEquals(decimal(1250), `1${NBSP}250`)
  assertEquals(tierLabel({ from: 0, to: 50 }), '0 à 50 séances')
  assertEquals(tierLabel({ from: 301, to: null }), '301 séances et plus')
  assertEquals(durationLabel(60), `Rencontre 60${NBSP}min (couple ou famille)`)
  assertEquals(durationLabel(30), `Rencontre 30${NBSP}min`)
})

Deno.test('annexe: the client prices, then the pay per tier, every amount « avant taxes »', () => {
  const blocks = annexeBlocks(terms)
  const tables = blocks.flatMap((b) => b.type === 'table' ? [b] : [])
  assertEquals(tables.length, 3)
  assertEquals(tables[0].columns.map((c) => c.label), [
    durationLabel(60),
    durationLabel(50),
    durationLabel(30),
  ])
  assertEquals(tables[0].rows, [[`200${NBSP}$`, `175${NBSP}$`, `130${NBSP}$`]])
  assertEquals(tables[1].columns.map((c) => c.label), [
    'Séances cumulées',
    durationLabel(60),
    durationLabel(50),
    durationLabel(30),
  ])
  assertEquals(tables[1].columns.reduce((sum, c) => sum + c.width, 0), 100)
  assertEquals(tables[1].rows, [
    ['0 à 50 séances', `144${NBSP}$`, `126${NBSP}$`, `93,60${NBSP}$`],
    ['51 à 100 séances', `145${NBSP}$`, `126,88${NBSP}$`, `94,25${NBSP}$`],
    ['301 séances et plus', `150${NBSP}$`, `131,25${NBSP}$`, `97,50${NBSP}$`],
  ])
  assert(texts(blocks)[0].includes(TAX_WORDING))
  assert(texts(blocks)[0].startsWith('Profession : Psychologue.'))
  // What the professional reads is what they are paid: never a margin or a retention as the subject.
  assert(!JSON.stringify(blocks).includes('marge'))
  assertEquals(
    checkDocument({ title: 'Annexe', footer: { text: '' }, blocks }).ok,
    true,
    'a valid document',
  )
})

Deno.test("annexe: where the professional stands, and the rate in force only when it is not the tier's", () => {
  const same = texts(annexeBlocks(terms))
  assert(
    same.some((t) =>
      t ===
        'À la date du contrat, le Professionnel compte 78 séances cumulées (palier « 51 à 100 séances »). La Clinique fait le suivi du palier chaque mois.'
    ),
  )
  assert(
    !same.some((t) => t.startsWith('Montant versé à la date du contrat')),
    'the tier already says it',
  )

  const custom = texts(annexeBlocks({
    ...terms,
    in_force: {
      pay: [{ duration: 60, cents: 14000 }, { duration: 50, cents: 12250 }, {
        duration: 30,
        cents: 9100,
      }],
    },
  }))
  assert(custom.includes(
    `Montant versé à la date du contrat, selon l’entente en vigueur : ${
      durationLabel(60)
    } : 140${NBSP}$ · ${durationLabel(50)} : 122,50${NBSP}$ · ${
      durationLabel(30)
    } : 91${NBSP}$.`,
  ))
})

Deno.test('annexe: the other kinds as the share paid, with what the clinic retains in words', () => {
  const other =
    annexeBlocks(terms).flatMap((b) => b.type === 'table' ? [b] : [])[2]
  assertEquals(other.rows, [
    [
      'Ateliers et conférences',
      `75${NBSP}% des honoraires facturés (la Clinique retient 25${NBSP}%)`,
    ],
    [
      'Annulation tardive ou absence non motivée',
      `70${NBSP}% des frais payés par le client (la Clinique retient 30${NBSP}%)`,
    ],
    [
      'Autres frais (rapports, échanges avec un intervenant externe)',
      `85${NBSP}% des montants facturés (la Clinique retient 15${NBSP}%)`,
    ],
  ])
  const unknown = annexeBlocks({
    ...terms,
    other: [{
      kind: 'workshop',
      name: 'Ateliers et conférences',
      retention_pct: null,
    }],
  })
    .flatMap((b) => b.type === 'table' ? [b] : [])[2]
  assertEquals(unknown.rows, [['Ateliers et conférences', 'À confirmer']])
})

Deno.test('annexe: a grid without prices prints a sentence, never a table without columns', () => {
  const blocks = annexeBlocks({ ...terms, prices: [] })
  assertEquals(blocks.filter((b) => b.type === 'table').length, 1)
  assert(
    texts(blocks).includes(
      'Les honoraires des consultations restent à confirmer par la Clinique.',
    ),
  )
  assertEquals(
    checkDocument({ title: 'Annexe', footer: { text: '' }, blocks }).ok,
    true,
  )
})

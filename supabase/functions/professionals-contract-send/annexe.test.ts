import { assert, assertEquals } from '@std/assert'
import { checkDocument } from '../_shared/pdf/model.ts'
import {
  ANNEXE_COLUMNS,
  annexeBlocks,
  annexeSummary,
  type AnnexeTerms,
  CONSULTATION_LABEL,
  decimal,
  percent,
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
  // Out of order on purpose: the first tier is the lowest threshold.
  tiers: [
    {
      from: 51,
      to: 100,
      retention_pct: 27.5,
      pay: [{ duration: 50, cents: 12688 }],
    },
    {
      from: 0,
      to: 50,
      retention_pct: 28,
      pay: [{ duration: 50, cents: 12600 }],
    },
    {
      from: 301,
      to: null,
      retention_pct: 25,
      pay: [{ duration: 50, cents: 13125 }],
    },
  ],
  sessions_total: 78,
  current_tier_from: 51,
  in_force: { pay: [{ duration: 50, cents: 12688 }] },
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

Deno.test('annexe: French percentages', () => {
  assertEquals(percent(27.5), `27,5${NBSP}%`)
  assertEquals(percent(75), `75${NBSP}%`)
  assertEquals(percent(100 - 27.5), `72,5${NBSP}%`)
  assertEquals(decimal(78.5), '78,5')
  assertEquals(decimal(1250), `1${NBSP}250`)
})

Deno.test('annexe: one table in the contract’s format, the consultations at the first tier', () => {
  const blocks = annexeBlocks(terms)
  assertEquals(blocks.length, 1)
  const table = blocks[0]
  assert(table.type === 'table')
  assertEquals(table.columns.map((c) => c.label), [...ANNEXE_COLUMNS])
  assertEquals(table.columns.reduce((sum, c) => sum + c.width, 0), 100)
  assertEquals(table.rows, [
    [CONSULTATION_LABEL, `72${NBSP}%`, `28${NBSP}%`],
    ['Ateliers, conférences et formations', `75${NBSP}%`, `25${NBSP}%`],
    [
      'Annulation tardive ou absence non motivée*',
      `70${NBSP}%`,
      `30${NBSP}%`,
    ],
    ['Autres frais administratifs', `85${NBSP}%`, `15${NBSP}%`],
  ])
  // Neither the higher tiers, nor the client prices, nor the count: the contract's prose says the rest.
  const json = JSON.stringify(blocks)
  assert(!json.includes('séances'))
  assert(!json.includes('$'))
  assertEquals(
    checkDocument({ title: 'Annexe', footer: { text: '' }, blocks }).ok,
    true,
    'a valid document',
  )
})

Deno.test('annexe: a 30 % first tier prints the contract’s « 70 % / 30 % »', () => {
  const table = annexeBlocks({
    ...terms,
    tiers: [{ from: 0, to: null, retention_pct: 30, pay: [] }],
  })[0]
  assert(table.type === 'table')
  assertEquals(table.rows[0], [CONSULTATION_LABEL, `70${NBSP}%`, `30${NBSP}%`])
})

Deno.test('annexe: a rate not set yet reads « À confirmer »; another kind reads its name', () => {
  const table = annexeBlocks({
    ...terms,
    other: [
      {
        kind: 'workshop',
        name: 'Ateliers et conférences',
        retention_pct: null,
      },
      { kind: 'supervision', name: 'Supervision', retention_pct: 40 },
    ],
  })[0]
  assert(table.type === 'table')
  assertEquals(table.rows.slice(1), [
    ['Ateliers, conférences et formations', 'À confirmer', 'À confirmer'],
    ['Supervision', `60${NBSP}%`, `40${NBSP}%`],
  ])
})

Deno.test('annexe: the preview’s summary says the same as the table', () => {
  assertEquals(annexeSummary(terms), [
    { label: 'Profession', value: 'Psychologue' },
    {
      label: CONSULTATION_LABEL,
      value: `Professionnel 72${NBSP}% · Clinique 28${NBSP}%`,
    },
    {
      label: 'Ateliers, conférences et formations',
      value: `Professionnel 75${NBSP}% · Clinique 25${NBSP}%`,
    },
    {
      label: 'Annulation tardive ou absence non motivée*',
      value: `Professionnel 70${NBSP}% · Clinique 30${NBSP}%`,
    },
    {
      label: 'Autres frais administratifs',
      value: `Professionnel 85${NBSP}% · Clinique 15${NBSP}%`,
    },
  ])
})

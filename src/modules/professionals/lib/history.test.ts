import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import type { HistoryEntry } from '../api/parse'
import { CATALOG, CATALOG_VIEW, recordFixture, seventyTwoMotifsCatalog } from '../test/fixtures-domain'
import { buildCatalogView } from './catalog-view'
import { IDS } from '../test/fixtures'
import {
  buildHistoryEvents,
  filterHistory,
  groupHistoryByDay,
  historyReadsOn,
  professionTitlesByRow,
  settledHistoryRows,
  type HistoryContext,
  type HistoryEvent,
} from './history'

const P = IDS.professional
const ORG = '00000000-0000-4000-8000-00000000f000'
const TX = '2026-10-08T14:30:00.123456+00:00'
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

let nextId = 1000
/** One audit row, newest first by id like the RPC returns them; same `createdAt` = same transaction. */
function row(tableName: string, action: HistoryEntry['action'], changedFields: HistoryEntry['changedFields'], over: Partial<HistoryEntry> = {}): HistoryEntry {
  nextId -= 1
  return {
    id: nextId,
    createdAt: TX,
    tableName,
    recordId: P,
    action,
    changedFields,
    actorId: IDS.admin,
    actorName: 'Admin Local',
    actorRole: 'admin',
    source: 'app',
    ...over,
  }
}

const junction = (table: string, column: string, id: string, action: HistoryEntry['action'] = 'insert', extra: Record<string, unknown> = {}) =>
  row(table, action, { org_id: ORG, professional_id: P, [column]: id, created_at: TX, ...extra }, { recordId: `${P}:${id}` })

const ctx = (over: Partial<HistoryContext> = {}): HistoryContext => ({ catalog: CATALOG_VIEW, titleByRow: new Map(), ...over })
const events = (rows: HistoryEntry[], context = ctx()) => buildHistoryEvents(rows, context)
const only = (rows: HistoryEntry[], context = ctx()): HistoryEvent => {
  const list = events(rows, context)
  expect(list).toHaveLength(1)
  return list[0] as HistoryEvent
}
/** Everything the timeline prints for these events. */
const printed = (list: HistoryEvent[]) =>
  JSON.stringify(list.map(({ actor, sentence, lines, groups }) => ({ actor, sentence, lines, groups })))

const H = 'modules.professionals.history'

describe('history — the record row', () => {
  const creation = () => [
    row('professional_matching_profiles', 'insert', { org_id: ORG, professional_id: P, accepting_new_clients: true, availability_periods: [] }),
    row('professional_public_profiles', 'insert', { org_id: ORG, professional_id: P, bio: null }),
    row('professionals', 'insert', {
      id: P,
      org_id: ORG,
      first_name: 'Marie',
      last_name: 'Tremblay',
      email: 'marie.t@exemple.ca',
      // Redacted by key, even when null (4a.4 note): never read as « a renseigné ».
      city: '[redacted]',
      gender: '[redacted]',
      personal_phone: '[redacted]',
      province: 'QC',
      status: 'draft',
      profile_id: null,
      created_by: IDS.admin,
    }),
  ]

  it('reads a creation as one sentence, the empty 1:1 rows folded into it, no redacted field', () => {
    const event = only(creation())
    expect(event).toMatchObject({ actor: 'Admin Local', byPerson: true, kind: 'change', sentence: t(`${H}.sentences.created`) })
    expect(event.lines).toEqual([
      { kind: 'value', field: 'Prénom', value: 'Marie' },
      { kind: 'value', field: 'Nom', value: 'Tremblay' },
      { kind: 'value', field: 'Courriel', value: 'marie.t@exemple.ca' },
    ])
    expect(printed([event])).not.toMatch(/Ville|Genre|masqué/)
  })

  it('names one changed field with its values, in the sentence', () => {
    const event = only([row('professionals', 'update', { years_experience: { before: 12, after: 14 } })])
    expect(event.sentence).toBe("a modifié les années d'expérience\u00a0: 12 → 14")
    expect(event.lines).toEqual([])
  })

  it('never shows a redacted value: only that the field changed', () => {
    const event = only([row('professionals', 'update', { city: '[redacted]' })])
    expect(event.sentence).toBe('a modifié la ville')
    expect(event.lines).toEqual([{ kind: 'value', field: 'Ville', value: t('audit.values.redacted') }])
  })

  it('lists several fields in one sentence, the values in the details', () => {
    const event = only([row('professionals', 'update', { gender: '[redacted]', years_experience: { before: null, after: 12 }, city: '[redacted]' })])
    expect(event.sentence).toBe("a modifié le genre, les années d'expérience et la ville")
    expect(event.lines).toContainEqual({ kind: 'change', field: "Années d'expérience", before: t('audit.values.empty'), after: '12' })
  })

  it('keeps long texts out of the sentence', () => {
    const event = only([row('professional_public_profiles', 'update', { bio: { before: null, after: 'Une longue présentation.' } })])
    expect(event.sentence).toBe('a modifié la présentation')
    expect(event.lines).toEqual([{ kind: 'change', field: 'Présentation', before: t('audit.values.empty'), after: 'Une longue présentation.' }])
  })

  it('reads the matching profile: periods by name, booleans Oui / Non', () => {
    expect(only([row('professional_matching_profiles', 'update', { availability_periods: { before: [], after: ['evening', 'am'] } })]).sentence).toBe(
      `a modifié les disponibilités générales\u00a0: ${t('audit.values.empty')} → Matin · Soir`,
    )
    expect(only([row('professional_matching_profiles', 'update', { accepting_new_clients: { before: true, after: false } })]).sentence).toBe(
      "a modifié l'accueil de nouveaux clients\u00a0: Oui → Non",
    )
  })

  it('formats the public phone', () => {
    expect(only([row('professional_public_profiles', 'update', { public_phone: { before: null, after: '+15145550101' } })]).sentence).toBe(
      `a modifié le téléphone public\u00a0: ${t('audit.values.empty')} → 514 555-0101`,
    )
  })

  it('says a login account was linked without its id', () => {
    const event = only([row('professionals', 'update', { profile_id: { before: null, after: IDS.admin } })])
    expect(event.sentence).toBe(`a modifié le compte de connexion\u00a0: ${t(`${H}.values.accountNone`)} → ${t(`${H}.values.accountLinked`)}`)
  })

  it('reads status changes as what happened to the file', () => {
    expect(only([row('professionals', 'update', { status: { before: 'draft', after: 'active' } })]).sentence).toBe(t(`${H}.sentences.activated`))
    // The override reason is a free text: in the details, not the sentence (P4-103).
    const override = only([
      row('professionals', 'update', {
        status: { before: 'in_review', after: 'active' },
        activation_override_reason: { before: null, after: 'Dossier complété hors application' },
      }),
    ])
    expect(override.sentence).toBe('a activé le dossier incomplet')
    expect(override.lines).toEqual([{ kind: 'value', field: "Raison de l'activation d'un dossier incomplet", value: 'Dossier complété hors application' }])

    const deactivation = only([
      row('professionals', 'update', {
        status: { before: 'active', after: 'inactive' },
        deactivation_reason_id: { before: null, after: IDS.ended },
        deactivation_note: { before: null, after: 'Fin du contrat.' },
        deactivation_disabled_account: { before: false, after: true },
        status_changed_at: { before: TX, after: TX },
        status_changed_by: { before: null, after: IDS.admin },
      }),
    ])
    expect(deactivation.sentence).toBe('a désactivé le dossier (raison\u00a0: Fin de collaboration)')
    expect(deactivation.lines).toEqual([
      { kind: 'value', field: 'Note de désactivation', value: 'Fin du contrat.' },
      { kind: 'text', text: t(`${H}.lines.accountDisabled`) },
    ])

    const reactivation = only([
      row('professionals', 'update', {
        status: { before: 'inactive', after: 'active' },
        deactivation_reason_id: { before: IDS.ended, after: null },
        deactivation_note: { before: 'Fin du contrat.', after: null },
        deactivation_disabled_account: { before: true, after: false },
      }),
    ])
    expect(reactivation.sentence).toBe(t(`${H}.sentences.reactivated`))
    expect(reactivation.lines).toEqual([{ kind: 'text', text: t(`${H}.lines.accountEnabled`) }])

    expect(only([row('professionals', 'update', { status: { before: 'draft', after: 'in_review' } })]).sentence).toBe(
      'a changé le statut\u00a0: À inviter → À réviser',
    )
  })

  it('names an archived (unknown) deactivation reason without its id', () => {
    const event = only([row('professionals', 'update', { status: { before: 'active', after: 'inactive' }, deactivation_reason_id: { before: null, after: ORG } })])
    expect(event.sentence).toBe(`a désactivé le dossier (raison\u00a0: ${t(`${H}.values.unknown.reason`)})`)
  })
})

describe('history — sets (motifs, languages, clientèles, approaches)', () => {
  it('names up to three motifs in the catalogue order', () => {
    const event = only([junction('professional_motifs', 'motif_id', IDS.psychose), junction('professional_motifs', 'motif_id', IDS.anxiete)])
    expect(event.sentence).toBe('a ajouté les motifs Anxiété et Psychose')
    expect(event.groups).toEqual([])
    expect(only([junction('professional_motifs', 'motif_id', IDS.anxiete, 'delete')]).sentence).toBe('a retiré le motif Anxiété')
  })

  it('counts many motifs and groups their names by category behind the disclosure', () => {
    const big = seventyTwoMotifsCatalog()
    const ids = big.motifs.filter((m) => m.isActive).map((m) => m.id).slice(0, 65)
    const event = only(
      ids.map((id) => junction('professional_motifs', 'motif_id', id)),
      ctx({ catalog: big }),
    )
    expect(event.sentence).toBe('a ajouté 65 motifs')
    expect(event.groups.map((g) => g.name)).toEqual(['Catégorie 1', 'Catégorie 2', 'Catégorie 3', 'Catégorie 4', 'Catégorie 5', 'Catégorie 6', 'Catégorie 7', 'Catégorie 8'])
    expect(event.groups.flatMap((g) => g.items)).toHaveLength(65)
    expect(event.groups[0]?.items[0]).toMatchObject({ name: 'Motif 1.1', archived: false })
  })

  it('marks archived motifs and names unknown ones « Motif archivé », under « Autres »', () => {
    const event = only(
      [IDS.anxiete, IDS.archivedMotif, IDS.deuil, IDS.orphan, ORG].map((id) => junction('professional_motifs', 'motif_id', id, 'delete')),
    )
    expect(event.sentence).toBe('a retiré 5 motifs')
    const names = event.groups.map(({ items, ...group }) => ({ ...group, items: items.map(({ name, archived }) => ({ name, archived })) }))
    expect(names).toEqual([
      { key: 'inner_life', name: 'Vie intérieure', items: [{ name: 'Anxiété', archived: false }, { name: 'Ancien motif', archived: true }] },
      {
        key: 'autres',
        name: 'Autres',
        items: [
          { name: 'Deuil', archived: false },
          { name: 'Sans catégorie', archived: false },
          { name: t(`${H}.values.unknown.motif`), archived: false },
        ],
      },
    ])
  })

  it('merges the rows of one transaction by table and action, not across transactions', () => {
    const list = events([
      junction('professional_languages', 'language_id', IDS.en),
      junction('professional_motifs', 'motif_id', IDS.anxiete),
      junction('professional_languages', 'language_id', IDS.fr),
      junction('professional_motifs', 'motif_id', IDS.psychose, 'insert', {}),
    ])
    expect(list.map((e) => e.sentence)).toEqual(['a ajouté les langues Français et Anglais', 'a ajouté les motifs Anxiété et Psychose'])

    const earlier = { createdAt: '2026-10-08T14:00:00+00:00' }
    const split = events([
      junction('professional_motifs', 'motif_id', IDS.anxiete),
      { ...junction('professional_motifs', 'motif_id', IDS.psychose), ...earlier },
    ])
    expect(split.map((e) => e.sentence)).toEqual(['a ajouté le motif Anxiété', 'a ajouté le motif Psychose'])
  })

  it('marks specialised clientèles and approaches, and reads a change of the star', () => {
    expect(only([junction('professional_clienteles', 'clientele_id', IDS.couples, 'insert', { is_specialized: true })]).sentence).toBe(
      'a ajouté la clientèle Couples (spécialisé)',
    )
    expect(
      only([row('professional_clienteles', 'update', { is_specialized: { before: false, after: true } }, { recordId: `${P}:${IDS.children}` })])
        .sentence,
    ).toBe('a indiqué une spécialisation pour\u00a0: Enfants')
    expect(
      only([row('professional_specialties', 'update', { is_specialized: { before: true, after: false } }, { recordId: `${P}:${IDS.cbt}` })]).sentence,
    ).toBe('a retiré la spécialisation pour\u00a0: Thérapie cognitivo-comportementale (TCC)')
    expect(only([junction('professional_specialties', 'specialty_id', ORG)]).sentence).toBe(`a ajouté l'approche ${t(`${H}.values.unknown.specialty`)}`)
  })

  it('puts archived items last, then unknown ones, for every set', () => {
    // Motifs: « Ancien motif » (archived, first category) after « Deuil » (active, « Autres »).
    expect(
      only([IDS.archivedMotif, IDS.deuil, ORG].map((id) => junction('professional_motifs', 'motif_id', id, 'delete'))).sentence,
    ).toBe(`a retiré les motifs Deuil, Ancien motif (archivé) et ${t(`${H}.values.unknown.motif`)}`)
    // Languages: French archived by the clinic comes after English, though first in the catalogue.
    const catalog = buildCatalogView({ ...CATALOG, languages: CATALOG.languages.map((l) => (l.id === IDS.fr ? { ...l, isActive: false } : l)) })
    const languages = [ORG, IDS.fr, IDS.en].map((id) => junction('professional_languages', 'language_id', id))
    expect(only(languages, ctx({ catalog })).sentence).toBe(`a ajouté les langues Anglais, Français (archivé) et ${t(`${H}.values.unknown.language`)}`)
  })
})

describe('history — titles and payer numbers', () => {
  const professionRow = (action: HistoryEntry['action'], fields: Record<string, unknown>, rowId: string = IDS.professionRow) =>
    row('professional_professions', action, fields, { recordId: `${P}:${rowId}` })

  it('names the title of an added or removed row', () => {
    const added = only([professionRow('insert', { id: IDS.professionRow, profession_title_id: IDS.psychologue, licence_number: '12345', is_primary: true })])
    expect(added.sentence).toBe('a ajouté le titre Psychologue')
    expect(added.lines).toEqual([
      { kind: 'value', field: 'Numéro de permis', value: '12345' },
      { kind: 'value', field: 'Titre principal', value: 'Oui' },
    ])
    expect(only([professionRow('delete', { profession_title_id: IDS.naturopathe, licence_number: null, is_primary: false })]).sentence).toBe(
      'a retiré le titre Naturopathe',
    )
  })

  it('says nothing of a non-primary flag or an empty licence on an added title', () => {
    for (const licence_number of [null, '', '  ']) {
      const added = only([professionRow('insert', { profession_title_id: IDS.naturopathe, licence_number, is_primary: false })])
      expect(added).toMatchObject({ sentence: 'a ajouté le titre Naturopathe', lines: [] })
    }
  })

  it('finds the title of an updated row through the record or the loaded rows', () => {
    const titleByRow = professionTitlesByRow([], recordFixture())
    expect(only([professionRow('update', { licence_number: { before: '12345', after: '54321' } })], ctx({ titleByRow })).sentence).toBe(
      'a modifié le numéro de permis (Psychologue)\u00a0: 12345 → 54321',
    )
    const other = '00000000-0000-4000-8000-000000001102'
    const rows = [
      professionRow('update', { is_primary: { before: false, after: true } }, other),
      professionRow('update', { is_primary: { before: true, after: false } }),
      professionRow('insert', { profession_title_id: IDS.naturopathe, is_primary: false }, other),
    ]
    const list = events(rows, ctx({ titleByRow: professionTitlesByRow(rows, recordFixture()) }))
    // The former primary losing the flag says nothing the new primary does not.
    expect(list.map((e) => e.sentence)).toEqual(['a choisi Naturopathe comme titre principal', 'a ajouté le titre Naturopathe'])
    expect(only([professionRow('update', { licence_number: { before: '1', after: '2' } }, other)]).sentence).toBe(
      `a modifié le numéro de permis (${t(`${H}.values.unknown.title`)})\u00a0: 1 → 2`,
    )
  })

  it('reads the IVAC number', () => {
    const ivac = (action: HistoryEntry['action'], fields: Record<string, unknown>) =>
      row('professional_payer_numbers', action, fields, { recordId: `${P}:ivac` })
    expect(only([ivac('insert', { payer_type: 'ivac', number: 'IVAC-1' })]).sentence).toBe('a ajouté le numéro IVAC IVAC-1')
    expect(only([ivac('update', { number: { before: 'IVAC-1', after: 'IVAC-2' } })]).sentence).toBe('a modifié le numéro IVAC\u00a0: IVAC-1 → IVAC-2')
    expect(only([ivac('delete', { payer_type: 'ivac', number: 'IVAC-2' })]).sentence).toBe('a retiré le numéro IVAC IVAC-2')
  })

  it('reads a payer this tab does not know without its raw key', () => {
    const other = (action: HistoryEntry['action'], fields: Record<string, unknown>) =>
      row('professional_payer_numbers', action, fields, { recordId: `${P}:csst_new` })
    expect(only([other('insert', { payer_type: 'csst_new', number: 'C-1' })]).sentence).toBe('a ajouté le numéro de payeur C-1')
    expect(only([other('update', { number: { before: 'C-1', after: 'C-2' } })]).sentence).toBe('a modifié le numéro de payeur\u00a0: C-1 → C-2')
    expect(printed(events([other('delete', { number: 'C-2' })]))).not.toContain('csst_new')
  })
})

describe('history — private data, actors, ids', () => {
  it('never shows private values, even when a row carries them (4a.17)', () => {
    const changed = only([row('professional_private', 'update', { sin: { before: null, after: '046454286' } })])
    expect(changed).toMatchObject({ kind: 'change', sentence: t(`${H}.sentences.privateChanged`), lines: [], groups: [] })
    const read = only([row('professional_private', 'read', { fields: ['bank_account'] })])
    expect(read).toMatchObject({ kind: 'read', sentence: 'a affiché le numéro de compte', lines: [] })
    expect(printed([changed, read])).not.toContain('046454286')
  })

  it('names the private fields a consultation showed, from a fixed list only (4a.17)', () => {
    const read = (changedFields: HistoryEntry['changedFields']) => only([row('professional_private', 'read', changedFields)])
    expect(read({ fields: ['sin'] })).toMatchObject({ kind: 'read', sentence: 'a affiché le NAS', lines: [], groups: [] })
    expect(read({ fields: ['sin', 'bank_account'] }).sentence).toBe('a affiché le NAS et le numéro de compte')
    expect(read({ fields: ['bank_account', 'bank_account'] }).sentence).toBe('a affiché le numéro de compte')
    // Anything else, or nothing: what kind of thing, never a name or a value.
    for (const fields of [null, {}, { fields: [] }, { fields: ['email'] }, { fields: ['sin', 'toString'] }, { fields: 'sin' }, { fields: [{ sin: '046454286' }] }]) {
      const event = read(fields)
      expect(event.sentence).toBe(t(`${H}.sentences.privateReadOther`))
      expect(printed([event])).not.toMatch(/046454286|email|toString/)
    }
  })

  it('names who wrote the entry, or where it came from', () => {
    const actor = (over: Partial<HistoryEntry>) => only([row('professionals', 'update', { years_experience: { before: 1, after: 2 } }, over)])
    expect(actor({ actorId: null, actorName: null, source: 'seed' })).toMatchObject({ actor: t(`${H}.actors.import`), byPerson: false })
    expect(actor({ actorId: null, actorName: null, source: 'import:professionals' }).actor).toBe(t(`${H}.actors.import`))
    expect(actor({ actorId: null, actorName: null, source: 'migration:professionals_core' }).actor).toBe(t(`${H}.actors.migration`))
    expect(actor({ actorId: null, actorName: null, source: 'service' }).actor).toBe(t(`${H}.actors.system`))
    expect(actor({ actorId: null, actorName: null, source: 'bootstrap' })).toMatchObject({ actor: 'Le système', byPerson: false })
    expect(actor({ actorName: null })).toMatchObject({ actor: "Une personne qui n'a plus accès", byPerson: false })
  })

  it('prints no UUID for any table, an unknown one included', () => {
    const list = events([
      row('professionals', 'insert', { id: P, org_id: ORG, first_name: 'A', last_name: 'B', email: 'a@b.ca', created_by: IDS.admin, profile_id: IDS.admin }),
      junction('professional_motifs', 'motif_id', ORG),
      row('professional_professions', 'update', { licence_number: { before: '1', after: '2' } }, { recordId: `${P}:${ORG}` }),
      row('professional_documents', 'insert', { id: ORG, stored_file_id: ORG }, { recordId: `${P}:${ORG}` }),
    ])
    expect(list.at(-1)?.sentence).toBe('a modifié une autre section du dossier')
    expect(printed(list)).not.toMatch(UUID)
    expect(printed(list)).not.toContain('professional_documents')
  })

  it('reads a consultation of a table it does not know as a consultation, without its name', () => {
    const event = only([row('professional_documents', 'read', { fields: ['stored_file_id'] }, { recordId: `${P}:${ORG}` })])
    expect(event).toMatchObject({ kind: 'read', sentence: 'a consulté une section du dossier', lines: [], groups: [] })
    expect(printed([event])).not.toMatch(/professional_documents|stored_file_id/)
  })

  it('reads a deleted profile row, folded nowhere', () => {
    expect(only([row('professional_public_profiles', 'delete', { org_id: ORG, professional_id: P, bio: 'Texte' })])).toMatchObject({
      sentence: 'a supprimé le profil public',
      lines: [],
    })
    expect(only([row('professional_matching_profiles', 'delete', { professional_id: P })]).sentence).toBe('a supprimé le profil de jumelage')
  })

  it('never prints an id, the redaction marker or an object as a value', () => {
    const hidden = t(`${H}.values.hidden`)
    const event = only([
      row('professionals', 'update', {
        // Columns without a catalogue reading: an id is not printed, an object is not « (vide) ».
        referred_by: { before: null, after: ORG },
        extra: { before: { a: 1 }, after: [1, 2] },
        nickname: { before: '[redacted]', after: 'Marie' },
        updated_by: { before: null, after: IDS.admin },
        user_id: { before: null, after: IDS.admin },
      }),
    ])
    expect(event.lines).toEqual([
      { kind: 'change', field: 'referred_by', before: t('audit.values.empty'), after: hidden },
      { kind: 'change', field: 'extra', before: hidden, after: hidden },
      { kind: 'change', field: 'nickname', before: t('audit.values.redacted'), after: 'Marie' },
    ])
    expect(printed([event])).not.toMatch(UUID)
    expect(printed([event])).not.toContain('[redacted]')
  })
})

describe('history — retention (P4-193)', () => {
  const R1 = '00000000-0000-4000-8000-000000003001'
  const R0 = '00000000-0000-4000-8000-000000003002'
  const rate = (action: HistoryEntry['action'], fields: HistoryEntry['changedFields'], id = R1) =>
    row('professional_retention', action, fields, { recordId: `${P}:${id}` })
  const months = (action: HistoryEntry['action'], fields: HistoryEntry['changedFields'], id = R1) =>
    row('professional_session_counts', action, fields, { recordId: `${P}:${id}` })
  const agreement = (action: HistoryEntry['action'], fields: HistoryEntry['changedFields'], id = R1) =>
    row('professional_client_agreements', action, fields, { recordId: `${P}:${id}` })
  const NBSP = '\u00A0'

  it('reads an applied suggestion with its snapshot; the closed rate folded into it', () => {
    const event = only([
      rate('update', { effective_to: { before: null, after: '2026-11-01' } }, R0),
      rate('insert', {
        id: R1,
        org_id: ORG,
        professional_id: P,
        retention_pct: 27.5,
        decision: 'suggested',
        tier_threshold: 51,
        suggested_pct: 27.5,
        sessions_total: 55.5,
        effective_from: '2026-11-01',
        effective_to: null,
        note: null,
        created_by: IDS.admin,
      }),
    ])
    expect(event.sentence).toBe(`a appliqué le taux suggéré de 27,5${NBSP}% dès le 1 nov. 2026`)
    expect(event.lines).toEqual([
      { kind: 'value', field: t('audit.fields.professional_retention.sessions_total'), value: '55,5' },
      { kind: 'value', field: t('audit.fields.professional_retention.suggested_pct'), value: `27,5${NBSP}%` },
    ])
  })

  it('names each decision, a maintained rate with its tier', () => {
    expect(only([rate('insert', { retention_pct: 28, decision: 'maintained', tier_threshold: 51, effective_from: '2026-09-01' })]).sentence).toBe(
      `a maintenu le taux à 28${NBSP}% au palier de 51 séances, dès le 1 sept. 2026`,
    )
    expect(only([rate('insert', { retention_pct: 30, decision: 'maintained', tier_threshold: 0, effective_from: '2026-09-01' })]).sentence).toBe(
      `a maintenu le taux à 30${NBSP}% au palier de 0 séance, dès le 1 sept. 2026`,
    )
    expect(only([rate('insert', { retention_pct: 26, decision: 'custom', effective_from: '2026-09-01', note: 'Entente' })]).lines).toEqual([
      { kind: 'value', field: t('audit.fields.professional_retention.note'), value: 'Entente' },
    ])
    expect(only([rate('delete', { retention_pct: 26, decision: 'custom', effective_from: '2026-09-01' })]).sentence).toBe(`a supprimé le taux de 26${NBSP}% (dès le 1 sept. 2026)`)
  })

  it('reads a month of sessions: entered, changed, removed', () => {
    const set = only([months('insert', { month: '2026-09-01', sessions_50_60: 20, sessions_30: 4, adjustment: 0, note: null })])
    expect(set.sentence).toBe('a saisi les séances de septembre 2026')
    expect(set.lines).toEqual([
      { kind: 'value', field: t('audit.fields.professional_session_counts.sessions_50_60'), value: '20' },
      { kind: 'value', field: t('audit.fields.professional_session_counts.sessions_30'), value: '4' },
    ])
    const changed = only([months('update', { sessions_30: { before: 4, after: 6 } })])
    expect(changed.sentence).toBe('a modifié les séances d’un mois')
    expect(changed.lines).toEqual([{ kind: 'change', field: t('audit.fields.professional_session_counts.sessions_30'), before: '4', after: '6' }])
    expect(only([months('delete', { month: '2026-09-01', sessions_50_60: 20 })]).sentence).toBe('a retiré les séances de septembre 2026')
  })

  it('reads a client agreement with both amounts in dollars, never its client reference (redacted, Loi 25) nor its future client id', () => {
    const event = only([
      agreement('insert', {
        client_label: '[redacted]',
        client_id: '00000000-0000-4000-8000-00000000c11e',
        duration: 50,
        professional_amount_cents: 8500,
        client_price_cents: 12000,
        effective_from: '2026-10-01',
        effective_to: null,
        note: null,
      }),
    ])
    expect(event.sentence).toBe('a ajouté une entente particulière (50 min) dès le 1 oct. 2026')
    expect(event.lines).toEqual([
      { kind: 'value', field: t('modules.professionals.history.moneyFields.client_price_cents'), value: `120,00${NBSP}$` },
      { kind: 'value', field: t('modules.professionals.history.moneyFields.professional_amount_cents'), value: `85,00${NBSP}$` },
    ])
    expect(printed([event])).not.toMatch(UUID)
    expect(printed([event])).not.toMatch(/redacted|masqué/i)
  })

  it('keeps an end-date change alone (an agreement ended) as a change, with readable values', () => {
    const event = only([agreement('update', { effective_to: { before: null, after: '2027-03-01' } })])
    expect(event.sentence).toBe('a modifié une entente particulière')
    expect(event.lines).toEqual([
      { kind: 'change', field: t('audit.fields.professional_client_agreements.effective_to'), before: t('audit.values.empty'), after: '1 mars 2027' },
    ])
  })

  it('prints no id and keeps the rows under « Modifications »', () => {
    const list = events([rate('insert', { id: R1, org_id: ORG, professional_id: P, retention_pct: 28, decision: 'initial', effective_from: '2026-07-01', created_by: IDS.admin })])
    expect(printed(list)).not.toMatch(UUID)
    expect(filterHistory(list, 'changes')).toHaveLength(1)
  })
})

describe('history — pages, days, filter', () => {
  it('holds back the transaction that may continue on the next page', () => {
    const older = { createdAt: '2026-10-08T13:00:00+00:00' }
    const rows = [row('professionals', 'update', { years_experience: { before: 1, after: 2 } }), junction('professional_motifs', 'motif_id', IDS.anxiete, 'insert'), { ...junction('professional_motifs', 'motif_id', IDS.deuil), ...older }, { ...junction('professional_motifs', 'motif_id', IDS.psychose), ...older }]
    expect(settledHistoryRows(rows, true)).toEqual(rows.slice(0, 2))
    expect(settledHistoryRows(rows, false)).toBe(rows)
    expect(settledHistoryRows(rows.slice(2), true)).toEqual([])
  })

  it('reads on while the last page holds only the held-back save', () => {
    const at = (createdAt: string) => ({ createdAt })
    const a = { ...junction('professional_motifs', 'motif_id', IDS.anxiete), ...at('2026-10-08T15:00:00+00:00') }
    const b = () => ({ ...junction('professional_motifs', 'motif_id', IDS.deuil), ...at('2026-10-08T14:00:00+00:00') })
    const c = { ...junction('professional_motifs', 'motif_id', IDS.psychose), ...at('2026-10-08T13:00:00+00:00') }
    expect(historyReadsOn([[a, b()]], true)).toBe(false)
    expect(historyReadsOn([[a, b()], [b(), b()]], true)).toBe(true)
    expect(historyReadsOn([[a, b()], [b(), b()], [b(), c]], true)).toBe(false)
    expect(historyReadsOn([[b(), b()]], true)).toBe(true)
    // The end of the history, or an empty page, stops it.
    expect(historyReadsOn([[b(), b()]], false)).toBe(false)
    expect(historyReadsOn([[a, b()], []], true)).toBe(false)
    expect(historyReadsOn([], true)).toBe(false)
  })

  it('groups by clinic day, newest first', () => {
    const list = events([
      row('professionals', 'update', { years_experience: { before: 1, after: 2 } }, { createdAt: '2026-10-08T14:00:00+00:00' }),
      // 23:30 in Toronto on October 7 (EDT): the clinic's day, not UTC's.
      row('professionals', 'update', { years_experience: { before: 0, after: 1 } }, { createdAt: '2026-10-08T03:30:00+00:00' }),
    ])
    const days = groupHistoryByDay(list)
    expect(days.map((d) => d.label)).toEqual(['Jeudi 8 octobre 2026', 'Mercredi 7 octobre 2026'])
    expect(days.map((d) => d.events.length)).toEqual([1, 1])
  })

  it('cuts days at the clinic midnight on both DST changeovers (America/Toronto)', () => {
    const at = (createdAt: string) => row('professionals', 'update', { years_experience: { before: 1, after: 2 } }, { createdAt })
    // March 8, 2026: EST (UTC−5) until 2:00, then EDT (UTC−4).
    const march = groupHistoryByDay(
      events([at('2026-03-09T04:00:00+00:00'), at('2026-03-09T03:59:00+00:00'), at('2026-03-08T05:00:00+00:00'), at('2026-03-08T04:59:00+00:00')]),
    )
    expect(march.map((d) => [d.label, d.events.length])).toEqual([
      ['Lundi 9 mars 2026', 1],
      ['Dimanche 8 mars 2026', 2],
      ['Samedi 7 mars 2026', 1],
    ])
    // November 1, 2026: EDT until 2:00, then EST.
    const november = groupHistoryByDay(
      events([at('2026-11-02T05:00:00+00:00'), at('2026-11-02T04:59:00+00:00'), at('2026-11-01T04:00:00+00:00'), at('2026-11-01T03:59:00+00:00')]),
    )
    expect(november.map((d) => [d.label, d.events.length])).toEqual([
      ['Lundi 2 novembre 2026', 1],
      ['Dimanche 1 novembre 2026', 2],
      ['Samedi 31 octobre 2026', 1],
    ])
  })

  it('gives each day section a unique key when a day comes back', () => {
    const at = (createdAt: string) => row('professionals', 'update', { years_experience: { before: 1, after: 2 } }, { createdAt })
    const days = groupHistoryByDay(events([at('2026-10-08T14:00:00+00:00'), at('2026-10-07T14:00:00+00:00'), at('2026-10-08T13:00:00+00:00')]))
    expect(days.map((d) => d.date)).toEqual(['2026-10-08', '2026-10-07', '2026-10-08'])
    expect(new Set(days.map((d) => d.key)).size).toBe(3)
  })

  it('« Modifications » leaves out consultations', () => {
    const list = events([row('professional_private', 'read', null), row('professionals', 'update', { years_experience: { before: 1, after: 2 } })])
    expect(filterHistory(list, 'all')).toHaveLength(2)
    expect(filterHistory(list, 'changes').map((e) => e.kind)).toEqual(['change'])
  })
})

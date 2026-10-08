import { describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole, type FixtureRole } from '@/test/role-fixtures'
import { CATALOG_VIEW, recordFixture, seventyTwoMotifsCatalog } from '../../../test/fixtures-domain'
import { IDS } from '../../../test/fixtures'
import type { ProfessionalRecord } from '../../../api/parse'
import { RecordContext } from '../record-context'
import { OverviewTab } from './OverviewTab'

const O = 'modules.professionals.record.overview'
const base = `/professionnels/${IDS.professional}`

function renderOverview(change: (record: ProfessionalRecord) => ProfessionalRecord = (r) => r, role: FixtureRole = 'counselor', catalog = CATALOG_VIEW) {
  render(
    renderWithContexts(
      <RecordContext.Provider value={{ record: change(recordFixture()), catalog }}>
        <OverviewTab />
      </RecordContext.Provider>,
      { access: { access: accessForRole(role) } },
    ),
  )
}

const card = (title: string) => screen.getByRole('heading', { level: 3, name: title }).closest('.rounded-lg') as HTMLElement
/** The digest's value for a label (`<dt>` → `<dd>`). */
const value = (label: string) => within(card(t(`${O}.matching.title`))).getByText(label, { selector: 'dt' }).nextElementSibling?.textContent

const complete = (r: ProfessionalRecord): ProfessionalRecord => ({
  ...r,
  readiness: { complete: true, done: 1, total: 1, items: [{ key: 'matching_profile', done: true, missing: [] }], warnings: [] },
})

describe('OverviewTab — Profil de jumelage', () => {
  it('puts ★ first, groups the motifs by category and names languages and availability', () => {
    renderOverview((r) => ({
      ...r,
      clienteles: [
        { id: IDS.children, specialized: false },
        { id: IDS.couples, specialized: true },
      ],
      motifIds: [IDS.orphan, IDS.anxiete],
      languageIds: [IDS.fr, IDS.en],
      matchingProfile: { ...r.matchingProfile, availabilityNote: 'Pas le vendredi.' },
    }))
    const M = `${O}.matching`
    expect(value(t(`${M}.clienteles`))).toBe(`★ Couples ${t(`${M}.specialized`)} · Enfants (0 à 12 ans)`)
    const motifs = within(card(t(`${M}.title`))).getAllByRole('listitem').map((li) => li.textContent)
    expect(motifs).toEqual(['Vie intérieure\u00a0: Anxiété', 'Autres\u00a0: Sans catégorie'])
    expect(value(t(`${M}.languages`))).toBe('Français · Anglais')
    expect(value(t(`${M}.availability`))).toBe('Matin · Soir')
    expect(value(t(`${M}.accepting`))).toBe(t(`${M}.yes`))
    expect(value(t(`${M}.note`))).toBe('Pas le vendredi.')
  })

  it('keeps 72 held motifs to one line, every name one click away', async () => {
    const big = seventyTwoMotifsCatalog()
    renderOverview((r) => ({ ...r, motifIds: big.motifs.map((m) => m.id) }), 'counselor', big)
    const S = `${O}.matching.motifSummary`
    const digest = card(t(`${O}.matching.title`))
    expect(value(t(`${O}.matching.motifs`))).toContain(t(`${S}.allOverall`, { count: '72' }))
    expect(within(digest).getByText(t(`${S}.archived`, { names: 'Ancien motif' }))).toBeInTheDocument()
    expect(within(digest).queryByText(/Motif 1\.1/)).not.toBeInTheDocument()
    const toggle = within(digest).getByRole('button', { name: t(`${S}.showAll`, { count: '73' }) })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(within(digest).getAllByText(/^Catégorie \d$/)).toHaveLength(8)
    expect(within(digest).getByText(/Motif 1\.1 · Motif 1\.2/)).toBeInTheDocument()
    expect(within(digest).getByRole('button', { name: t(`${S}.hideAll`) })).toHaveAttribute('aria-expanded', 'true')
  })

  it('reads « Tous sauf … » with a few missing, and « N sur M » that unfolds per category', async () => {
    const big = seventyTwoMotifsCatalog()
    const S = `${O}.matching.motifSummary`
    const missing = ['m-0-0', 'm-3-4']
    renderOverview((r) => ({ ...r, motifIds: big.motifs.filter((m) => m.isActive && !missing.includes(m.id)).map((m) => m.id) }), 'counselor', big)
    expect(value(t(`${O}.matching.motifs`))).toContain(t(`${S}.allButOverall`, { names: 'Motif 1.1 et Motif 4.5', selected: '70', total: '72' }))
    cleanup()
    renderOverview((r) => ({ ...r, motifIds: ['m-0-0', 'm-0-1', 'm-0-2', 'm-0-3', 'm-1-0'] }), 'counselor', big)
    const line = t(`${S}.count`, { selected: '4', total: '9' })
    const disclosure = screen.getByText(line).closest('details') as HTMLElement
    expect(disclosure).not.toHaveAttribute('open')
    await userEvent.click(screen.getByText(line))
    expect(disclosure).toHaveAttribute('open')
    expect(within(disclosure).getByText('Motif 1.1 · Motif 1.2 · Motif 1.3 · Motif 1.4')).toBeVisible()
    expect(value(t(`${O}.matching.motifs`))).toContain('Catégorie 2\u00a0: Motif 2.1')
  })

  it('says what is not chosen yet', () => {
    renderOverview((r) => ({ ...r, clienteles: [], specialties: [], motifIds: [], languageIds: [], matchingProfile: { ...r.matchingProfile, availabilityPeriods: [], acceptingNewClients: false } }))
    const M = `${O}.matching`
    expect(value(t(`${M}.clienteles`))).toBe(t(`${M}.empty.clienteles`))
    expect(value(t(`${M}.approaches`))).toBe(t(`${M}.empty.approaches`))
    expect(value(t(`${M}.motifs`))).toBe(t(`${M}.empty.motifs`))
    expect(value(t(`${M}.languages`))).toBe(t(`${M}.empty.languages`))
    expect(value(t(`${M}.availability`))).toBe(t(`${M}.empty.availability`))
    expect(value(t(`${M}.accepting`))).toBe(t(`${M}.no`))
    expect(screen.queryByText(t(`${M}.note`), { selector: 'dt' })).not.toBeInTheDocument()
  })

  it('opens Jumelage from « Modifier » with professionals.matching only', () => {
    renderOverview()
    expect(screen.getByRole('link', { name: t(`${O}.matching.edit`) })).toHaveAttribute('href', `${base}/jumelage`)
  })

  it('has no « Modifier » without professionals.matching', () => {
    render(
      renderWithContexts(
        <RecordContext.Provider value={{ record: recordFixture(), catalog: CATALOG_VIEW }}>
          <OverviewTab />
        </RecordContext.Provider>,
        { access: { access: accessForRole('counselor', { permissions: ['professionals.view'] }) } },
      ),
    )
    expect(screen.queryByRole('link', { name: t(`${O}.matching.edit`) })).not.toBeInTheDocument()
  })
})

describe('OverviewTab — Dossier', () => {
  it('lists what is missing while not active, each part a link to its tab', () => {
    renderOverview()
    const dossier = card(t(`${O}.readiness.title`))
    expect(within(dossier).getByText(t('modules.professionals.readiness.items.matching_profile'))).toBeInTheDocument()
    expect(within(dossier).getByRole('link', { name: t('modules.professionals.readiness.missing.clientele') })).toHaveAttribute('href', `${base}/jumelage`)
    expect(within(dossier).getByRole('link', { name: t('modules.professionals.readiness.missing.motif') })).toHaveAttribute('href', `${base}/jumelage`)
  })

  it('sends a title gap to Identité et permis', () => {
    renderOverview((r) => ({ ...r, readiness: { ...r.readiness, items: [{ key: 'matching_profile', done: false, missing: ['licence'] }] } }))
    expect(screen.getByRole('link', { name: t('modules.professionals.readiness.missing.licence') })).toHaveAttribute('href', `${base}/identite`)
  })

  it('reads « Dossier complet » once active and complete', () => {
    renderOverview((r) => complete({ ...r, professional: { ...r.professional, status: 'active' } }))
    expect(within(card(t(`${O}.readiness.title`))).getByText(t(`${O}.readiness.complete`))).toBeInTheDocument()
  })

  it('gives the override reason of a file activated incomplete, and its gaps', () => {
    renderOverview((r) => ({ ...r, professional: { ...r.professional, status: 'active', activationOverrideReason: 'Dossier complété hors application' } }))
    const dossier = card(t(`${O}.readiness.title`))
    expect(within(dossier).getByText(t(`${O}.readiness.override`, { reason: 'Dossier complété hors application' }))).toBeInTheDocument()
    expect(within(dossier).getByRole('link', { name: t('modules.professionals.readiness.missing.motif') })).toBeInTheDocument()
  })
})

describe('OverviewTab — À surveiller and Prochaine action', () => {
  it('links each flag to the tab that settles it', () => {
    renderOverview((r) => ({ ...r, readiness: { ...r.readiness, warnings: ['login_email_mismatch'] } }))
    const watch = card(t(`${O}.watch.title`))
    expect(within(watch).getByRole('link', { name: t('modules.professionals.watch.matching_incomplete') })).toHaveAttribute('href', `${base}/jumelage`)
    expect(within(watch).getByRole('link', { name: t('modules.professionals.watch.login_email_mismatch') })).toHaveAttribute('href', `${base}/identite`)
  })

  it('has nothing to report on a complete file', () => {
    renderOverview(complete)
    expect(within(card(t(`${O}.watch.title`))).getByText(t(`${O}.watch.nothing`))).toBeInTheDocument()
  })

  it('offers « Compléter » to whoever may edit the matching profile', () => {
    renderOverview()
    const next = card(t(`${O}.nextAction.title`))
    expect(within(next).getByText(t('modules.professionals.readiness.nextAction.completeMatching'))).toBeInTheDocument()
    expect(within(next).getByRole('link', { name: t('modules.professionals.readiness.nextAction.complete') })).toHaveAttribute('href', `${base}/jumelage`)
  })

  it('says a complete file is ready, with no button (the header holds « Activer »)', () => {
    renderOverview(complete)
    const next = card(t(`${O}.nextAction.title`))
    expect(within(next).getByText(t('modules.professionals.readiness.nextAction.readyToActivate'))).toBeInTheDocument()
    expect(within(next).queryByRole('link')).not.toBeInTheDocument()
  })
})

import { describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole, type FixtureRole } from '@/test/role-fixtures'
import { buildCatalogView } from '../../../lib/catalog-view'
import { CATALOG, CATALOG_VIEW, recordFixture, websiteSizedCatalog } from '../../../test/fixtures-domain'
import { IDS } from '../../../test/fixtures'
import type { Onboarding, ProfessionalRecord } from '../../../api/parse'
import { RecordContext } from '../record-context'
import { OverviewTab } from './OverviewTab'

const O = 'modules.professionals.record.overview'
const base = `/professionnels/${IDS.professional}`

function renderOverview(
  change: (record: ProfessionalRecord) => ProfessionalRecord = (r) => r,
  role: FixtureRole = 'counselor',
  catalog = CATALOG_VIEW,
  onboarding: Onboarding | null = null,
) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {renderWithContexts(
        <RecordContext.Provider value={{ record: change(recordFixture()), catalog, onboarding, focusHeading: () => {} }}>
          <OverviewTab />
        </RecordContext.Provider>,
        { access: { access: accessForRole(role) } },
      )}
    </QueryClientProvider>,
  )
}

const card = (title: string) => screen.getByRole('heading', { level: 3, name: title }).closest('.rounded-lg') as HTMLElement
/** The digest's value for a label (`<dt>` → `<dd>`). */
const value = (label: string) => within(card(t(`${O}.matching.title`))).getByText(label, { selector: 'dt' }).nextElementSibling?.textContent

describe('OverviewTab — Profil de jumelage', () => {
  it('puts ★ first, lists the motifs by category and names languages and availability', () => {
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
    // Each category on its own line, its motifs named under it once opened (folded in Aperçu).
    const digest = card(t(`${M}.title`))
    expect(within(digest).getByRole('button', { name: /Vie intérieure/, expanded: false })).toBeInTheDocument()
    expect(within(digest).getByText('Anxiété', { selector: 'li' })).not.toBeVisible()
    expect(within(digest).getByRole('button', { name: new RegExp(t('modules.professionals.otherCategory')) })).toBeInTheDocument()
    expect(within(digest).getByText('Sans catégorie', { selector: 'li' })).toBeInTheDocument()
    expect(value(t(`${M}.languages`))).toBe('Français · Anglais')
    expect(value(t(`${M}.availability`))).toBe('Matin · Soir')
    expect(value(t(`${M}.accepting`))).toBe(t(`${M}.yes`))
    expect(value(t(`${M}.note`))).toBe('Pas le vendredi.')
  })

  it('folds every motif of a professional holding them all, one click from every name, never « Tous » (P4-249)', async () => {
    const user = userEvent.setup()
    const big = websiteSizedCatalog()
    renderOverview((r) => ({ ...r, motifIds: big.motifs.map((m) => m.id) }), 'counselor', big)
    const digest = card(t(`${O}.matching.title`))
    const S = `${O}.matching.motifSummary`
    const active = big.motifs.filter((m) => m.isActive)
    // Folded: the categories and their counts only.
    for (const motif of active) expect(within(digest).getByText(motif.name, { selector: 'li' })).not.toBeVisible()
    // « Afficher les N motifs » (archived one included) opens every category; the button then folds them back.
    await user.click(within(digest).getByRole('button', { name: t(`${S}.showAll`, { count: String(big.motifs.length) }) }))
    for (const motif of active) expect(within(digest).getByText(motif.name, { selector: 'li' })).toBeVisible()
    expect(within(digest).getAllByRole('listitem').find((li) => li.textContent === `Ancien motif (${t(`${O}.matching.archived`)})`)).toBeVisible()
    await user.click(within(digest).getByRole('button', { name: t(`${S}.hideAll`) }))
    for (const motif of active) expect(within(digest).getByText(motif.name, { selector: 'li' })).not.toBeVisible()
    expect(within(digest).queryByText(/^Tous/)).not.toBeInTheDocument()
    // A count beside each of the 13 titles, in addition to the names.
    expect(within(digest).getAllByText(t(`${S}.countShort`, { selected: '19', total: '19' }))).toHaveLength(1)
    expect(within(digest).getByText('Catégorie 13')).toBeInTheDocument()
  })

  it('opens one category at a time from its own line', async () => {
    const user = userEvent.setup()
    renderOverview((r) => ({ ...r, motifIds: [IDS.anxiete] }))
    const digest = card(t(`${O}.matching.title`))
    const category = within(digest).getByRole('button', { name: /Vie intérieure/ })
    await user.click(category)
    expect(category).toHaveAttribute('aria-expanded', 'true')
    expect(within(digest).getByText('Anxiété', { selector: 'li' })).toBeVisible()
    // One motif held: the global button names it in the singular, then folds it back once all are open.
    expect(within(digest).getByRole('button', { name: t(`${O}.matching.motifSummary.hideAll`) })).toBeInTheDocument()
    await user.click(category)
    expect(within(digest).getByText('Anxiété', { selector: 'li' })).not.toBeVisible()
    expect(within(digest).getByRole('button', { name: t(`${O}.matching.motifSummary.showOne`) })).toBeInTheDocument()
  })

  it('reads the client limits with the clientèles (P4-245)', () => {
    const M = `${O}.matching`
    renderOverview((r) => ({ ...r, clienteles: [{ id: IDS.children, specialized: false }], matchingProfile: { ...r.matchingProfile, minClientAge: 8, womenOnly: true } }))
    expect(value(t(`${M}.clienteles`))).toBe(`Enfants (8 ans et plus)${t('modules.professionals.display.womenOnly')}`)
    cleanup()
    renderOverview((r) => ({ ...r, clienteles: [{ id: IDS.couples, specialized: false }], matchingProfile: { ...r.matchingProfile, minClientAge: 14 } }))
    expect(value(t(`${M}.clienteles`))).toBe(`Couples${t('modules.professionals.display.minClientAge', { age: '14', unit: 'ans' })}`)
  })

  it('reads the places offered with their date, « Non suivies » without, and the staff note « Bon à savoir » (P4-382, P4-384)', () => {
    const M = `${O}.matching`
    renderOverview()
    expect(value(t(`${M}.places`))).toBe(t(`${M}.placesNotTracked`))
    expect(within(card(t(`${M}.title`))).queryByText(t(`${M}.matchingNote`), { selector: 'dt' })).not.toBeInTheDocument()
    cleanup()
    renderOverview((r) => ({
      ...r,
      matchingProfile: { ...r.matchingProfile, newClientPlaces: 4, newClientPlacesSetAt: '2026-10-08T14:00:00Z' },
      matchingNote: { note: 'Écrire avant de réserver.\nPas de couples l’été.', updatedAt: '2026-10-08T15:00:00Z' },
    }))
    expect(value(t(`${M}.places`))).toMatch(/^4 places offertes · depuis le 8 oct\./)
    expect(value(t(`${M}.matchingNote`))).toBe('Écrire avant de réserver.\nPas de couples l’été.')
    cleanup()
    renderOverview((r) => ({ ...r, matchingProfile: { ...r.matchingProfile, newClientPlaces: 0, newClientPlacesSetAt: '2026-10-08T14:00:00Z' } }))
    expect(value(t(`${M}.places`))).toMatch(/^Aucune place offerte · depuis le/)
  })

  it('marks a held archived clientèle « (archivé) »', () => {
    const archive = <T extends { id: string; isActive: boolean }>(rows: T[], id: string) => rows.map((row) => (row.id === id ? { ...row, isActive: false } : row))
    const catalog = buildCatalogView({ ...CATALOG, clienteles: archive(CATALOG.clienteles, IDS.couples) })
    renderOverview((r) => r, 'counselor', catalog)
    const M = `${O}.matching`
    expect(value(t(`${M}.clienteles`))).toBe(`★ Couples ${t(`${M}.specialized`)} (${t(`${M}.archived`)})`)
    expect(screen.queryByText('Approches', { selector: 'dt' })).not.toBeInTheDocument()
  })

  it('says what is not chosen yet', () => {
    renderOverview((r) => ({ ...r, clienteles: [], motifIds: [], languageIds: [], matchingProfile: { ...r.matchingProfile, availabilityPeriods: [], acceptingNewClients: false } }))
    const M = `${O}.matching`
    expect(value(t(`${M}.clienteles`))).toBe(t(`${M}.empty.clienteles`))
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
    // « Prochaine action » may read the contract card (Task 4d.3): a query client, as in the app.
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        {renderWithContexts(
          <RecordContext.Provider value={{ record: recordFixture(), catalog: CATALOG_VIEW, onboarding: null, focusHeading: () => {} }}>
            <OverviewTab />
          </RecordContext.Provider>,
          { access: { access: accessForRole('counselor', { permissions: ['professionals.view'] }) } },
        )}
      </QueryClientProvider>,
    )
    
    expect(screen.queryByRole('link', { name: t(`${O}.matching.edit`) })).not.toBeInTheDocument()
  })
})

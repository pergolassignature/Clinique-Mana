import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

/** Complete: matching done, the account created, the questionnaire approved (4b.1). */
const complete = (r: ProfessionalRecord): ProfessionalRecord => ({
  ...r,
  professional: { ...r.professional, profileId: 'user-1' },
  readiness: {
    complete: true,
    done: 3,
    total: 3,
    items: [
      { key: 'matching_profile', done: true, missing: [] },
      { key: 'account_created', done: true, missing: [] },
      { key: 'submission_approved', done: true, missing: [] },
    ],
    warnings: [],
  },
})

/** Matching done; the account and the questionnaire still to come (an invited file). */
const awaitingOnboarding = (r: ProfessionalRecord): ProfessionalRecord => ({
  ...r,
  professional: { ...r.professional, status: 'invited' },
  readiness: {
    complete: false,
    done: 1,
    total: 3,
    items: [
      { key: 'matching_profile', done: true, missing: [] },
      { key: 'account_created', done: false, missing: [] },
      { key: 'submission_approved', done: false, missing: [] },
    ],
    warnings: [],
  },
})

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
    // Each category's name on its own line, its motifs named under it, nothing to unfold.
    const digest = card(t(`${M}.title`))
    expect(within(digest).getByText('Vie intérieure')).toBeInTheDocument()
    expect(within(digest).getByText('Anxiété', { selector: 'li' })).toBeInTheDocument()
    expect(within(digest).getByText(t('modules.professionals.otherCategory'), { selector: 'span' })).toBeInTheDocument()
    expect(within(digest).getByText('Sans catégorie', { selector: 'li' })).toBeInTheDocument()
    expect(within(digest).queryAllByRole('button')).toEqual([])
    expect(value(t(`${M}.languages`))).toBe('Français · Anglais')
    expect(value(t(`${M}.availability`))).toBe('Matin · Soir')
    expect(value(t(`${M}.accepting`))).toBe(t(`${M}.yes`))
    expect(value(t(`${M}.note`))).toBe('Pas le vendredi.')
  })

  it('writes out every motif of a professional holding them all: names, never « Tous » (P4-249)', () => {
    const big = websiteSizedCatalog()
    renderOverview((r) => ({ ...r, motifIds: big.motifs.map((m) => m.id) }), 'counselor', big)
    const digest = card(t(`${O}.matching.title`))
    const S = `${O}.matching.motifSummary`
    // Every active motif is a visible line, the archived one marked in its category; nothing folds.
    for (const motif of big.motifs.filter((m) => m.isActive)) expect(within(digest).getByText(motif.name, { selector: 'li' })).toBeVisible()
    expect(within(digest).getAllByRole('listitem').find((li) => li.textContent === `Ancien motif (${t(`${O}.matching.archived`)})`)).toBeVisible()
    expect(within(digest).queryAllByRole('button')).toEqual([])
    expect(within(digest).queryByText(/^Tous/)).not.toBeInTheDocument()
    // A count beside each of the 13 titles, in addition to the names.
    expect(within(digest).getAllByText(t(`${S}.countShort`, { selected: '19', total: '19' }))).toHaveLength(1)
    expect(within(digest).getByText('Catégorie 13')).toBeInTheDocument()
  })

  it('reads the client limits with the clientèles (P4-245)', () => {
    const M = `${O}.matching`
    renderOverview((r) => ({ ...r, clienteles: [{ id: IDS.children, specialized: false }], matchingProfile: { ...r.matchingProfile, minClientAge: 8, womenOnly: true } }))
    expect(value(t(`${M}.clienteles`))).toBe(`Enfants (8 ans et plus)${t('modules.professionals.display.womenOnly')}`)
    cleanup()
    renderOverview((r) => ({ ...r, clienteles: [{ id: IDS.couples, specialized: false }], matchingProfile: { ...r.matchingProfile, minClientAge: 14 } }))
    expect(value(t(`${M}.clienteles`))).toBe(`Couples${t('modules.professionals.display.minClientAge', { age: '14', unit: 'ans' })}`)
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
    render(
      renderWithContexts(
        <RecordContext.Provider value={{ record: recordFixture(), catalog: CATALOG_VIEW, onboarding: null, focusHeading: () => {} }}>
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

  it('says a complete file is ready, with no button for whoever cannot activate', () => {
    renderOverview(complete)
    const next = card(t(`${O}.nextAction.title`))
    expect(within(next).getByText(t('modules.professionals.readiness.nextAction.readyToActivate'))).toBeInTheDocument()
    expect(within(next).queryByRole('link')).not.toBeInTheDocument()
    expect(within(next).queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('OverviewTab — the onboarding (Task 4b.3)', () => {
  // Thursday 8 October 2026, 16:00 in Toronto: the dates read « 8 oct. ».
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T20:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  const sent = (state: 'sent' | 'opened' | 'expired' | 'revoked' | 'used'): Onboarding => ({
    invitation: {
      state,
      sentAt: '2026-10-05T14:00:00Z',
      expiresAt: '2026-10-12T14:00:00Z',
      openedAt: state === 'opened' ? '2026-10-06T14:00:00Z' : null,
      usedAt: state === 'used' ? '2026-10-06T15:00:00Z' : null,
    },
    submission: null,
    onboardingApproved: false,
  })
  const R = 'modules.professionals.readiness'

  it('says where the invitation stands under « Compte créé », in plain words', () => {
    renderOverview(awaitingOnboarding, 'admin_assistant', CATALOG_VIEW, sent('opened'))
    const dossier = card(t(`${O}.readiness.title`))
    expect(within(dossier).getByText('Invitation envoyée le 5 oct. · ouverte le 6 oct. · expire le 12 oct.')).toBeInTheDocument()
    expect(within(dossier).getByText(t('modules.professionals.onboarding.questionnaire.afterInvitation'))).toBeInTheDocument()
  })

  it('an expired link: the line says to send a new one, « Prochaine action » offers it, « À surveiller » flags it', () => {
    renderOverview(awaitingOnboarding, 'admin_assistant', CATALOG_VIEW, { ...sent('expired') })
    expect(within(card(t(`${O}.readiness.title`))).getByText('Lien expiré le 12 oct. — envoyez un nouveau lien.')).toBeInTheDocument()
    expect(within(card(t(`${O}.watch.title`))).getByText('Invitation expirée')).toBeInTheDocument()
    const next = card(t(`${O}.nextAction.title`))
    expect(within(next).getByText(t(`${R}.nextAction.invitationExpired`, { date: '12 oct.' }))).toBeInTheDocument()
  })

  it('no invitation yet: « Envoyer l’invitation » for an inviter opens its confirmation, naming the address', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
    renderOverview(awaitingOnboarding, 'admin', CATALOG_VIEW, null)
    expect(within(card(t(`${O}.readiness.title`))).getByText('Aucune invitation envoyée.')).toBeInTheDocument()
    const next = card(t(`${O}.nextAction.title`))
    expect(within(next).getByText(t(`${R}.nextAction.notInvited`, { firstName: 'Marie' }))).toBeInTheDocument()
    await user.click(within(next).getByRole('button', { name: "Envoyer l'invitation" }))
    const dialog = await screen.findByRole('alertdialog', { name: "Envoyer l'invitation à Marie Tremblay ?" })
    expect(within(dialog).getByText(/marie\.t@exemple\.ca/)).toBeInTheDocument()
  })

  it('closing the confirmation opened from « Prochaine action » returns focus to its button', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
    renderOverview(awaitingOnboarding, 'admin', CATALOG_VIEW, null)
    const button = within(card(t(`${O}.nextAction.title`))).getByRole('button', { name: "Envoyer l'invitation" })
    await user.click(button)
    const dialog = await screen.findByRole('alertdialog', { name: "Envoyer l'invitation à Marie Tremblay ?" })
    await user.click(within(dialog).getByRole('button', { name: t('common.cancel') }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(button).toHaveFocus()
  })

  it('a revoked link: « Prochaine action » says so and offers a new invitation', () => {
    renderOverview(awaitingOnboarding, 'admin', CATALOG_VIEW, sent('revoked'))
    const next = card(t(`${O}.nextAction.title`))
    expect(within(next).getByText("L'invitation de Marie a été révoquée : son lien ne fonctionne plus.")).toBeInTheDocument()
    expect(within(next).getByRole('button', { name: "Envoyer l'invitation" })).toBeInTheDocument()
  })

  it('a counselor reads the same sentence, without the button', () => {
    renderOverview(awaitingOnboarding, 'counselor', CATALOG_VIEW, null)
    const next = card(t(`${O}.nextAction.title`))
    expect(within(next).getByText(t(`${R}.nextAction.notInvited`, { firstName: 'Marie' }))).toBeInTheDocument()
    expect(within(next).queryByRole('button')).not.toBeInTheDocument()
  })

  it('a questionnaire sent: « Dossier à réviser » and « Envoyé le … — à réviser »', () => {
    const submitted: Onboarding = { invitation: sent('used').invitation, submission: { id: 's1', kind: 'onboarding', status: 'submitted', submittedAt: '2026-10-07T15:00:00Z' }, onboardingApproved: false }
    renderOverview((r) => ({ ...awaitingOnboarding(r), professional: { ...r.professional, status: 'in_review', profileId: 'user-1' } }), 'admin', CATALOG_VIEW, submitted)
    expect(within(card(t(`${O}.readiness.title`))).getByText('Envoyé le 7 oct. — à réviser.')).toBeInTheDocument()
    expect(within(card(t(`${O}.watch.title`))).getByText('Dossier à réviser')).toBeInTheDocument()
    expect(within(card(t(`${O}.nextAction.title`))).getByText(t(`${R}.nextAction.reviewOnboarding`, { firstName: 'Marie', date: '7 oct.' }))).toBeInTheDocument()
  })
})

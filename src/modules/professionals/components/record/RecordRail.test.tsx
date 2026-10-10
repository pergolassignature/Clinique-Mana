import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole, type FixtureRole } from '@/test/role-fixtures'
import { CATALOG_VIEW, recordFixture } from '../../test/fixtures-domain'
import { IDS } from '../../test/fixtures'
import type { Onboarding, ProfessionalRecord } from '../../api/parse'
import { RecordContext } from './record-context'
import type { RecordTab } from '../../lib/constants'
import { RecordRail, type RailLayout } from './RecordRail'

const O = 'modules.professionals.record.overview'
const base = `/professionnels/${IDS.professional}`

function renderRail(
  change: (record: ProfessionalRecord) => ProfessionalRecord = (r) => r,
  role: FixtureRole = 'counselor',
  catalog = CATALOG_VIEW,
  onboarding: Onboarding | null = null,
  { tab = 'apercu', layout = 'stack' }: { tab?: RecordTab; layout?: RailLayout } = {},
) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {renderWithContexts(
        <RecordContext.Provider value={{ record: change(recordFixture()), catalog, onboarding, focusHeading: () => {} }}>
          <RecordRail tab={tab} layout={layout} />
        </RecordContext.Provider>,
        { access: { access: accessForRole(role) } },
      )}
    </QueryClientProvider>,
  )
}

const card = (title: string) => screen.getByRole('heading', { level: 3, name: title }).closest('.rounded-lg') as HTMLElement

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


describe('RecordRail — Dossier', () => {
  it('lists what is missing while not active, each part a link to its tab', () => {
    renderRail()
    const dossier = card(t(`${O}.readiness.title`))
    expect(within(dossier).getByText(t('modules.professionals.readiness.pending.matching_profile'))).toBeInTheDocument()
    expect(within(dossier).queryByText(t('modules.professionals.readiness.items.matching_profile'))).not.toBeInTheDocument()
    expect(within(dossier).getByRole('link', { name: t('modules.professionals.readiness.missing.clientele') })).toHaveAttribute('href', `${base}/jumelage`)
    expect(within(dossier).getByRole('link', { name: t('modules.professionals.readiness.missing.motif') })).toHaveAttribute('href', `${base}/jumelage`)
  })

  it('sends a title gap to Identité et permis', () => {
    renderRail((r) => ({ ...r, readiness: { ...r.readiness, items: [{ key: 'matching_profile', done: false, missing: ['licence'] }] } }))
    expect(screen.getByRole('link', { name: t('modules.professionals.readiness.missing.licence') })).toHaveAttribute('href', `${base}/identite`)
  })

  it('reads « Dossier complet » once active and complete', () => {
    renderRail((r) => complete({ ...r, professional: { ...r.professional, status: 'active' } }))
    expect(within(card(t(`${O}.readiness.title`))).getByText(t(`${O}.readiness.complete`))).toBeInTheDocument()
  })

  it('gives the override reason of a file activated incomplete, and its gaps', () => {
    renderRail((r) => ({ ...r, professional: { ...r.professional, status: 'active', activationOverrideReason: 'Dossier complété hors application' } }))
    const dossier = card(t(`${O}.readiness.title`))
    expect(within(dossier).getByText(t(`${O}.readiness.override`, { reason: 'Dossier complété hors application' }))).toBeInTheDocument()
    expect(within(dossier).getByRole('link', { name: t('modules.professionals.readiness.missing.motif') })).toBeInTheDocument()
  })
})

describe('RecordRail — an inactive file (P4-510)', () => {
  it('says why and since when on « Dossier », with the note', () => {
    renderRail((r) => ({
      ...r,
      professional: { ...r.professional, status: 'inactive', statusChangedAt: '2026-10-03T14:00:00Z', deactivationReasonId: IDS.other, deactivationNote: 'Retour prévu en janvier.' },
    }))
    const dossier = card(t(`${O}.readiness.title`))
    expect(within(dossier).getByText(t('modules.professionals.watch.inactiveSinceFor', { date: '3 oct. 2026', reason: 'Autre' }))).toBeInTheDocument()
    expect(within(dossier).getByText(t(`${O}.readiness.inactiveNote`, { note: 'Retour prévu en janvier.' }))).toBeInTheDocument()
  })

  it('an active file says nothing of the kind', () => {
    renderRail()
    expect(screen.queryByText(/^Inactif depuis/)).not.toBeInTheDocument()
  })
})

describe('RecordRail — À surveiller and Prochaine action', () => {
  it('links each flag to the tab that settles it', () => {
    renderRail((r) => ({ ...r, readiness: { ...r.readiness, warnings: ['login_email_mismatch'] } }))
    const watch = card(t(`${O}.watch.title`))
    expect(within(watch).getByRole('link', { name: t('modules.professionals.watch.matching_incomplete') })).toHaveAttribute('href', `${base}/jumelage`)
    expect(within(watch).getByRole('link', { name: t('modules.professionals.watch.login_email_mismatch') })).toHaveAttribute('href', `${base}/identite`)
  })

  it('has nothing to report on a complete file', () => {
    renderRail(complete)
    expect(within(card(t(`${O}.watch.title`))).getByText(t(`${O}.watch.nothing`))).toBeInTheDocument()
  })

  it('offers « Compléter » to whoever may edit the matching profile (a file with an account, P4-501)', () => {
    renderRail((r) => ({ ...r, professional: { ...r.professional, profileId: 'user-1' } }))
    const next = card(t(`${O}.nextAction.title`))
    expect(within(next).getByText(t('modules.professionals.readiness.nextAction.completeMatching'))).toBeInTheDocument()
    expect(within(next).getByRole('link', { name: t('modules.professionals.readiness.nextAction.complete') })).toHaveAttribute('href', `${base}/jumelage`)
  })

  it('says a complete file is ready, with no button for whoever cannot activate', () => {
    renderRail(complete)
    const next = card(t(`${O}.nextAction.title`))
    expect(within(next).getByText(t('modules.professionals.readiness.nextAction.readyToActivate'))).toBeInTheDocument()
    expect(within(next).queryByRole('link')).not.toBeInTheDocument()
    expect(within(next).queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('RecordRail — the onboarding (Task 4b.3)', () => {
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
      delivery: 'email',
      emailStatus: 'sent',
      emailError: null,
    },
    submission: null,
    onboardingApproved: false,
  })
  const R = 'modules.professionals.readiness'

  it('says where the invitation stands under « Compte créé », in plain words', () => {
    renderRail(awaitingOnboarding, 'admin_assistant', CATALOG_VIEW, sent('opened'))
    const dossier = card(t(`${O}.readiness.title`))
    expect(within(dossier).getByText('Invitation envoyée le 5 oct. · ouverte le 6 oct. · expire le 12 oct.')).toBeInTheDocument()
    expect(within(dossier).getByText(t('modules.professionals.onboarding.questionnaire.afterInvitation'))).toBeInTheDocument()
  })

  it('an expired link: the line says to send a new one, « Prochaine action » offers it, « À surveiller » flags it', () => {
    renderRail(awaitingOnboarding, 'admin_assistant', CATALOG_VIEW, { ...sent('expired') })
    expect(within(card(t(`${O}.readiness.title`))).getByText('Lien expiré le 12 oct. : envoyez un nouveau lien.')).toBeInTheDocument()
    expect(within(card(t(`${O}.watch.title`))).getByText('Invitation expirée')).toBeInTheDocument()
    const next = card(t(`${O}.nextAction.title`))
    expect(within(next).getByText(t(`${R}.nextAction.invitationExpired`, { date: '12 oct.' }))).toBeInTheDocument()
  })

  it('no invitation yet: « Envoyer l’invitation » for an inviter opens its confirmation, naming the address', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
    renderRail(awaitingOnboarding, 'admin', CATALOG_VIEW, null)
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
    renderRail(awaitingOnboarding, 'admin', CATALOG_VIEW, null)
    const button = within(card(t(`${O}.nextAction.title`))).getByRole('button', { name: "Envoyer l'invitation" })
    await user.click(button)
    const dialog = await screen.findByRole('alertdialog', { name: "Envoyer l'invitation à Marie Tremblay ?" })
    await user.click(within(dialog).getByRole('button', { name: t('common.cancel') }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(button).toHaveFocus()
  })

  it('a revoked link: « Prochaine action » says so and offers a new invitation', () => {
    renderRail(awaitingOnboarding, 'admin', CATALOG_VIEW, sent('revoked'))
    const next = card(t(`${O}.nextAction.title`))
    expect(within(next).getByText("L'invitation de Marie a été révoquée : son lien ne fonctionne plus.")).toBeInTheDocument()
    expect(within(next).getByRole('button', { name: "Envoyer l'invitation" })).toBeInTheDocument()
  })

  it('a counselor reads the same sentence, without the button', () => {
    renderRail(awaitingOnboarding, 'counselor', CATALOG_VIEW, null)
    const next = card(t(`${O}.nextAction.title`))
    expect(within(next).getByText(t(`${R}.nextAction.notInvited`, { firstName: 'Marie' }))).toBeInTheDocument()
    expect(within(next).queryByRole('button')).not.toBeInTheDocument()
  })

  it('a questionnaire sent: « Dossier à réviser » and « Envoyé le …, à réviser »', () => {
    const submitted: Onboarding = { invitation: sent('used').invitation, submission: { id: 's1', kind: 'onboarding', status: 'submitted', submittedAt: '2026-10-07T15:00:00Z' }, onboardingApproved: false }
    renderRail((r) => ({ ...awaitingOnboarding(r), professional: { ...r.professional, status: 'in_review', profileId: 'user-1' } }), 'admin', CATALOG_VIEW, submitted)
    expect(within(card(t(`${O}.readiness.title`))).getByText('Envoyé le 7 oct., à réviser.')).toBeInTheDocument()
    expect(within(card(t(`${O}.watch.title`))).getByText('Dossier à réviser')).toBeInTheDocument()
    expect(within(card(t(`${O}.nextAction.title`))).getByText(t(`${R}.nextAction.reviewOnboarding`, { firstName: 'Marie', date: '7 oct.' }))).toBeInTheDocument()
  })

  it('a questionnaire sent: the documents gap says they count once it is approved; the review stays the next action (P4-495)', () => {
    const submitted: Onboarding = { invitation: sent('used').invitation, submission: { id: 's1', kind: 'update', status: 'submitted', submittedAt: '2026-10-07T15:00:00Z' }, onboardingApproved: true }
    const withDocuments = (r: ProfessionalRecord): ProfessionalRecord => ({
      ...r,
      professional: { ...r.professional, status: 'active', profileId: 'user-1' },
      readiness: {
        complete: false,
        done: 3,
        total: 4,
        items: [...r.readiness.items.slice(0, 3), { key: 'documents', done: false, missing: ['photo', 'insurance'] }],
        warnings: [],
      },
    })
    renderRail(withDocuments, 'admin', CATALOG_VIEW, submitted)
    const dossier = card(t(`${O}.readiness.title`))
    expect(within(dossier).getByRole('link', { name: t(`${R}.missing.photo`) })).toHaveAttribute('href', `${base}/documents`)
    expect(dossier).toHaveTextContent(`la preuve d'assurance. ${t(`${O}.readiness.questionnaireDocuments`)}`)
    expect(within(card(t(`${O}.nextAction.title`))).getByText(t(`${R}.nextAction.reviewUpdate`, { firstName: 'Marie', date: '7 oct.' }))).toBeInTheDocument()
  })

  it('an update sent on a file activated without an approved questionnaire: « Mise à jour envoyée le …, à réviser. » (P4-497)', () => {
    const submitted: Onboarding = { invitation: sent('used').invitation, submission: { id: 's1', kind: 'update', status: 'submitted', submittedAt: '2026-10-07T15:00:00Z' }, onboardingApproved: false }
    renderRail((r) => ({ ...awaitingOnboarding(r), professional: { ...r.professional, status: 'active', profileId: 'user-1' } }), 'admin', CATALOG_VIEW, submitted)
    const dossier = card(t(`${O}.readiness.title`))
    expect(within(dossier).getByText('Mise à jour envoyée le 7 oct., à réviser.')).toBeInTheDocument()
    expect(within(dossier).queryByText(t('modules.professionals.onboarding.questionnaire.none'))).not.toBeInTheDocument()
  })
})

describe('RecordRail — layouts and « En bref »', () => {
  const B = 'modules.professionals.record.rail'
  const brief = (label: string) => within(card(t(`${B}.brief`))).getByText(label, { selector: 'dt' }).nextElementSibling?.textContent

  it('is one named region holding « Dossier », « À surveiller » and « Prochaine action », in that order', () => {
    renderRail()
    const rail = screen.getByRole('region', { name: t(`${B}.label`) })
    expect(within(rail).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      t(`${O}.readiness.title`),
      t(`${O}.watch.title`),
      t(`${O}.nextAction.title`),
    ])
  })

  it('adds « En bref » beside a tab that does not show the places and availability', () => {
    renderRail(
      (r) => ({ ...r, matchingProfile: { ...r.matchingProfile, acceptingNewClients: false, newClientPlaces: null, newClientPlacesSetAt: null } }),
      'counselor',
      CATALOG_VIEW,
      null,
      { tab: 'identite', layout: 'column' },
    )
    expect(brief(t(`${O}.matching.places`))).toBe(t(`${O}.matching.placesNotTracked`))
    expect(brief(t(`${B}.accepting`))).toBe(t(`${O}.matching.no`))
    expect(brief(t(`${B}.availability`))).toBeTruthy()
  })

  it('leaves « En bref » out on Aperçu and Jumelage, which show it, and out of the tiles', () => {
    for (const options of [
      { tab: 'apercu', layout: 'column' },
      { tab: 'jumelage', layout: 'column' },
      { tab: 'identite', layout: 'tiles' },
    ] as const) {
      renderRail((r) => r, 'counselor', CATALOG_VIEW, null, options)
      expect(screen.queryByRole('heading', { name: t(`${B}.brief`) })).not.toBeInTheDocument()
      cleanup()
    }
  })
})

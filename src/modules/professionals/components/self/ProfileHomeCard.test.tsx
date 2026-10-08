import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import type { MySubmission } from '../../api/self'
import { mySubmission } from '../../test/fixtures-questionnaire'
import { setupQueryClient } from '../../test/query-client'
import { ProfileHomeCard } from './ProfileHomeCard'

const mocks = vi.hoisted(() => ({ fetchMySubmission: vi.fn() }))
vi.mock('../../api/self', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/self')>()), fetchMySubmission: mocks.fetchMySubmission }))

const H = 'modules.professionals.myProfile.home'

function renderCard(submission: MySubmission | null) {
  mocks.fetchMySubmission.mockResolvedValue(submission)
  const { queryClient } = setupQueryClient()
  return render(renderWithContexts(<QueryClientProvider client={queryClient}>{<ProfileHomeCard />}</QueryClientProvider>, { path: '/accueil' }))
}

afterEach(() => vi.clearAllMocks())

describe('ProfileHomeCard', () => {
  it('« Complétez votre profil » while the onboarding questionnaire is open', async () => {
    renderCard(mySubmission())
    expect(await screen.findByRole('heading', { name: t(`${H}.onboarding.title`) })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t(`${H}.onboarding.action`) })).toHaveAttribute('href', '/mon-profil/questionnaire')
  })

  it('an update names its sections', async () => {
    renderCard(mySubmission({ kind: 'update', requested_sections: ['languages', 'motifs'] }))
    expect(await screen.findByText(t(`${H}.update.body`, { sections: 'Langues et Motifs' }))).toBeInTheDocument()
  })

  it('a profile sent back says the clinic asks for details', async () => {
    renderCard(mySubmission({ decision_note: 'Précisez vos langues.' }))
    expect(await screen.findByRole('heading', { name: t(`${H}.returned.title`) })).toBeInTheDocument()
  })

  it('nothing when the profile is sent, or nothing is open', async () => {
    const { container, unmount } = renderCard(mySubmission({ status: 'submitted', submitted_at: '2026-10-08T14:00:00Z' }))
    await vi.waitFor(() => expect(mocks.fetchMySubmission).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
    unmount()
    const empty = renderCard(null)
    await vi.waitFor(() => expect(mocks.fetchMySubmission).toHaveBeenCalled())
    expect(empty.container).toBeEmptyDOMElement()
  })
})

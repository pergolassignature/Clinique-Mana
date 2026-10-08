import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { recordFixture } from '../../test/fixtures-domain'
import { IDS } from '../../test/fixtures'
import { setupQueryClient } from '../../test/query-client'
import { AvailabilityCard } from './AvailabilityCard'

const mocks = vi.hoisted(() => ({ api: { updateMatchingProfile: vi.fn() }, toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../api/record', () => mocks.api)
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))

afterEach(() => vi.clearAllMocks())

const A = 'modules.professionals.record.matching.availability'
const period = (p: 'am' | 'pm' | 'evening' | 'weekend') => screen.getByRole('checkbox', { name: t(`modules.professionals.periods.${p}`) })

function renderCard(readOnly = false) {
  const { wrapper: Wrapper } = setupQueryClient()
  render(
    <Wrapper>
      <AvailabilityCard record={recordFixture()} readOnly={readOnly} />
    </Wrapper>,
  )
}

describe('AvailabilityCard', () => {
  it('shows the stored periods, then saves periods, new clients and note together on « Enregistrer » only', async () => {
    mocks.api.updateMatchingProfile.mockResolvedValue(undefined)
    renderCard()
    expect(period('am')).toBeChecked()
    expect(period('pm')).not.toBeChecked()
    expect(period('evening')).toBeChecked()
    const accepting = screen.getByRole('switch', { name: t(`${A}.accepting`) })
    expect(accepting).toBeChecked()
    await userEvent.click(period('pm'))
    await userEvent.click(accepting)
    await userEvent.type(screen.getByRole('textbox', { name: t(`${A}.note`) }), '  Pas le vendredi. ')
    expect(mocks.api.updateMatchingProfile).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.api.updateMatchingProfile).toHaveBeenCalledTimes(1))
    expect(mocks.api.updateMatchingProfile).toHaveBeenCalledWith(IDS.professional, {
      availabilityPeriods: ['am', 'pm', 'evening'],
      acceptingNewClients: false,
      availabilityNote: 'Pas le vendredi.',
    })
    // Saved: the form is clean again.
    await waitFor(() => expect(screen.getByRole('button', { name: t('common.save') })).toHaveAttribute('aria-disabled', 'true'))
  })

  it('« Annuler » puts the stored values back', async () => {
    renderCard()
    await userEvent.click(period('weekend'))
    await userEvent.click(screen.getByRole('button', { name: t('common.cancel') }))
    expect(period('weekend')).not.toBeChecked()
  })

  it('is read-only: the values show, nothing changes, no footer', async () => {
    renderCard(true)
    await userEvent.click(period('pm'))
    expect(period('pm')).not.toBeChecked()
    expect(screen.queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument()
  })
})

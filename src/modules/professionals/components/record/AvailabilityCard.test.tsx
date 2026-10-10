import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { ProfessionalRecord } from '../../api/parse'
import type { MatchingProfilePatch } from '../../api/record'
import { professionalKeys } from '../../hooks/keys'
import { recordFixture } from '../../test/fixtures-domain'
import { IDS } from '../../test/fixtures'
import { LEAVE_LINK, renderRecordTab } from '../../test/record-tab'
import { AvailabilityCard } from './AvailabilityCard'

const mocks = vi.hoisted(() => ({
  record: { fetchProfessionalRecord: vi.fn(), updateMatchingProfile: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../api/record', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/record')>()), ...mocks.record }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

/** What the database holds; the update mock writes into it and the refetch reads it. */
let stored: ProfessionalRecord

beforeEach(() => {
  stored = recordFixture()
  mocks.record.fetchProfessionalRecord.mockImplementation(async () => stored)
  mocks.record.updateMatchingProfile.mockImplementation(async (_id: string, patch: MatchingProfilePatch) => {
    stored = { ...stored, matchingProfile: { ...stored.matchingProfile, ...patch } }
  })
})
afterEach(() => vi.clearAllMocks())

const A = 'modules.professionals.record.matching.availability'
const period = (p: 'am' | 'pm' | 'end_of_day' | 'evening' | 'weekend') => screen.getByRole('checkbox', { name: t(`modules.professionals.periods.${p}`) })
const saveButton = () => screen.getByRole('button', { name: t('common.save') })

describe('AvailabilityCard', () => {
  it('shows the stored periods, then saves periods, new clients and note together on « Enregistrer » only', async () => {
    const { invalidated } = renderRecordTab(<AvailabilityCard readOnly={false} />, { record: stored })
    expect(period('am')).toBeChecked()
    expect(period('pm')).not.toBeChecked()
    expect(period('evening')).toBeChecked()
    const accepting = screen.getByRole('switch', { name: t(`${A}.accepting`) })
    expect(accepting).toBeChecked()
    await userEvent.click(period('pm'))
    await userEvent.click(accepting)
    await userEvent.type(screen.getByRole('textbox', { name: t(`${A}.note`) }), '  Pas le vendredi. ')
    expect(mocks.record.updateMatchingProfile).not.toHaveBeenCalled()
    await userEvent.click(saveButton())
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.professionals.toasts.saved')))
    expect(mocks.record.updateMatchingProfile).toHaveBeenCalledExactlyOnceWith(IDS.professional, {
      availabilityPeriods: ['am', 'pm', 'evening'],
      acceptingNewClients: false,
      availabilityNote: 'Pas le vendredi.',
    })
    // « Accepte de nouveaux clients » shows in the list: the lists are refetched.
    expect(invalidated()).toContainEqual(professionalKeys.lists())
    // Saved: the form is clean again, on the stored values (no buttons while clean, decision UI-2).
    await waitFor(() => expect(screen.queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument())
    expect(period('pm')).toBeChecked()
    expect(screen.getByRole('switch', { name: t(`${A}.accepting`) })).not.toBeChecked()
  })

  it('leaves new clients out of a save that did not change it, and the lists alone', async () => {
    const { invalidated } = renderRecordTab(<AvailabilityCard readOnly={false} />, { record: stored })
    await userEvent.click(period('weekend'))
    await userEvent.click(period('end_of_day'))
    await userEvent.click(saveButton())
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled())
    expect(mocks.record.updateMatchingProfile).toHaveBeenCalledExactlyOnceWith(IDS.professional, {
      availabilityPeriods: ['am', 'end_of_day', 'evening', 'weekend'],
      availabilityNote: null,
    })
    expect(invalidated()).toEqual([professionalKeys.record(IDS.professional), professionalKeys.history(IDS.professional)])
  })

  it('« Annuler » puts the stored values back and returns focus to the first moment', async () => {
    renderRecordTab(<AvailabilityCard readOnly={false} />, { record: stored })
    await userEvent.click(period('weekend'))
    await userEvent.click(screen.getByRole('button', { name: t('common.cancel') }))
    expect(period('weekend')).not.toBeChecked()
    expect(period('am')).toHaveFocus()
  })

  it('asks before leaving with an unsaved edit', async () => {
    renderRecordTab(<AvailabilityCard readOnly={false} />, { record: stored })
    await userEvent.click(period('weekend'))
    await userEvent.click(screen.getByRole('link', { name: LEAVE_LINK }))
    expect(await screen.findByRole('alertdialog', { name: t('common.unsaved.title') })).toBeInTheDocument()
  })

  it('is read-only: the values show, nothing changes, no footer', async () => {
    renderRecordTab(<AvailabilityCard readOnly />, { record: stored, permissions: ['professionals.view'] })
    await userEvent.click(period('pm'))
    expect(period('pm')).not.toBeChecked()
    expect(screen.queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { ProfessionalRecord } from '../../../api/parse'
import type { PublicProfilePatch } from '../../../api/record'
import { recordFixture } from '../../../test/fixtures-domain'
import { LEAVE_LINK, renderRecordTab } from '../../../test/record-tab'
import { PublicProfileTab } from './PublicProfileTab'

const mocks = vi.hoisted(() => ({
  record: { fetchProfessionalRecord: vi.fn(), updatePublicProfile: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../../api/record', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../api/record')>()), ...mocks.record }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const P = 'modules.professionals.record.publicProfile'
/** What the database holds; the update mock writes into it and the refetch reads it. */
let stored: ProfessionalRecord

beforeEach(() => {
  stored = recordFixture()
  mocks.record.fetchProfessionalRecord.mockImplementation(async () => stored)
  mocks.record.updatePublicProfile.mockImplementation(async (_id: string, patch: PublicProfilePatch) => {
    stored = { ...stored, publicProfile: { ...stored.publicProfile, ...patch } }
  })
})
afterEach(() => vi.clearAllMocks())

const card = (title: string) => screen.getByRole('form', { name: title })
const bio = () => screen.getByRole('textbox', { name: t(`${P}.portrait.bio`) })

describe('PublicProfileTab', () => {
  it('edits an empty profile and saves only the portrait (A2.11)', async () => {
    renderRecordTab(<PublicProfileTab />, { record: stored })
    const portrait = card(t(`${P}.portrait.title`))
    expect(bio()).toHaveValue('')
    expect(within(portrait).getByText(t(`${P}.portrait.description`))).toBeInTheDocument()
    await userEvent.type(bio(), '  Vingt ans en pratique.  ')
    // Counted as stored: the spaces at either end are trimmed.
    expect(bio()).toHaveAccessibleDescription(t(`${P}.portrait.counter`, { count: '22', max: '4000' }))
    await userEvent.click(within(portrait).getByRole('button', { name: t('common.save') }))

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.professionals.toasts.saved')))
    expect(mocks.record.updatePublicProfile).toHaveBeenCalledExactlyOnceWith(stored.professional.id, { bio: 'Vingt ans en pratique.', approach: null })
    await waitFor(() => expect(bio()).toHaveValue('Vingt ans en pratique.'))
    expect(within(portrait).queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument()
  })

  it('saves the public contact normalised, and shows a stored phone in the Québec format', async () => {
    stored = { ...stored, publicProfile: { ...stored.publicProfile, bio: 'Bio', publicPhone: '+15145550000' } }
    renderRecordTab(<PublicProfileTab />, { record: stored })
    const contact = card(t(`${P}.contact.title`))
    const phone = within(contact).getByRole('textbox', { name: t(`${P}.contact.phone`) })
    expect(phone).toHaveValue('514 555-0000')
    await userEvent.type(within(contact).getByRole('textbox', { name: t(`${P}.contact.email`) }), ' Marie@Exemple.CA ')
    await userEvent.click(within(contact).getByRole('button', { name: t('common.save') }))

    await waitFor(() =>
      expect(mocks.record.updatePublicProfile).toHaveBeenCalledExactlyOnceWith(stored.professional.id, {
        publicEmail: 'marie@exemple.ca',
        publicPhone: '+15145550000',
      }),
    )
  })

  it('refuses a text over 4000 characters without saving', async () => {
    renderRecordTab(<PublicProfileTab />, { record: stored })
    await userEvent.click(bio())
    await userEvent.paste('a'.repeat(4001))
    await userEvent.click(within(card(t(`${P}.portrait.title`))).getByRole('button', { name: t('common.save') }))
    expect(await screen.findByText(t('modules.professionals.validation.maxChars', { max: '4000' }))).toBeInTheDocument()
    expect(mocks.record.updatePublicProfile).not.toHaveBeenCalled()
  })

  it('asks before leaving with an unsaved edit', async () => {
    renderRecordTab(<PublicProfileTab />, { record: stored })
    await userEvent.type(bio(), 'Brouillon')
    await userEvent.click(screen.getByRole('link', { name: LEAVE_LINK }))
    expect(await screen.findByRole('alertdialog', { name: t('common.unsaved.title') })).toBeInTheDocument()
  })

  it('is read-only for the conseillère: one notice, focusable values, no buttons, no counter', async () => {
    stored = { ...stored, publicProfile: { ...stored.publicProfile, bio: 'Vingt ans en pratique.' } }
    renderRecordTab(<PublicProfileTab />, { record: stored, role: 'counselor' })
    expect(screen.getAllByText(t('common.readOnlyNotice.title'))).toHaveLength(1)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(bio()).toHaveAttribute('readonly')
    expect(bio()).toHaveValue('Vingt ans en pratique.')
    expect(bio()).not.toHaveAccessibleDescription()
    bio().focus()
    expect(bio()).toHaveFocus()
  })
})

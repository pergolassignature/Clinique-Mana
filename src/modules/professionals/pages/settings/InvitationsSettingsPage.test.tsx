import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { ScheduledJob } from '@/core/jobs/api'
import { ROLE_PERMISSIONS } from '@/test/role-fixtures'
import { renderProfessionalsSettingsPage } from '../../test/settings-page'
import { INVITATION_REMINDERS_JOB, InvitationsSettingsPage } from './InvitationsSettingsPage'

const mocks = vi.hoisted(() => ({
  settings: { fetchProfessionalsSettings: vi.fn(), saveProfessionalsSettings: vi.fn() },
  jobs: { listScheduledJobs: vi.fn(), setScheduledJobEnabled: vi.fn(), listScheduledJobRuns: vi.fn(), runScheduledJobNow: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../api/settings', () => mocks.settings)
vi.mock('@/core/jobs/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/core/jobs/api')>()), ...mocks.jobs }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const S = 'modules.professionals.settings.invitations'
const SAVED = { collectSin: false, invitationExpiryDays: 7, invitationReminderAfterDays: 3 }

const job = (enabled: boolean): ScheduledJob => ({
  key: INVITATION_REMINDERS_JOB,
  label: "Rappels d'invitation",
  description: '',
  kind: 'function',
  is_maintenance: false,
  local_hour: 8,
  schedule: '5 * * * *',
  enabled,
  last_started_at: null,
  last_status: null,
  last_detail: null,
})

beforeEach(() => {
  mocks.settings.fetchProfessionalsSettings.mockResolvedValue(SAVED)
  mocks.settings.saveProfessionalsSettings.mockImplementation(async (patch: object) => ({ ...SAVED, ...patch }))
  mocks.jobs.listScheduledJobs.mockResolvedValue([job(false)])
  mocks.jobs.setScheduledJobEnabled.mockResolvedValue(undefined)
})
afterEach(() => vi.clearAllMocks())

const render = (options: { readOnly?: boolean; permissions?: string[] } = {}) =>
  renderProfessionalsSettingsPage(<InvitationsSettingsPage />, { sectionId: 'invitations', ...options })

const expiry = () => screen.getByRole('textbox', { name: new RegExp(`^${t(`${S}.link.expiryDays`)}`) })
const reminderDays = () => screen.queryByRole('textbox', { name: new RegExp(`^${t(`${S}.reminder.afterDays`)}`) })
const reminderSwitch = () => screen.getByRole('switch', { name: t(`${S}.reminder.enabled`) })
const save = () => screen.getByRole('button', { name: t('common.save') })

describe('InvitationsSettingsPage', () => {
  it('shows the lifetime and the reminder as saved', async () => {
    render()
    await waitFor(() => expect(expiry()).toHaveValue('7'))
    expect(reminderSwitch()).toBeChecked()
    expect(reminderDays()).toHaveValue('3')
  })

  it('saves a new lifetime and reminder delay', async () => {
    render()
    await waitFor(() => expect(expiry()).toHaveValue('7'))
    await userEvent.clear(expiry())
    await userEvent.type(expiry(), '14')
    await userEvent.clear(reminderDays() as HTMLElement)
    await userEvent.type(reminderDays() as HTMLElement, '5')
    await userEvent.click(save())
    await waitFor(() => expect(mocks.settings.saveProfessionalsSettings).toHaveBeenCalledExactlyOnceWith({ invitationExpiryDays: 14, invitationReminderAfterDays: 5 }))
    expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.professionals.toasts.saved'))
  })

  it('switching the reminder off saves null and hides its delay', async () => {
    render()
    await waitFor(() => expect(reminderSwitch()).toBeChecked())
    await userEvent.click(reminderSwitch())
    expect(reminderDays()).not.toBeInTheDocument()
    await userEvent.click(save())
    await waitFor(() => expect(mocks.settings.saveProfessionalsSettings).toHaveBeenCalledExactlyOnceWith({ invitationExpiryDays: 7, invitationReminderAfterDays: null }))
  })

  it('refuses a reminder that would leave after the link expired (P4-308), before any call', async () => {
    render()
    await waitFor(() => expect(expiry()).toHaveValue('7'))
    await userEvent.clear(reminderDays() as HTMLElement)
    await userEvent.type(reminderDays() as HTMLElement, '7')
    await userEvent.click(save())
    expect(await screen.findByText(t(`${S}.validation.reminderBeforeExpiry`, { max: '7' }))).toBeInTheDocument()
    expect(mocks.settings.saveProfessionalsSettings).not.toHaveBeenCalled()
  })

  it('puts the database’s same refusal under the delay (another tab shortened the lifetime)', async () => {
    mocks.settings.saveProfessionalsSettings.mockRejectedValue({
      code: 'P0001',
      message: 'Le rappel doit partir avant la fin de validité du lien : choisissez un délai plus court que sa durée de validité.',
      hint: 'invitation_reminder_after_days',
    })
    render()
    await waitFor(() => expect(expiry()).toHaveValue('7'))
    await userEvent.clear(reminderDays() as HTMLElement)
    await userEvent.type(reminderDays() as HTMLElement, '5')
    await userEvent.click(save())
    expect(await screen.findByText(/choisissez un délai plus court/)).toBeInTheDocument()
    expect(reminderDays()).toHaveFocus()
  })

  it('says the reminders do not leave while the scheduled job is off, and lets an admin turn it on', async () => {
    render()
    const card = await screen.findByRole('region', { name: t(`${S}.job.title`) })
    expect(await within(card).findByText(t(`${S}.job.off`))).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: t(`${S}.job.enable`) }))
    await waitFor(() => expect(mocks.jobs.setScheduledJobEnabled).toHaveBeenCalledExactlyOnceWith(INVITATION_REMINDERS_JOB, true))
  })

  it('says when they leave once the job is on', async () => {
    mocks.jobs.listScheduledJobs.mockResolvedValue([job(true)])
    render()
    const card = await screen.findByRole('region', { name: t(`${S}.job.title`) })
    expect(await within(card).findByText(t(`${S}.job.on`, { hour: '8' }))).toBeInTheDocument()
  })

  it('the adjointe reads it all: no save, no switch for the job, where it is done instead', async () => {
    render({ readOnly: true, permissions: [...ROLE_PERMISSIONS.admin_assistant] })
    await waitFor(() => expect(expiry()).toHaveValue('7'))
    expect(screen.getAllByText(t('common.readOnlyNotice.title'))).toHaveLength(1)
    expect(screen.queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument()
    const card = await screen.findByRole('region', { name: t(`${S}.job.title`) })
    expect(await within(card).findByText(t(`${S}.job.askAdmin`))).toBeInTheDocument()
    expect(within(card).queryByRole('button')).not.toBeInTheDocument()
    expect(within(card).getByRole('link', { name: t(`${S}.job.openJobs`) })).toHaveAttribute('href', '/parametres/taches-planifiees')
  })

  it('without settings.view: says what the reminders need, without reading the job', async () => {
    render({ readOnly: true, permissions: ['professionals.view', 'professionals.invite'] })
    const card = await screen.findByRole('region', { name: t(`${S}.job.title`) })
    expect(within(card).getByText(t(`${S}.job.unknown`))).toBeInTheDocument()
    expect(mocks.jobs.listScheduledJobs).not.toHaveBeenCalled()
  })

  it('a reminder switched off: no job to talk about', async () => {
    mocks.settings.fetchProfessionalsSettings.mockResolvedValue({ ...SAVED, invitationReminderAfterDays: null })
    render()
    const card = await screen.findByRole('region', { name: t(`${S}.job.title`) })
    expect(within(card).getByText(t(`${S}.job.disabledReminder`))).toBeInTheDocument()
    expect(mocks.jobs.listScheduledJobs).not.toHaveBeenCalled()
  })
})

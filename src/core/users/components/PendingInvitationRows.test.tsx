import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { t } from '@/i18n'
import { Table, TableBody } from '@/shared/ui/table'
import type { StaffInvitation } from '../api'
import { PendingInvitationRows } from './PendingInvitationRows'

vi.mock('../hooks', () => ({
  useResendInvitation: () => ({ isPending: false, mutate: vi.fn() }),
  useRevokeInvitation: () => ({ isPending: false, mutate: vi.fn() }),
}))

/** An invitation whose last email failed with an unknown outcome (`listStaffInvitations` maps the column; api.test). */
const INVITATION: StaffInvitation = {
  id: 'i1',
  email: 'nouvelle@mana.test',
  display_name: 'Nouvelle Personne',
  role: 'counselor',
  role_name: 'Conseillère',
  expires_at: '2026-10-15T16:00:00+00:00',
  is_expired: false,
  invited_by_name: 'Admin Local',
  last_email_status: 'failed',
  last_email_error_code: 'provider_unavailable',
}

function renderRow(invitation: Partial<StaffInvitation>) {
  render(
    <Table>
      <TableBody>
        <PendingInvitationRows invitations={[{ ...INVITATION, ...invitation }]} canManage={false} />
      </TableBody>
    </Table>,
  )
  return screen.getByRole('row')
}

describe("PendingInvitationRows: the last email's error code", () => {
  it('an email the provider may have taken (provider_unavailable) reads « Résultat inconnu », not « Courriel non remis »', () => {
    const row = renderRow({})
    expect(within(row).getAllByText(t('email.failure.unknownOutcome'), { exact: false }).length).toBeGreaterThan(0)
    expect(row).not.toHaveTextContent(t('settings.users.invitations.status.notDelivered'))
  })

  it('any other failure reads « Courriel non remis »', () => {
    const row = renderRow({ last_email_error_code: 'provider_rejected' })
    expect(row).toHaveTextContent(t('settings.users.invitations.status.notDelivered'))
    expect(row).not.toHaveTextContent(t('email.failure.unknownOutcome'))
  })
})

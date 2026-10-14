import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { DemandeSourceCard, type DemandeSource } from './DemandeSourceCard'

const S = 'modules.demandes.sources'
const SOURCES = [
  { id: 'r1', name: 'Instagram' },
  { id: 'r2', name: 'Un ami' },
]

const booked: DemandeSource = {
  channel: 'booking_page',
  referral_source_id: 'r1',
  source_campaign: 'automne',
  source_utm: { utm_source: 'instagram', utm_medium: 'social' },
  source_referrer: 'https://site.test/services',
  source_landing_page: 'https://app.test/appel-decouverte?utm_source=instagram',
}
const typed: DemandeSource = { channel: 'phone', referral_source_id: null, source_campaign: null, source_utm: {}, source_referrer: null, source_landing_page: null }

describe('DemandeSourceCard', () => {
  it('shows where the request came from, in words, the full question kept for the short label', () => {
    render(renderWithContexts(<DemandeSourceCard demande={booked} referralSources={SOURCES} />))
    expect(screen.getByRole('heading', { name: t(`${S}.title`) })).toBeInTheDocument()
    expect(screen.getByText('Page de réservation')).toBeInTheDocument()
    expect(screen.getByText('Instagram')).toBeInTheDocument()
    expect(screen.getByText(t(`${S}.heard`))).toHaveAttribute('title', t(`${S}.heardQuestion`))
    expect(screen.getByText('Source : instagram · Support : social')).toBeInTheDocument()
    expect(screen.getByText('https://site.test/services')).toBeInTheDocument()
    expect(screen.queryByText(t(`${S}.noCampaign`))).not.toBeInTheDocument()
  })

  it('no empty capture lines: « Aucune donnée de campagne » once for a request typed by a counselor', () => {
    render(renderWithContexts(<DemandeSourceCard demande={typed} referralSources={SOURCES} />))
    expect(screen.getByText(t(`${S}.notSaid`))).toBeInTheDocument()
    expect(screen.queryByText(t(`${S}.campaign`))).not.toBeInTheDocument()
    expect(screen.queryByText(t(`${S}.referrer`))).not.toBeInTheDocument()
    expect(screen.getAllByText(t(`${S}.noCampaign`))).toHaveLength(1)
  })

  it('read only without demandes.manage', () => {
    render(renderWithContexts(<DemandeSourceCard demande={typed} referralSources={SOURCES} />))
    expect(screen.queryByRole('button', { name: t(`${S}.edit`) })).not.toBeInTheDocument()
  })

  it('« Modifier »: the channel and the declared source only; « Enregistrer » once changed', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(renderWithContexts(<DemandeSourceCard demande={booked} referralSources={SOURCES} onSave={onSave} />))
    await user.click(screen.getByRole('button', { name: t(`${S}.edit`) }))
    // The booking page's capture is not a field.
    expect(screen.queryByLabelText(t(`${S}.campaign`))).not.toBeInTheDocument()
    expect(screen.getByText(t(`${S}.capturedReadOnly`))).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText(t(`${S}.channel`)), 'phone')
    await user.selectOptions(screen.getByLabelText(new RegExp(t(`${S}.heard`))), '')
    await user.click(screen.getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ channel: 'phone', referralSourceId: null }))
    // Back to the card, the focus on « Modifier ».
    expect(await screen.findByRole('button', { name: t(`${S}.edit`) })).toHaveFocus()
  })

  it('a refusal stays in the form, in French', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValue(new Error('Choisissez une provenance de la liste de la clinique.'))
    render(renderWithContexts(<DemandeSourceCard demande={typed} referralSources={SOURCES} onSave={onSave} />))
    await user.click(screen.getByRole('button', { name: t(`${S}.edit`) }))
    await user.selectOptions(screen.getByLabelText(new RegExp(t(`${S}.heard`))), 'r2')
    await user.click(screen.getByRole('button', { name: t('common.save') }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choisissez une provenance de la liste de la clinique.')
  })
})

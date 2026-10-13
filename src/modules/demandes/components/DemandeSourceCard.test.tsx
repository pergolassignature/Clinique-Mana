import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { t } from '@/i18n'
import { DemandeSourceCard } from './DemandeSourceCard'

const S = 'modules.demandes.sources'

describe('DemandeSourceCard', () => {
  it('shows where the request came from, in words', () => {
    render(
      <DemandeSourceCard
        demande={{
          channel: 'booking_page',
          referral_source_id: 'r1',
          source_campaign: 'automne',
          source_utm: { utm_source: 'instagram', utm_medium: 'social' },
          source_referrer: 'https://site.test/services',
          source_landing_page: 'https://app.test/appel-decouverte?utm_source=instagram',
        }}
        referralSourceName="Instagram"
      />,
    )
    expect(screen.getByRole('heading', { name: t(`${S}.title`) })).toBeInTheDocument()
    expect(screen.getByText('Page de réservation')).toBeInTheDocument()
    expect(screen.getByText('Instagram')).toBeInTheDocument()
    expect(screen.getByText('source : instagram · medium : social')).toBeInTheDocument()
    expect(screen.getByText('https://site.test/services')).toBeInTheDocument()
  })

  it('« Non indiquée » for what is not known', () => {
    render(
      <DemandeSourceCard
        demande={{ channel: 'phone', referral_source_id: null, source_campaign: null, source_utm: {}, source_referrer: null, source_landing_page: null }}
      />,
    )
    expect(screen.getAllByText(t(`${S}.none`))).toHaveLength(5)
  })
})

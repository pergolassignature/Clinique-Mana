import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { t } from '@/i18n'
import { StatusIndicator } from './StatusIndicator'

describe('StatusIndicator', () => {
  it.each([
    ['complete', 'common.status.complete'],
    ['pending', 'common.status.pending'],
    ['warning', 'common.status.warning'],
  ] as const)('%s: says the status in words; the icon is hidden', (status, key) => {
    const { container } = render(<StatusIndicator label="Contrat signé" status={status} />)
    expect(screen.getByText('Contrat signé')).toHaveTextContent(`Contrat signé ${t(key)}`)
    expect(screen.getByText(t(key))).toHaveClass('sr-only')
    const icon = container.querySelector('svg')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('defaults to pending and shows the description', () => {
    render(<StatusIndicator label="Contrat à signer" description="Envoyé le 3 oct." />)
    expect(screen.getByText(t('common.status.pending'))).toBeInTheDocument()
    expect(screen.getByText('Envoyé le 3 oct.')).toBeVisible()
  })
})

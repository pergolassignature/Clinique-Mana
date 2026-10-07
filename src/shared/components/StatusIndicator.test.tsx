import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { t } from '@/i18n'
import { StatusIndicator } from './StatusIndicator'

describe('StatusIndicator', () => {
  it.each([
    ['complete', 'common.status.complete', 'text-success'],
    ['pending', 'common.status.pending', 'text-warning'],
    ['warning', 'common.status.warning', 'text-destructive'],
  ] as const)('%s: says the status in words and colours only the hidden icon', (status, key, tone) => {
    const { container } = render(<StatusIndicator label="Contrat signé" status={status} />)
    expect(screen.getByText('Contrat signé')).toHaveTextContent(`Contrat signé ${t(key)}`)
    expect(screen.getByText(t(key))).toHaveClass('sr-only')
    const icon = container.querySelector('svg')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(icon).toHaveClass(tone)
  })

  it('defaults to pending and shows the description', () => {
    render(<StatusIndicator label="Contrat à signer" description="Envoyé le 3 oct." />)
    expect(screen.getByText(t('common.status.pending'))).toBeInTheDocument()
    expect(screen.getByText('Envoyé le 3 oct.')).toHaveClass('text-xs', 'text-muted-foreground')
  })
})

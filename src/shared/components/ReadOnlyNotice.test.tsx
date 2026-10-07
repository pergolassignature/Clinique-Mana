import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { t } from '@/i18n'
import { ReadOnlyNotice } from './ReadOnlyNotice'

describe('ReadOnlyNotice', () => {
  it('says the page is read-only and who can change it, with a decorative icon', () => {
    const { container } = render(<ReadOnlyNotice />)
    expect(screen.getByText(t('common.readOnlyNotice.title'))).toBeInTheDocument()
    expect(screen.getByText(t('common.readOnlyNotice.body'))).toBeInTheDocument()
    const icons = container.querySelectorAll('svg')
    expect(icons).toHaveLength(1)
    expect(icons[0]).toHaveAttribute('aria-hidden', 'true')
  })

  it('takes another explanation', () => {
    render(<ReadOnlyNotice body="Seule la direction peut modifier ces informations." />)
    expect(screen.getByText('Seule la direction peut modifier ces informations.')).toBeInTheDocument()
    expect(screen.queryByText(t('common.readOnlyNotice.body'))).not.toBeInTheDocument()
  })

  it('is static: not announced as an alert or a status, and not a heading', () => {
    render(<ReadOnlyNotice />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })
})

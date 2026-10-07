import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { t } from '@/i18n'
import { ReadOnlyNotice } from './ReadOnlyNotice'

describe('ReadOnlyNotice', () => {
  it('says the section is read-only and who can change it', () => {
    const { container } = render(<ReadOnlyNotice />)
    expect(screen.getByText(t('settings.readOnly.title'))).toBeInTheDocument()
    expect(screen.getByText(t('settings.readOnly.body'))).toBeInTheDocument()
    expect(container.querySelector('svg.lucide-lock')).toHaveAttribute('aria-hidden', 'true')
  })

  it('is static: not announced as an alert or a status, and not a heading', () => {
    render(<ReadOnlyNotice />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })
})

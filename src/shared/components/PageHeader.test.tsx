import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageHeader } from './PageHeader'

describe('PageHeader', () => {
  it('a page title (level 1): h1 at the H1 size, 20/28 with tight tracking', () => {
    render(<PageHeader level={1} title="Professionnels" />)
    const heading = screen.getByRole('heading', { level: 1, name: 'Professionnels' })
    expect(heading).toHaveClass('text-xl', 'tracking-tight', 'font-semibold')
  })

  it('a section under a layout title (default level 2): h2 at the H2 size, 16/24, smaller than the layout h1', () => {
    render(<PageHeader title="Identité légale" description="Ces renseignements figurent sur les contrats." />)
    const heading = screen.getByRole('heading', { level: 2, name: 'Identité légale' })
    expect(heading).toHaveClass('text-lg', 'font-semibold')
    expect(heading).not.toHaveClass('text-xl')
    expect(heading).not.toHaveClass('tracking-tight')
  })
})

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

  it('centres the actions on the title line: top-aligned row, actions box the title line height (28 / 24)', () => {
    const { rerender } = render(<PageHeader level={1} title="Professionnels" description="Le répertoire." actions={<button type="button">Ajouter</button>} />)
    const actions = screen.getByRole('button', { name: 'Ajouter' }).parentElement!
    expect(actions).toHaveClass('h-7', 'items-center')
    expect(actions.parentElement).toHaveClass('items-start')
    expect(actions.parentElement).not.toHaveClass('items-end')
    rerender(<PageHeader title="Utilisateurs" actions={<button type="button">Inviter</button>} />)
    expect(screen.getByRole('button', { name: 'Inviter' }).parentElement).toHaveClass('h-6')
  })

  it('puts the count first on the subtitle line, tabular, then the description', () => {
    render(<PageHeader level={1} title="Professionnels" count="10 professionnels · 7 actifs" description="Le répertoire." />)
    const count = screen.getByText('10 professionnels · 7 actifs')
    expect(count).toHaveClass('tabular')
    expect(count.parentElement).toHaveTextContent('10 professionnels · 7 actifs · Le répertoire.')
  })

  it('a count alone, without a description', () => {
    render(<PageHeader level={1} title="Professionnels" count={10} />)
    expect(screen.getByText('10').parentElement).toHaveTextContent(/^10$/)
  })
})

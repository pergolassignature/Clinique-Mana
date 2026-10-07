import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '@/shared/ui/button'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('shows a title, a sentence and an action, and nothing else', () => {
    const { container } = render(
      <EmptyState
        title="Aucun professionnel ne correspond"
        body="Modifiez la recherche ou les filtres."
        action={<Button variant="outline">Réinitialiser</Button>}
      />,
    )
    expect(screen.getByText('Aucun professionnel ne correspond')).toBeInTheDocument()
    expect(screen.getByText('Modifiez la recherche ou les filtres.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Réinitialiser' })).toBeInTheDocument()
    // No icon (design system: two lines of text, no box, no icon).
    expect(container.querySelector('svg')).toBeNull()
  })

  it('renders the title alone', () => {
    const { container } = render(<EmptyState title="Aucune taxe" />)
    expect(container.textContent).toBe('Aucune taxe')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

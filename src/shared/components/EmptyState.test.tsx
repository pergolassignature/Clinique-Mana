import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog'
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

  it('can hide its title from screen readers when a live region already says it', () => {
    const { rerender } = render(<EmptyState title="Aucune entrée ne correspond" body="Modifiez les filtres." titleAriaHidden />)
    expect(screen.getByText('Aucune entrée ne correspond')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('Modifiez les filtres.')).not.toHaveAttribute('aria-hidden')
    rerender(<EmptyState title="Aucune entrée ne correspond" />)
    expect(screen.getByText('Aucune entrée ne correspond')).not.toHaveAttribute('aria-hidden')
  })

  it('pads 24 px above and below on a page, nothing inside a card (inCard), where the card spaces it', () => {
    const { container, rerender } = render(<EmptyState title="Aucun document" />)
    expect(container.firstElementChild).toHaveClass('py-6')
    rerender(<EmptyState title="Aucun document" inCard />)
    expect(container.firstElementChild).not.toHaveClass('py-6')
    expect(screen.getByText('Aucun document')).toBeInTheDocument()
  })

  it('inside a Card it is inCard by default; inCard={false} keeps the padding; a dialog opened from a card resets it', () => {
    const { rerender } = render(
      <Card>
        <EmptyState title="Aucun document" />
      </Card>,
    )
    expect(screen.getByText('Aucun document').parentElement).not.toHaveClass('py-6')
    rerender(
      <Card>
        <EmptyState title="Aucun document" inCard={false} />
      </Card>,
    )
    expect(screen.getByText('Aucun document').parentElement).toHaveClass('py-6')
    rerender(
      <Card>
        <Dialog open>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Choisir</DialogTitle>
            <EmptyState title="Aucun modèle" />
          </DialogContent>
        </Dialog>
      </Card>,
    )
    expect(screen.getByText('Aucun modèle').parentElement).toHaveClass('py-6')
  })
})

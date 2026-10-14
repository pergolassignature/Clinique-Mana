import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HomeQueueCard } from './HomeQueueCard'

describe('HomeQueueCard (Accueil, L29)', () => {
  it('names the card and shows only the figures that are not zero, each a link', () => {
    render(
      <MemoryRouter>
        <HomeQueueCard
          title="File"
          body="Une ligne."
          items={[
            { key: 'a', count: 2, label: 'en retard', to: '/x?a' },
            { key: 'b', count: 0, label: 'jamais', to: '/x?b' },
          ]}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('region', { name: 'File' })).toBeInTheDocument()
    expect(screen.getByText('Une ligne.')).toBeInTheDocument()
    expect(screen.getAllByRole('link').map((l) => [l.textContent, l.getAttribute('href')])).toEqual([['2en retard', '/x?a']])
  })

  it('renders nothing when every figure is zero', () => {
    const { container } = render(
      <MemoryRouter>
        <HomeQueueCard title="File" items={[{ key: 'a', count: 0, label: 'x', to: '/x' }]} />
      </MemoryRouter>,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

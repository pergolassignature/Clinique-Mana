import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Card, CardDescription, CardHeader, CardTitle } from './card'

describe('Card', () => {
  it('the title is the panel title: 16/24, 600, no tracking; the description 12 px secondary', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Dossier</CardTitle>
          <CardDescription>Ce qui manque.</CardDescription>
        </CardHeader>
      </Card>,
    )
    const title = screen.getByRole('heading', { level: 3, name: 'Dossier' })
    expect(title).toHaveClass('text-lg', 'font-semibold')
    expect(title).not.toHaveClass('text-base', 'tracking-tight')
    expect(screen.getByText('Ce qui manque.')).toHaveClass('text-xs', 'text-muted-foreground')
  })
})

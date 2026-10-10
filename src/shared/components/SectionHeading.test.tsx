import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SectionGroup, SectionHeading } from './SectionHeading'

describe('SectionHeading', () => {
  it('is the overline: an h2 by default, 11/16 caps, 500, secondary', () => {
    render(<SectionHeading>Documents requis</SectionHeading>)
    const heading = screen.getByRole('heading', { level: 2, name: 'Documents requis' })
    expect(heading).toHaveClass('text-2xs', 'font-medium', 'uppercase', 'tracking-wide', 'text-muted-foreground')
    expect(heading).not.toHaveClass('text-lg')
  })

  it('takes another level, a description and an action', () => {
    render(
      <SectionHeading as="h3" description="Trois documents." action={<button type="button">Téléverser</button>}>
        En bref
      </SectionHeading>,
    )
    expect(screen.getByRole('heading', { level: 3, name: 'En bref' })).toBeInTheDocument()
    expect(screen.getByText('Trois documents.')).toHaveClass('text-xs', 'text-muted-foreground')
    expect(screen.getByRole('button', { name: 'Téléverser' })).toBeInTheDocument()
  })
})

describe('SectionGroup', () => {
  it('is a section named by its heading, the heading 8 px above cards 20 px apart', () => {
    render(
      <SectionGroup title="Documents requis">
        <div>Photo</div>
        <div>Assurance</div>
      </SectionGroup>,
    )
    const section = screen.getByRole('region', { name: 'Documents requis' })
    expect(section.tagName).toBe('SECTION')
    expect(screen.getByRole('heading', { level: 2, name: 'Documents requis' }).parentElement?.parentElement).toHaveClass('mb-2')
    expect(screen.getByText('Photo').parentElement).toHaveClass('gap-5')
  })
})

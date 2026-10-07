import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge } from './badge'
import { StatusDot } from './status-dot'

describe('StatusDot', () => {
  it('is a 6px round dot hidden from screen readers', () => {
    const { container } = render(<StatusDot tone="success" />)
    const dot = container.firstElementChild
    expect(dot).toHaveAttribute('aria-hidden', 'true')
    expect(dot).toHaveClass('h-1.5', 'w-1.5', 'rounded-full', 'bg-success')
  })

  it.each([
    ['default', 'bg-muted-foreground'],
    ['neutral', 'bg-neutral'],
    ['warning', 'bg-warning'],
    ['error', 'bg-destructive'],
    ['info', 'bg-success'],
  ] as const)('%s tone → %s', (tone, bg) => {
    const { container } = render(<StatusDot tone={tone} />)
    expect(container.firstElementChild).toHaveClass(bg)
  })
})

describe('Badge', () => {
  it('is a dot + word: the word is the accessible text, the dot is decorative', () => {
    const { container } = render(<Badge variant="success">Actif</Badge>)
    const badge = container.firstElementChild as HTMLElement
    expect(badge).toHaveTextContent('Actif')
    expect(badge).toHaveClass('text-xs', 'font-medium', 'text-muted-foreground')
    expect(badge).not.toHaveClass('rounded-sm')
    expect(badge.querySelector('[aria-hidden="true"]')).toHaveClass('bg-success')
  })

  it('maps the variants to dot tones', () => {
    render(
      <>
        <Badge variant="secondary">Invité</Badge>
        <Badge variant="outline">En attente</Badge>
        <Badge variant="error">Inactif</Badge>
      </>,
    )
    expect(screen.getByText('Invité').parentElement?.querySelector('[data-tone]')).toHaveAttribute('data-tone', 'neutral')
    expect(screen.getByText('En attente').parentElement?.querySelector('[data-tone]')).toHaveAttribute('data-tone', 'neutral')
    expect(screen.getByText('Inactif').parentElement?.querySelector('[data-tone]')).toHaveAttribute('data-tone', 'error')
  })

  it('drops the dot on request', () => {
    const { container } = render(<Badge dot={false}>Psychologue</Badge>)
    expect(container.querySelector('[data-tone]')).toBeNull()
  })

  it('filled (« Urgent »): red with white 11px text and no dot', () => {
    const { container } = render(
      <Badge variant="error" filled>
        Urgent
      </Badge>,
    )
    const badge = container.firstElementChild
    expect(badge).toHaveClass('bg-destructive', 'text-white', 'text-2xs', 'font-semibold', 'rounded-sm')
    expect(badge).not.toHaveClass('text-xs', 'text-muted-foreground')
    expect(container.querySelector('[data-tone]')).toBeNull()
  })

  it('filled without error is ink', () => {
    const { container } = render(<Badge filled>Nouveau</Badge>)
    expect(container.firstElementChild).toHaveClass('bg-ink')
  })
})

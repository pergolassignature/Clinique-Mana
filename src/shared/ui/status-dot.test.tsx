import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge } from './badge'
import { StatusDot, type StatusTone } from './status-dot'

describe('StatusDot', () => {
  it.each<StatusTone>(['default', 'neutral', 'success', 'warning', 'error', 'info'])(
    '%s: decorative, hidden from screen readers, exposes its tone',
    (tone) => {
      const { container } = render(<StatusDot tone={tone} />)
      const dot = container.firstElementChild
      expect(dot).toHaveAttribute('aria-hidden', 'true')
      expect(dot).toHaveAttribute('data-tone', tone)
      expect(dot).toBeEmptyDOMElement()
    },
  )
})

describe('Badge', () => {
  const dotOf = (word: string) => screen.getByText(word).parentElement?.querySelector('[data-tone]')

  it('is a dot + word: the word is the text, the dot is hidden', () => {
    const { container } = render(<Badge variant="success">Actif</Badge>)
    expect(container).toHaveTextContent('Actif')
    expect(dotOf('Actif')).toHaveAttribute('aria-hidden', 'true')
    expect(dotOf('Actif')).toHaveAttribute('data-tone', 'success')
  })

  it.each([
    ['default', 'default'],
    ['secondary', 'neutral'],
    ['outline', 'neutral'],
    ['warning', 'warning'],
    ['error', 'error'],
    ['info', 'info'],
  ] as const)('variant %s → %s dot', (variant, tone) => {
    render(<Badge variant={variant}>Statut</Badge>)
    expect(dotOf('Statut')).toHaveAttribute('data-tone', tone)
  })

  it('drops the dot on request', () => {
    render(<Badge dot={false}>Psychologue</Badge>)
    expect(dotOf('Psychologue')).toBeNull()
  })

  it('filled (« Urgent »): the word alone, no dot', () => {
    const { container } = render(
      <Badge variant="error" filled>
        Urgent
      </Badge>,
    )
    expect(container).toHaveTextContent('Urgent')
    expect(container.querySelector('[data-tone]')).toBeNull()
  })
})

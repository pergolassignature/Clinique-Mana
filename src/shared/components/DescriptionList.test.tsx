import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { DescriptionList } from './DescriptionList'

const items = [
  { label: 'Prénom', value: 'Geneviève' },
  { label: 'Téléphone personnel', value: null },
  { label: 'Langues', value: [] },
  { label: 'Places offertes', value: '', empty: 'Non suivies' },
]

describe('DescriptionList', () => {
  it('pairs each label (secondary) with its value (foreground) in a dl', () => {
    const { container } = render(<DescriptionList items={items} />)
    expect(container.querySelector('dl')).toBeInTheDocument()
    const label = screen.getByText('Prénom')
    expect(label.tagName).toBe('DT')
    expect(label).toHaveClass('text-sm', 'text-muted-foreground')
    expect(label).not.toHaveClass('font-medium')
    const value = screen.getByText('Geneviève')
    expect(value.tagName).toBe('DD')
    expect(value).toHaveClass('text-sm', 'text-foreground')
  })

  it('writes « Non indiqué » (muted) for an empty value, never a blank; `empty` overrides the text', () => {
    render(<DescriptionList items={items} />)
    const empties = screen.getAllByText(t('common.notProvided'))
    expect(empties).toHaveLength(2)
    for (const empty of empties) expect(empty).toHaveClass('text-subtle')
    expect(screen.getByText('Non suivies')).toHaveClass('text-subtle')
  })

  it('a hairline between rows, a 180 px label column by default, 132 px with labelWidth="sm"', () => {
    const { rerender } = render(<DescriptionList items={items} />)
    const row = screen.getByText('Prénom').parentElement!
    expect(row).toHaveClass('border-t', 'border-border-light', 'first:border-t-0', 'sm:grid-cols-[180px_minmax(0,1fr)]')
    rerender(<DescriptionList items={items} labelWidth="sm" />)
    expect(screen.getByText('Prénom').parentElement).toHaveClass('sm:grid-cols-[132px_minmax(0,1fr)]')
  })

  it('columns={2}: two columns of pairs from xl', () => {
    const { container } = render(<DescriptionList items={items} columns={2} />)
    expect(container.querySelector('dl')).toHaveClass('xl:grid-cols-2')
    expect(screen.getByText('Prénom').parentElement).toHaveClass('xl:[&:nth-child(2)]:border-t-0')
  })

  it('one column by default', () => {
    const { container } = render(<DescriptionList items={items} />)
    expect(container.querySelector('dl')).not.toHaveClass('xl:grid-cols-2')
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Table, TableBody, TableCell, TableRow } from './table'

const table = (label?: string, scrollFocus?: 'always' | 'overflow') => (
  <Table scrollLabel={label} scrollFocus={scrollFocus}>
    <TableBody>
      <TableRow>
        <TableCell>9,975 %</TableCell>
      </TableRow>
    </TableBody>
  </Table>
)

describe('Table', () => {
  it('without a label, the scroll wrapper stays out of the tab order', () => {
    render(table())
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(screen.getByRole('table').parentElement).not.toHaveAttribute('tabindex')
  })

  it('with a label, the scroll wrapper is a named region keyboard users can focus and scroll', async () => {
    render(table('Taux de TVQ'))
    const region = screen.getByRole('region', { name: 'Taux de TVQ' })
    expect(region).toContainElement(screen.getByRole('table'))
    await userEvent.tab()
    expect(region).toHaveFocus()
  })

  describe('scrollFocus="overflow"', () => {
    afterEach(() => vi.restoreAllMocks())
    const widths = (scroll: number, client: number) => {
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(scroll)
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(client)
    }

    it('adds no tab stop while the table fits', () => {
      widths(300, 300)
      render(table('Taux de TVQ', 'overflow'))
      expect(screen.queryByRole('region')).not.toBeInTheDocument()
      expect(screen.getByRole('table').parentElement).not.toHaveAttribute('tabindex')
    })

    it('becomes a named, focusable region when the table is wider than its wrapper', async () => {
      widths(600, 300)
      render(table('Taux de TVQ', 'overflow'))
      const region = screen.getByRole('region', { name: 'Taux de TVQ' })
      await userEvent.tab()
      expect(region).toHaveFocus()
    })
  })
})

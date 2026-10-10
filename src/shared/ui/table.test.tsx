import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Table, TableBody, TableCell, TableGroupRow, TableHead, TableHeader, TableRow } from './table'

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

  describe('the one header style and alignment', () => {
    const headed = (props: { stickyHeader?: boolean } = {}) => (
      <Table {...props}>
        <TableHeader>
          <TableRow>
            <TableHead>Nom</TableHead>
            <TableHead align="right">Documents</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableGroupRow colSpan={2}>Psychologues</TableGroupRow>
          <TableRow>
            <TableHead scope="row">Geneviève</TableHead>
            <TableCell align="right">0 / 3</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )

    it('heads are the overline, left by default; align="right" for numbers, on heads and cells', () => {
      render(headed())
      const name = screen.getByRole('columnheader', { name: 'Nom' })
      expect(name).toHaveClass('text-2xs', 'font-medium', 'uppercase', 'tracking-wide', 'text-muted-foreground', 'text-left')
      expect(screen.getByRole('columnheader', { name: 'Documents' })).toHaveClass('text-right')
      expect(screen.getByRole('cell', { name: '0 / 3' })).toHaveClass('text-right', 'tabular')
    })

    it('a cell without align adds no alignment class', () => {
      render(table())
      expect(screen.getByRole('cell')).not.toHaveClass('text-right')
    })

    it('a group row spans the columns with the overline on the muted fill', () => {
      render(headed())
      const group = screen.getByRole('rowheader', { name: 'Psychologues' })
      expect(group).toHaveAttribute('scope', 'rowgroup')
      expect(group).toHaveAttribute('colspan', '2')
      expect(group).toHaveClass('bg-muted', 'text-2xs', 'uppercase', 'text-muted-foreground')
    })

    it('stickyHeader: only the thead heads stick (from lg), and the wrapper clips instead of scrolling there', () => {
      render(headed({ stickyHeader: true }))
      const name = screen.getByRole('columnheader', { name: 'Nom' })
      expect(name).toHaveAttribute('data-sticky', 'true')
      expect(name).toHaveClass('lg:sticky')
      expect(screen.getByRole('rowheader', { name: 'Geneviève' })).not.toHaveAttribute('data-sticky')
      expect(screen.getByRole('table').parentElement).toHaveClass('overflow-x-auto', 'lg:overflow-x-clip')
    })

    it('without stickyHeader nothing sticks', () => {
      render(headed())
      expect(screen.getByRole('columnheader', { name: 'Nom' })).not.toHaveAttribute('data-sticky')
      expect(screen.getByRole('table').parentElement).not.toHaveClass('lg:overflow-x-clip')
    })
  })
})

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Table, TableBody, TableCell, TableRow } from './table'

const table = (label?: string) => (
  <Table aria-label={label}>
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
})

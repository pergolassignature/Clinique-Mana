import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DateField, type DateFieldProps } from './date-field'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog'
import { FormField } from './form-field'
import { FieldsReadOnlyContext } from './read-only-context'

function Harness({ initial = '', ...props }: Partial<DateFieldProps> & { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <FormField label="Date de naissance">{(field) => <DateField {...field} {...props} value={value} onChange={setValue} />}</FormField>
      <output data-testid="value">{value}</output>
      <button type="button">Ailleurs</button>
    </form>
  )
}

const field = () => screen.getByRole('combobox', { name: 'Date de naissance' })
const value = () => screen.getByTestId('value').textContent
/** The calendar moves focus on the next frame. */
const frame = () => act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))))

describe('DateField', () => {
  beforeEach(() => {
    // 13 October 2026, 15:00 in Montréal: « aujourd'hui » for the clinic.
    vi.useFakeTimers({ now: new Date('2026-10-13T19:00:00Z'), toFake: ['Date'] })
  })
  afterEach(() => vi.useRealTimers())

  it('shows the calendar date in French without a timezone shift, value stays yyyy-MM-dd', () => {
    render(<Harness initial="2020-01-01" />)
    // A timezone conversion would show 31 déc. 2019.
    expect(field()).toHaveValue('1 janv. 2020')
    expect(field()).toHaveAttribute('autocomplete', 'off')
    expect(value()).toBe('2020-01-01')
  })

  it.each([
    ['12/10/2026', '2026-10-12'],
    ['2026-10-12', '2026-10-12'],
    ['12 oct 2026', '2026-10-12'],
  ])('reads « %s » as it is typed', async (typed, expected) => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(field(), typed)
    expect(value()).toBe(expected)
    await user.click(screen.getByRole('button', { name: 'Ailleurs' }))
    expect(field()).toHaveValue('12 oct. 2026')
  })

  it('accepts a programmatic change (fireEvent.change) like the native input', () => {
    render(<Harness />)
    fireEvent.change(field(), { target: { value: '2027-06-30' } })
    expect(value()).toBe('2027-06-30')
  })

  it('puts the last date back when the text cannot be read; emptying clears; outside min–max is handed over for the form to refuse', async () => {
    const user = userEvent.setup()
    render(<Harness initial="2026-10-12" min="2026-01-01" max="2026-12-31" />)
    const over = { initialSelectionStart: 0, initialSelectionEnd: 20 }
    await user.type(field(), '31/02/2026{Enter}', over)
    expect(field()).toHaveValue('12 oct. 2026')
    expect(value()).toBe('2026-10-12')
    await user.clear(field())
    expect(value()).toBe('')
    await user.type(field(), '15/03/2026{Enter}')
    expect(value()).toBe('2026-03-15')
    expect(field()).toHaveValue('15 mars 2026')
    // As the native input: the form's validation says why a date outside the bounds is refused.
    await user.type(field(), '01/01/2027{Enter}', over)
    expect(value()).toBe('2027-01-01')
  })

  it('a calendar from Monday with today marked; arrows, Page↓ and Entrée choose, focus back in the field', async () => {
    const user = userEvent.setup()
    render(<Harness initial="2026-10-12" />)
    field().focus()
    await user.keyboard('{ArrowDown}')
    await frame()
    const calendar = screen.getByRole('dialog', { name: 'Choisir une date' })
    const headers = within(calendar).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers[0]).toBe('lu')
    expect(headers[6]).toBe('di')
    expect(within(calendar).getByRole('button', { name: 'mardi 13 octobre 2026' })).toHaveAttribute('aria-current', 'date')
    const selected = within(calendar).getByRole('button', { name: 'lundi 12 octobre 2026' })
    expect(selected).toHaveFocus()
    expect(selected.closest('td')).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowRight}')
    await frame()
    expect(within(calendar).getByRole('button', { name: 'mardi 13 octobre 2026' })).toHaveFocus()
    await user.keyboard('{PageDown}')
    await frame()
    expect(within(calendar).getByRole('button', { name: 'vendredi 13 novembre 2026' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(value()).toBe('2026-11-13')
    expect(screen.queryByRole('dialog', { name: 'Choisir une date' })).not.toBeInTheDocument()
    await frame()
    expect(field()).toHaveFocus()
    expect(field()).toHaveValue('13 nov. 2026')
  })

  it('the month and year can be picked; days outside min–max cannot be chosen', async () => {
    const user = userEvent.setup()
    render(<Harness initial="" min="1990-03-10" max="2026-12-31" />)
    await user.click(screen.getByRole('button', { name: 'Ouvrir le calendrier' }))
    const calendar = screen.getByRole('dialog', { name: 'Choisir une date' })
    await user.selectOptions(within(calendar).getByRole('combobox', { name: 'Année' }), '1990')
    await user.selectOptions(within(calendar).getByRole('combobox', { name: 'Mois' }), 'mars')
    const early = within(calendar).getByRole('button', { name: 'vendredi 9 mars 1990' })
    expect(early).toHaveAttribute('aria-disabled', 'true')
    await user.click(early)
    expect(value()).toBe('')
    expect(within(calendar).getByRole('button', { name: 'Mois précédent' })).toBeDisabled()
    await user.click(within(calendar).getByRole('button', { name: 'samedi 10 mars 1990' }))
    expect(value()).toBe('1990-03-10')
  })

  it('« Aujourd’hui » and, when clearable, « Effacer »', async () => {
    const user = userEvent.setup()
    render(<Harness initial="2026-01-05" clearable />)
    await user.click(screen.getByRole('button', { name: 'Ouvrir le calendrier' }))
    await user.click(screen.getByRole('button', { name: "Aujourd'hui" }))
    expect(value()).toBe('2026-10-13')
    await user.click(screen.getByRole('button', { name: 'Ouvrir le calendrier' }))
    await user.click(screen.getByRole('button', { name: 'Effacer' }))
    expect(value()).toBe('')
    expect(field()).toHaveValue('')
  })

  it('not clearable: no « Effacer »', async () => {
    const user = userEvent.setup()
    render(<Harness initial="2026-01-05" />)
    await user.click(screen.getByRole('button', { name: 'Ouvrir le calendrier' }))
    expect(screen.queryByRole('button', { name: 'Effacer' })).not.toBeInTheDocument()
  })

  it('Échap closes the calendar first, the dialog around only on the next Échap', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Plage</DialogTitle>
          <DialogDescription>Une plage</DialogDescription>
          <Harness initial="2026-10-12" />
        </DialogContent>
      </Dialog>,
    )
    field().focus()
    await user.keyboard('{ArrowDown}')
    await frame()
    expect(screen.getByRole('dialog', { name: 'Choisir une date' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Choisir une date' })).not.toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
    await frame()
    expect(field()).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('read-only: a plain read-only input with the date, no calendar', () => {
    render(
      <FieldsReadOnlyContext.Provider value={true}>
        <Harness initial="2026-10-12" />
      </FieldsReadOnlyContext.Provider>,
    )
    const input = screen.getByRole('textbox', { name: 'Date de naissance' })
    expect(input).toHaveAttribute('readonly')
    expect(input).toHaveValue('12 oct. 2026')
    expect(screen.queryByRole('button', { name: 'Ouvrir le calendrier' })).not.toBeInTheDocument()
  })
})

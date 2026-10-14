import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog'
import { FormField } from './form-field'
import { FieldsReadOnlyContext } from './read-only-context'
import { TimeField, type TimeFieldProps } from './time-field'

function Harness({ initial = '', onValue, ...props }: Partial<TimeFieldProps> & { initial?: string; onValue?: (value: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <FormField label="Début" help="Heure locale">
        {(field) => (
          <TimeField
            {...field}
            {...props}
            value={value}
            onChange={(next) => {
              setValue(next)
              onValue?.(next)
            }}
          />
        )}
      </FormField>
      <output data-testid="value">{value}</output>
      <button type="button">Ailleurs</button>
    </form>
  )
}

const field = () => screen.getByRole('combobox', { name: 'Début' })
const value = () => screen.getByTestId('value').textContent

describe('TimeField', () => {
  it('shows the value 24-hour and keeps the native HH:mm contract (seconds dropped)', () => {
    render(<Harness initial="07:00:00" />)
    expect(field()).toHaveValue('07:00')
    expect(field()).toHaveAttribute('autocomplete', 'off')
    expect(field()).toHaveAccessibleDescription('Heure locale')
  })

  it('hands over a finished time while typing, and tidies a short one on leaving', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<Harness initial="09:00" onValue={onValue} />)
    await user.clear(field())
    await user.type(field(), '7h30')
    expect(value()).toBe('07:30')
    await user.clear(field())
    await user.type(field(), '17')
    // « 17 » could still become « 1730 »: nothing yet.
    expect(value()).toBe('')
    await user.click(screen.getByRole('button', { name: 'Ailleurs' }))
    expect(value()).toBe('17:00')
    expect(field()).toHaveValue('17:00')
  })

  it('puts the last time back when the text cannot be read; outside min–max is handed over for the form to refuse', async () => {
    const user = userEvent.setup()
    render(<Harness initial="09:00" min="08:00" max="18:00" />)
    const over = { initialSelectionStart: 0, initialSelectionEnd: 5 }
    await user.type(field(), '25h{Enter}', over)
    expect(field()).toHaveValue('09:00')
    expect(value()).toBe('09:00')
    await user.type(field(), '0700{Enter}', over)
    expect(value()).toBe('07:00')
    // Typed text wins over the time highlighted in the list.
    await user.type(field(), '10{Enter}', over)
    expect(value()).toBe('10:00')
  })

  it('empties to "" like the native input', async () => {
    const user = userEvent.setup()
    render(<Harness initial="09:00" />)
    await user.clear(field())
    expect(value()).toBe('')
  })

  it('accepts a programmatic change (fireEvent.change) like the native input', () => {
    render(<Harness initial="09:00" />)
    fireEvent.change(field(), { target: { value: '10:15' } })
    expect(value()).toBe('10:15')
  })

  it('opens a list every `step` minutes inside min–max, on the current time; arrows and Entrée choose', async () => {
    const user = userEvent.setup()
    render(<Harness initial="09:00" step={30} min="08:00" max="12:00" />)
    field().focus()
    await user.keyboard('{ArrowDown}')
    const list = screen.getByRole('listbox', { name: 'Liste des heures' })
    const options = within(list).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00'])
    expect(field()).toHaveAttribute('aria-expanded', 'true')
    expect(field()).toHaveAttribute('aria-activedescendant', options[2]!.id)
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(value()).toBe('10:00')
    expect(field()).toHaveValue('10:00')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(field()).toHaveFocus()
  })

  it('chooses with the mouse from the clock button, keeping focus in the field', async () => {
    const user = userEvent.setup()
    render(<Harness initial="" />)
    await user.click(screen.getByRole('button', { name: 'Choisir une heure' }))
    await user.click(screen.getByRole('option', { name: '13:45' }))
    expect(value()).toBe('13:45')
    expect(field()).toHaveFocus()
  })

  it('Échap closes the list first, the dialog around only on the next Échap', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Plage</DialogTitle>
          <DialogDescription>Une plage</DialogDescription>
          <Harness initial="09:00" />
        </DialogContent>
      </Dialog>,
    )
    field().focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('read-only (prop or context): a plain read-only input with the time, no list', async () => {
    const user = userEvent.setup()
    render(
      <FieldsReadOnlyContext.Provider value={true}>
        <Harness initial="08:30:00" />
      </FieldsReadOnlyContext.Provider>,
    )
    const input = screen.getByRole('textbox', { name: 'Début' })
    expect(input).toHaveAttribute('readonly')
    expect(input).toHaveValue('08:30')
    expect(input).toBeEnabled()
    await user.type(input, '10')
    expect(input).toHaveValue('08:30')
    expect(screen.queryByRole('button', { name: 'Choisir une heure' })).not.toBeInTheDocument()
  })
})

import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm, type UseFormReturn } from 'react-hook-form'
import { Select } from './select'

// The muted placeholder colour is CSS (`:has(> option[value='']:checked)`), which happy-dom does not
// compute: these tests assert the DOM state the rule reads (which option is selected).

const options = (
  <>
    <option value="America/Toronto">America/Toronto</option>
    <option value="America/Vancouver">America/Vancouver</option>
  </>
)

const placeholderOption = () => screen.getByRole('option', { name: 'Choisir…' }) as HTMLOptionElement

describe('Select', () => {
  it('renders the placeholder as a disabled empty option', () => {
    render(
      <Select aria-label="Fuseau" placeholder="Choisir…">
        {options}
      </Select>,
    )
    expect(placeholderOption()).toBeDisabled()
    expect(placeholderOption()).toHaveValue('')
  })

  it('without value or defaultValue, starts on the placeholder instead of the first option', () => {
    render(
      <Select aria-label="Fuseau" placeholder="Choisir…">
        {options}
      </Select>,
    )
    expect(screen.getByRole('combobox')).toHaveValue('')
    expect(placeholderOption().selected).toBe(true)
  })

  it('keeps a given defaultValue, then follows the user', async () => {
    render(
      <Select aria-label="Fuseau" placeholder="Choisir…" defaultValue="America/Toronto">
        {options}
      </Select>,
    )
    const select = screen.getByRole('combobox')
    expect(select).toHaveValue('America/Toronto')
    expect(placeholderOption().selected).toBe(false)
    await userEvent.selectOptions(select, 'America/Vancouver')
    expect(select).toHaveValue('America/Vancouver')
  })

  it('controlled: follows the value', () => {
    const { rerender } = render(
      <Select aria-label="Fuseau" placeholder="Choisir…" value="" onChange={() => {}}>
        {options}
      </Select>,
    )
    expect(placeholderOption().selected).toBe(true)
    rerender(
      <Select aria-label="Fuseau" placeholder="Choisir…" value="America/Toronto" onChange={() => {}}>
        {options}
      </Select>,
    )
    expect(screen.getByRole('combobox')).toHaveValue('America/Toronto')
  })

  it('without a placeholder, adds no option and keeps the browser default', () => {
    render(
      <Select aria-label="Statut">
        <option value="">Tous les statuts</option>
        <option value="active">Actif</option>
      </Select>,
    )
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(screen.getByRole('combobox')).toHaveValue('')
  })
})

describe('Select, clearable', () => {
  it('lets the placeholder be chosen again, to clear the value', async () => {
    render(
      <Select aria-label="Province" placeholder="Choisir une province…" clearable defaultValue="QC">
        <option value="QC">Québec</option>
      </Select>,
    )
    const select = screen.getByRole('combobox')
    expect(screen.getByRole('option', { name: 'Choisir une province…' })).toBeEnabled()
    await userEvent.selectOptions(select, '')
    expect(select).toHaveValue('')
  })

  it('without clearable, the placeholder stays disabled', () => {
    render(
      <Select aria-label="Province" placeholder="Choisir une province…">
        <option value="QC">Québec</option>
      </Select>,
    )
    expect(screen.getByRole('option', { name: 'Choisir une province…' })).toBeDisabled()
  })
})

describe('Select with react-hook-form register()', () => {
  type Values = { timezone: string }
  let form: UseFormReturn<Values>

  function Form({ defaultValue }: { defaultValue?: string }) {
    form = useForm<Values>({ defaultValues: defaultValue === undefined ? {} : { timezone: defaultValue } })
    return (
      <Select aria-label="Fuseau" placeholder="Choisir…" {...form.register('timezone')}>
        {options}
      </Select>
    )
  }

  it('shows the registered default value', () => {
    render(<Form defaultValue="America/Toronto" />)
    expect(screen.getByRole('combobox')).toHaveValue('America/Toronto')
  })

  it('with no default, starts on the placeholder and reports an empty value', () => {
    render(<Form />)
    expect(placeholderOption().selected).toBe(true)
    expect(form.getValues('timezone')).toBe('')
  })

  it('setValue and reset move the DOM selection, including back to the placeholder', async () => {
    render(<Form defaultValue="" />)
    const select = screen.getByRole('combobox')
    await userEvent.selectOptions(select, 'America/Toronto')
    expect(form.getValues('timezone')).toBe('America/Toronto')
    act(() => form.setValue('timezone', ''))
    expect(placeholderOption().selected).toBe(true)
    act(() => form.reset({ timezone: 'America/Vancouver' }))
    expect(select).toHaveValue('America/Vancouver')
  })
})

describe('Select, read-only', () => {
  const provinces = (
    <>
      <option value="ON">Ontario</option>
      <option value="QC">Québec</option>
    </>
  )

  it('renders a read-only text input showing the chosen label, not the code', async () => {
    render(
      <>
        <label htmlFor="province">Province</label>
        <Select id="province" aria-describedby="province-help" readOnly value="QC" onChange={() => {}} placeholder="Choisir…">
          {provinces}
        </Select>
        <p id="province-help">Siège social.</p>
      </>,
    )
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    const input = screen.getByRole('textbox', { name: 'Province' })
    expect(input).toHaveValue('Québec')
    expect(input).toHaveAttribute('readonly')
    expect(input).toBeEnabled()
    expect(input).toHaveAccessibleDescription('Siège social.')
    // Focusable and selectable, like the other read-only fields.
    await userEvent.tab()
    expect(input).toHaveFocus()
  })

  it('finds the label inside nested fragments and arrays, and uses defaultValue when uncontrolled', () => {
    render(
      <Select aria-label="Province" readOnly defaultValue="ON">
        {[<option key="ab" value="AB">Alberta</option>]}
        <>{provinces}</>
      </Select>,
    )
    expect(screen.getByRole('textbox', { name: 'Province' })).toHaveValue('Ontario')
  })

  it('shows an empty field for no value (never the placeholder)', () => {
    render(
      <Select aria-label="Province" readOnly value="" onChange={() => {}} placeholder="Choisir…">
        {provinces}
      </Select>,
    )
    expect(screen.getByRole('textbox', { name: 'Province' })).toHaveValue('')
  })

  it('shows an unknown value as is', () => {
    render(
      <Select aria-label="Province" readOnly value="XX" onChange={() => {}}>
        {provinces}
      </Select>,
    )
    expect(screen.getByRole('textbox', { name: 'Province' })).toHaveValue('XX')
  })
})

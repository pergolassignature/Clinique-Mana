import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm, type UseFormReturn } from 'react-hook-form'
import { Select } from './select'

const options = (
  <>
    <option value="America/Toronto">America/Toronto</option>
    <option value="America/Vancouver">America/Vancouver</option>
  </>
)

const expectEmpty = (select: HTMLElement) => {
  expect(select).toHaveClass('text-subtle')
  expect(select).not.toHaveClass('text-foreground')
}
const expectChosen = (select: HTMLElement) => {
  expect(select).toHaveClass('text-foreground')
  expect(select).not.toHaveClass('text-subtle')
}

describe('Select placeholder colour', () => {
  it('uncontrolled with a chosen value: regular text', () => {
    render(
      <Select aria-label="Fuseau" placeholder="Choisir…" defaultValue="America/Toronto">
        {options}
      </Select>,
    )
    expectChosen(screen.getByRole('combobox'))
  })

  it('uncontrolled and empty: muted, until the user picks an option', async () => {
    render(
      <Select aria-label="Fuseau" placeholder="Choisir…" defaultValue="">
        {options}
      </Select>,
    )
    const select = screen.getByRole('combobox')
    expectEmpty(select)
    await userEvent.selectOptions(select, 'America/Vancouver')
    expectChosen(select)
  })

  it('controlled: follows the value', () => {
    const { rerender } = render(
      <Select aria-label="Fuseau" placeholder="Choisir…" value="" onChange={() => {}}>
        {options}
      </Select>,
    )
    expectEmpty(screen.getByRole('combobox'))
    rerender(
      <Select aria-label="Fuseau" placeholder="Choisir…" value="America/Toronto" onChange={() => {}}>
        {options}
      </Select>,
    )
    expectChosen(screen.getByRole('combobox'))
  })

  it('without a placeholder, never muted', () => {
    render(
      <Select aria-label="Statut" defaultValue="">
        <option value="">Tous les statuts</option>
        <option value="active">Actif</option>
      </Select>,
    )
    expectChosen(screen.getByRole('combobox'))
  })
})

describe('Select with react-hook-form register()', () => {
  type Values = { timezone: string }
  let form: UseFormReturn<Values>

  function Form({ defaultValue }: { defaultValue: string }) {
    form = useForm<Values>({ defaultValues: { timezone: defaultValue } })
    return (
      <Select aria-label="Fuseau" placeholder="Choisir…" {...form.register('timezone')}>
        {options}
      </Select>
    )
  }

  it('a registered default value renders as regular text', () => {
    render(<Form defaultValue="America/Toronto" />)
    expectChosen(screen.getByRole('combobox'))
  })

  it('an empty default is muted; choosing, then reset(), keep the colour in sync', async () => {
    render(<Form defaultValue="" />)
    const select = screen.getByRole('combobox')
    expectEmpty(select)
    await userEvent.selectOptions(select, 'America/Toronto')
    expectChosen(select)
    act(() => form.reset({ timezone: '' }))
    expect(select).toHaveValue('')
    expectEmpty(select)
    act(() => form.reset({ timezone: 'America/Vancouver' }))
    expectChosen(select)
  })
})

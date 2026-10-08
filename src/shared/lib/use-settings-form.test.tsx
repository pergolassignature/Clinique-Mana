import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { z } from 'zod'
import { useSettingsForm } from './use-settings-form'

const schema = z.object({
  name: z.string().trim().min(1, { error: 'Requis' }),
  city: z.string().trim(),
  country: z.string().trim(),
})
type Values = z.input<typeof schema>

const STORED: Values = { name: 'Clinique MANA', city: 'Montréal', country: 'Canada' }

/** Reads the form state during render, as a card does, so react-hook-form re-renders on its changes. */
function renderSettingsForm(values: Values = STORED) {
  return renderHook(
    ({ values: v }: { values: Values }) => {
      const settings = useSettingsForm({ schema, values: v })
      const { isDirty, dirtyFields, errors } = settings.form.formState
      return { ...settings, isDirty, dirtyFields, errors }
    },
    { initialProps: { values } },
  )
}

type Result = ReturnType<typeof renderSettingsForm>['result']

const edit = (result: Result, name: keyof Values, value: string) =>
  act(() => result.current.form.setValue(name, value, { shouldDirty: true }))

/** Submits; the save stays in flight until the returned `finish` is called with the saved values. */
async function submit(result: Result) {
  let onSaved: (saved: Values) => void = () => {}
  const save = vi.fn((_data: z.output<typeof schema>, done: (saved: Values) => void) => {
    onSaved = done
  })
  await act(() => result.current.handleSave(save)())
  return { save, finish: (saved: Values) => act(() => onSaved(saved)) }
}

describe('useSettingsForm', () => {
  it('re-syncs to new stored values, keeping the edited fields and the errors shown', async () => {
    const { result, rerender } = renderSettingsForm()
    await edit(result, 'name', '')
    const { save } = await submit(result)
    expect(save).not.toHaveBeenCalled()
    await waitFor(() => expect(result.current.errors.name?.message).toBe('Requis'))

    // E.g. another card's save refreshed the organization, or a refetch at window focus.
    rerender({ values: { name: 'Renommée', city: 'Laval', country: 'Canada' } })
    await waitFor(() => expect(result.current.form.getValues('city')).toBe('Laval'))
    expect(result.current.form.getValues('name')).toBe('')
    expect(result.current.errors.name?.message).toBe('Requis')
    expect(result.current.isDirty).toBe(true)
  })

  it('« Annuler » is a full reset to the last synced values: clean, edits and errors gone', async () => {
    const { result, rerender } = renderSettingsForm()
    rerender({ values: { ...STORED, city: 'Laval' } })
    await waitFor(() => expect(result.current.form.getValues('city')).toBe('Laval'))
    await edit(result, 'name', '')
    await edit(result, 'country', 'France')
    await submit(result)
    await waitFor(() => expect(result.current.errors.name).toBeDefined())

    act(() => result.current.cancel())
    await waitFor(() => expect(result.current.isDirty).toBe(false))
    expect(result.current.form.getValues()).toEqual({ ...STORED, city: 'Laval' })
    expect(result.current.errors).toEqual({})
  })

  it('« Annuler » after a save goes back to the saved values, even before the stored values catch up', async () => {
    const { result } = renderSettingsForm()
    await edit(result, 'city', ' Laval ')
    const { finish } = await submit(result)
    await finish({ ...STORED, city: 'Laval' })
    // `values` still holds the old row (a late or failed refetch).
    await edit(result, 'city', 'Québec')
    act(() => result.current.cancel())
    await waitFor(() => expect(result.current.isDirty).toBe(false))
    expect(result.current.form.getValues('city')).toBe('Laval')
  })

  it('after a save, takes the saved values and re-applies only the fields changed since the submit', async () => {
    const { result } = renderSettingsForm()
    await edit(result, 'name', '  Clinique MANA Laval ')
    const { save, finish } = await submit(result)
    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0]?.[0]).toEqual({ name: 'Clinique MANA Laval', city: 'Montréal', country: 'Canada' })

    // Typed while the save is in flight.
    await edit(result, 'city', 'Laval')
    await finish({ name: 'Clinique MANA Laval', city: 'Montréal', country: 'Canada' })

    await waitFor(() => expect(result.current.form.getValues('city')).toBe('Laval'))
    // The submitted field takes the saved (normalised) value; only the field typed meanwhile is dirty.
    expect(result.current.form.getValues('name')).toBe('Clinique MANA Laval')
    expect(result.current.isDirty).toBe(true)
    expect(result.current.dirtyFields).toEqual({ city: true })
  })

  it('a field typed back to its submitted value during the save takes the saved value, and the form is clean', async () => {
    const { result } = renderSettingsForm()
    await edit(result, 'name', '  Clinique MANA Laval ')
    const { finish } = await submit(result)
    await edit(result, 'name', 'autre chose')
    await edit(result, 'name', '  Clinique MANA Laval ')
    await finish({ ...STORED, name: 'Clinique MANA Laval' })

    await waitFor(() => expect(result.current.form.getValues('name')).toBe('Clinique MANA Laval'))
    expect(result.current.isDirty).toBe(false)
    expect(result.current.dirtyFields).toEqual({})
  })
})

import type { FocusEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import { regroupOnBlur } from './regroup-on-blur'

const upper = (v: string) => v.trim().toUpperCase()

function Field({ onDirty }: { onDirty?: (dirty: boolean) => void }) {
  const form = useForm<{ code: string }>({ defaultValues: { code: '' } })
  onDirty?.(form.formState.isDirty)
  return <input aria-label="Code" {...form.register('code', regroupOnBlur(form, 'code', upper))} />
}

describe('regroupOnBlur', () => {
  it('rewrites the field in its display format once it is left, and marks it dirty', async () => {
    const onDirty = vi.fn()
    render(<Field onDirty={onDirty} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Code' }), ' h2x ')
    await userEvent.tab()
    expect(screen.getByRole('textbox', { name: 'Code' })).toHaveValue('H2X')
    expect(onDirty).toHaveBeenLastCalledWith(true)
  })

  it('sets nothing when the value is already in its format', () => {
    const setValue = vi.fn()
    const { onBlur } = regroupOnBlur({ setValue, formState: { isSubmitted: false } }, 'code', upper)
    onBlur({ target: { value: 'H2X' } } as FocusEvent<HTMLInputElement>)
    expect(setValue).not.toHaveBeenCalled()
  })

  it('re-validates only once the form has been submitted', () => {
    const setValue = vi.fn()
    const formState = { isSubmitted: false }
    const { onBlur } = regroupOnBlur({ setValue, formState }, 'code', upper)
    onBlur({ target: { value: 'a' } } as FocusEvent<HTMLInputElement>)
    expect(setValue).toHaveBeenLastCalledWith('code', 'A', { shouldDirty: true, shouldValidate: false })
    formState.isSubmitted = true
    onBlur({ target: { value: 'b' } } as FocusEvent<HTMLInputElement>)
    expect(setValue).toHaveBeenLastCalledWith('code', 'B', { shouldDirty: true, shouldValidate: true })
  })
})

import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SegmentedControl, type SegmentedOption } from './segmented-control'

type V = 'a' | 'b' | 'c'
const OPTIONS: SegmentedOption<V>[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bêta' },
  { value: 'c', label: 'Gamma' },
]

function renderControl(props: Partial<ComponentProps<typeof SegmentedControl<V>>> = {}) {
  const onValueChange = vi.fn()
  render(
    <>
      <span id="label">Choix</span>
      <SegmentedControl options={OPTIONS} value="a" onValueChange={onValueChange} aria-labelledby="label" {...props} />
      <button type="button">Après</button>
    </>,
  )
  return { onValueChange }
}

const option = (name: string) => screen.getByRole('button', { name })

describe('SegmentedControl', () => {
  it('is a labelled group of toggle buttons, the chosen one pressed', () => {
    renderControl()
    expect(screen.getByRole('group', { name: 'Choix' })).toBeInTheDocument()
    expect(option('Alpha')).toHaveAttribute('aria-pressed', 'true')
    expect(option('Bêta')).toHaveAttribute('aria-pressed', 'false')
  })

  it('has one tab stop, the chosen option', async () => {
    renderControl({ value: 'b' })
    await userEvent.tab()
    expect(option('Bêta')).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Après' })).toHaveFocus()
  })

  it('the arrow keys only move focus (wrapping, skipping disabled options); Enter or Space chooses', async () => {
    const { onValueChange } = renderControl({ options: [OPTIONS[0] as SegmentedOption<V>, { value: 'b', label: 'Bêta', disabled: true }, OPTIONS[2] as SegmentedOption<V>] })
    await userEvent.tab()
    await userEvent.keyboard('{ArrowRight}')
    expect(option('Gamma')).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    expect(option('Alpha')).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}{End}')
    expect(option('Gamma')).toHaveFocus()
    expect(onValueChange).not.toHaveBeenCalled()

    await userEvent.keyboard('{Enter}')
    expect(onValueChange).toHaveBeenCalledWith('c')
    await userEvent.keyboard('{Home} ')
    expect(onValueChange).toHaveBeenCalledTimes(1) // Alpha is already chosen
    await userEvent.keyboard('{End} ')
    expect(onValueChange).toHaveBeenLastCalledWith('c')
  })

  it('a click chooses another option, never the chosen one', async () => {
    const { onValueChange } = renderControl()
    await userEvent.click(option('Alpha'))
    expect(onValueChange).not.toHaveBeenCalled()
    await userEvent.click(option('Bêta'))
    expect(onValueChange).toHaveBeenCalledWith('b')
  })

  it('while pending: busy, still focusable, presses ignored', async () => {
    const { onValueChange } = renderControl({ pending: true })
    expect(screen.getByRole('group')).toHaveAttribute('aria-busy', 'true')
    await userEvent.tab()
    expect(option('Alpha')).toHaveFocus()
    expect(option('Bêta')).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(option('Bêta'))
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('disabled: every option disabled, out of the tab order', async () => {
    renderControl({ disabled: true })
    for (const o of OPTIONS) expect(option(o.label)).toBeDisabled()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Après' })).toHaveFocus()
  })
})

import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MOTIF_CATEGORY_ICONS, type MotifCategoryIcon } from '../../lib/constants'
import { motifIconLabel } from '../../lib/display'
import { IconPicker } from './IconPicker'

function Harness({ initial = 'Leaf', onChange }: { initial?: MotifCategoryIcon; onChange?: (icon: MotifCategoryIcon) => void }) {
  const [value, setValue] = useState<MotifCategoryIcon>(initial)
  return (
    <>
      <button type="button">Avant</button>
      <span id="icon-label">Icône</span>
      <IconPicker
        labelledBy="icon-label"
        value={value}
        onChange={(icon) => {
          setValue(icon)
          onChange?.(icon)
        }}
      />
      <button type="button">Après</button>
    </>
  )
}

const radio = (icon: MotifCategoryIcon) => screen.getByRole('radio', { name: motifIconLabel(icon) })

describe('IconPicker', () => {
  it('is a named radio group of the 20 icons, the chosen one checked', () => {
    render(<Harness />)
    expect(screen.getByRole('radiogroup', { name: 'Icône' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(MOTIF_CATEGORY_ICONS.length)
    expect(radio('Leaf')).toBeChecked()
    expect(radio('Brain')).not.toBeChecked()
  })

  it('has one tab stop, the chosen icon', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Avant' }))
    await userEvent.tab()
    expect(radio('Leaf')).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Après' })).toHaveFocus()
  })

  it('arrow keys move focus only (decision #36); Enter or Space chooses', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    // A grid of 5 per row: Leaf (7) → Heart (8) → Sun (13, a row below) → Heart → Leaf.
    radio('Leaf').focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(radio('Heart')).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(radio('Sun')).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}{ArrowLeft}')
    expect(radio('Leaf')).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(radio('MessageCircle')).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    expect(radio('Brain')).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(radio('Brain')).toHaveFocus()
    expect(onChange).not.toHaveBeenCalled()
    expect(radio('Leaf')).toBeChecked()

    await userEvent.keyboard('{ArrowRight}{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('Users')
    expect(radio('Users')).toBeChecked()
    await userEvent.keyboard('{ArrowRight} ')
    expect(onChange).toHaveBeenLastCalledWith('AlertTriangle')
    expect(radio('AlertTriangle')).toBeChecked()
  })

  it('Up and Down stay in the grid at its edges', async () => {
    render(<Harness initial="Brain" />)
    radio('Brain').focus()
    await userEvent.keyboard('{ArrowUp}')
    expect(radio('Brain')).toHaveFocus()
    // Brain (0) → 5 → 10 → Home (15), the last row's column: a fourth Down stays there.
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}')
    expect(radio('Home')).toHaveFocus()
  })

  it('a click chooses', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await userEvent.click(radio('Compass'))
    expect(onChange).toHaveBeenCalledWith('Compass')
    expect(radio('Compass')).toBeChecked()
  })

  it('after moving away without choosing, Tab comes back to the chosen icon', async () => {
    render(<Harness />)
    radio('Leaf').focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    expect(radio('Activity')).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Après' })).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(radio('Leaf')).toHaveFocus()
  })
})

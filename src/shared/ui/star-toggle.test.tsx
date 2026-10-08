import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { StarToggle } from './star-toggle'

function Harness({ onToggle }: { onToggle?: () => void }) {
  const [on, setOn] = useState(false)
  return (
    <>
      <span id="item">Couples</span>
      <StarToggle
        specialized={on}
        describedBy="item"
        onToggle={() => {
          onToggle?.()
          setOn((v) => !v)
        }}
      />
    </>
  )
}

describe('StarToggle', () => {
  it('names the action, described by the item, and toggles with a click', async () => {
    render(<Harness />)
    const star = screen.getByRole('button', { name: t('common.star.add') })
    expect(star).toHaveAccessibleDescription('Couples')
    await userEvent.click(star)
    expect(screen.getByRole('button', { name: t('common.star.remove') })).toBe(star)
  })

  it('toggles with Space and Enter from the keyboard', async () => {
    render(<Harness />)
    await userEvent.tab()
    expect(screen.getByRole('button', { name: t('common.star.add') })).toHaveFocus()
    await userEvent.keyboard(' ')
    expect(screen.getByRole('button', { name: t('common.star.remove') })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: t('common.star.add') })).toHaveFocus()
  })

  it('does nothing while disabled', async () => {
    const onToggle = vi.fn()
    render(<StarToggle specialized={false} onToggle={onToggle} disabled />)
    await userEvent.click(screen.getByRole('button', { name: t('common.star.add') }))
    expect(onToggle).not.toHaveBeenCalled()
  })
})

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { t } from '@/i18n'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './sheet'

const dialog = (hideClose = false) => (
  <Dialog open>
    <DialogContent hideClose={hideClose}>
      <DialogTitle>Titre</DialogTitle>
      <DialogDescription>Description</DialogDescription>
    </DialogContent>
  </Dialog>
)

const sheet = (hideClose = false) => (
  <Sheet open>
    <SheetContent hideClose={hideClose}>
      <SheetTitle>Titre</SheetTitle>
      <SheetDescription>Description</SheetDescription>
    </SheetContent>
  </Sheet>
)

describe.each([
  ['Dialog', dialog],
  ['Sheet', sheet],
])('%s default close button', (_name, ui) => {
  it('is labelled through t() and kept out of the tab order', () => {
    render(ui())
    const close = screen.getByRole('button', { name: t('common.close') })
    expect(close).toHaveAttribute('tabindex', '-1')
  })

  it('is not rendered with hideClose', () => {
    render(ui(true))
    expect(screen.queryByRole('button', { name: t('common.close') })).not.toBeInTheDocument()
  })
})

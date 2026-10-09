import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from './alert-dialog'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './sheet'

// The app shell finds open modals by aria-modal (⌘K stays closed while one is open).
describe('modal content', () => {
  it.each([
    [
      'Dialog',
      <Dialog open>
        <DialogContent>
          <DialogTitle>Titre</DialogTitle>
          <DialogDescription>Description</DialogDescription>
        </DialogContent>
      </Dialog>,
      'dialog',
    ],
    [
      'AlertDialog',
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>Titre</AlertDialogTitle>
          <AlertDialogDescription>Description</AlertDialogDescription>
        </AlertDialogContent>
      </AlertDialog>,
      'alertdialog',
    ],
    [
      'Sheet',
      <Sheet open>
        <SheetContent>
          <SheetTitle>Titre</SheetTitle>
          <SheetDescription>Description</SheetDescription>
        </SheetContent>
      </Sheet>,
      'dialog',
    ],
  ] as const)('%s is marked aria-modal', (_name, ui, role) => {
    render(ui)
    expect(screen.getByRole(role, { name: 'Titre' })).toHaveAttribute('aria-modal', 'true')
  })

  it('a popover is not modal', () => {
    render(
      <Popover open>
        <PopoverTrigger>Options</PopoverTrigger>
        <PopoverContent aria-label="Options">Contenu</PopoverContent>
      </Popover>,
    )
    expect(screen.getByRole('dialog', { name: 'Options' })).not.toHaveAttribute('aria-modal')
  })

  it('a dialog is centred by default; position="top" anchors it 15vh from the top without the vertical centring', () => {
    const { unmount } = render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Centré</DialogTitle>
        </DialogContent>
      </Dialog>,
    )
    const centred = screen.getByRole('dialog', { name: 'Centré' })
    expect(centred).toHaveAttribute('data-position', 'center')
    expect(centred).toHaveClass('top-1/2', '-translate-y-1/2', 'animate-dialog-in')
    unmount()

    render(
      <Dialog open>
        <DialogContent position="top" className="max-w-[600px]">
          <DialogTitle>En haut</DialogTitle>
        </DialogContent>
      </Dialog>,
    )
    const top = screen.getByRole('dialog', { name: 'En haut' })
    expect(top).toHaveAttribute('data-position', 'top')
    expect(top).toHaveClass('top-[15vh]', 'translate-y-0', 'animate-dialog-in-top', '-translate-x-1/2', 'max-w-[600px]')
    expect(top).not.toHaveClass('top-1/2')
    expect(top).not.toHaveClass('-translate-y-1/2')
    expect(top).not.toHaveClass('animate-dialog-in')
  })
})

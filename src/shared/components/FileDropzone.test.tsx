import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { UploadStep } from '@/shared/lib/files'
import { FileDropzone } from './FileDropzone'

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const MB = 1_048_576

/** A PNG of `size` bytes (its signature, then zeros), named and typed as given. */
function png(size: number, name = 'logo.png', type = 'image/png'): File {
  const bytes = new Uint8Array(size)
  bytes.set(PNG_HEAD)
  return new File([bytes], name, { type })
}

const BUTTON = 'Choisir un fichier'
const HINT = 'PNG ou JPEG, 2 Mo au plus.'

function renderDropzone(overrides: Partial<Parameters<typeof FileDropzone>[0]> = {}) {
  const onUpload = vi.fn<(file: File, mimeType: string, onStep: (step: UploadStep) => void) => Promise<void>>(async () => {})
  const errorMessage = vi.fn((error: unknown) => (error instanceof Error ? error.message : 'Erreur'))
  render(
    <>
      <input aria-label="avant" />
      <FileDropzone buttonLabel={BUTTON} hint={HINT} accept={['image/png', 'image/jpeg']} maxBytes={2 * MB} onUpload={onUpload} errorMessage={errorMessage} {...overrides} />
      <input aria-label="après" />
    </>,
  )
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  return { onUpload, errorMessage, input }
}

const button = () => screen.getByRole('button', { name: BUTTON })

describe('FileDropzone', () => {
  it('offers one button, described by the hint, with a hidden file input limited to the accepted types', () => {
    const { input } = renderDropzone()
    expect(button()).toHaveAccessibleDescription(HINT)
    expect(input).toHaveAttribute('accept', 'image/png,image/jpeg')
    expect(input).not.toBeVisible()
    expect(input).toHaveAttribute('tabindex', '-1')
  })

  it('is one tab stop between the fields around it', async () => {
    renderDropzone()
    screen.getByRole('textbox', { name: 'avant' }).focus()
    await userEvent.tab()
    expect(button()).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('textbox', { name: 'après' })).toHaveFocus()
  })

  it('opens the file picker from the keyboard (Enter and Space)', async () => {
    const { input } = renderDropzone()
    const click = vi.spyOn(input, 'click').mockImplementation(() => {})
    button().focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')
    expect(click).toHaveBeenCalledTimes(2)
  })

  it('refuses a 3 MB PNG before any upload, with the size in the message', async () => {
    const { onUpload, input } = renderDropzone()
    await userEvent.upload(input, png(3 * MB))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ce fichier dépasse la taille permise (2 Mo).')
    expect(button()).toHaveAccessibleDescription(`${HINT} Ce fichier dépasse la taille permise (2 Mo).`)
    expect(onUpload).not.toHaveBeenCalled()
  })

  it('refuses a type the purpose does not accept before any upload', async () => {
    const { onUpload, input } = renderDropzone()
    // userEvent.upload honours the accept attribute; a drop does not.
    fireEvent.drop(input.parentElement as HTMLElement, { dataTransfer: { files: [new File(['GIF89a'], 'a.gif', { type: 'image/gif' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent(t('storage.dropzone.wrongType'))
    expect(onUpload).not.toHaveBeenCalled()
  })

  it('uploads an accepted file, declared by its content (a PNG named .jpg goes as image/png)', async () => {
    const { onUpload, input } = renderDropzone()
    const file = png(1000, 'photo.jpg', 'image/jpeg')
    await userEvent.upload(input, file)
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1))
    expect(onUpload.mock.calls[0]?.[0]).toBe(file)
    expect(onUpload.mock.calls[0]?.[1]).toBe('image/png')
  })

  it('shows the steps as progress, and is inactive meanwhile', async () => {
    let step: (s: UploadStep) => void = () => {}
    let finish: () => void = () => {}
    const onUpload = vi.fn((_file: File, _mime: string, onStep: (s: UploadStep) => void) => {
      step = onStep
      return new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    const { input } = renderDropzone({ onUpload })
    await userEvent.upload(input, png(1000))
    const progress = await screen.findByRole('progressbar', { name: t('storage.dropzone.progressLabel') })
    act(() => step('sending'))
    expect(progress).toHaveAttribute('aria-valuenow', '2')
    expect(progress).toHaveAttribute('aria-valuemax', '3')
    expect(screen.getByRole('status')).toHaveTextContent('Envoi de logo.png…')
    act(() => step('confirming'))
    expect(progress).toHaveAttribute('aria-valuenow', '3')
    expect(button()).toHaveAttribute('aria-disabled', 'true')
    // A second file while one is going is ignored.
    fireEvent.drop(input.parentElement as HTMLElement, { dataTransfer: { files: [png(10)] } })
    expect(onUpload).toHaveBeenCalledTimes(1)

    await act(async () => finish())
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(button()).not.toHaveAttribute('aria-disabled')
  })

  it("shows the upload's error text, then clears it on the next try", async () => {
    const { input, onUpload, errorMessage } = renderDropzone()
    const refusal = new Error("Ce fichier n'est pas du type annoncé.")
    onUpload.mockRejectedValueOnce(refusal)
    await userEvent.upload(input, png(1000))
    expect(await screen.findByRole('alert')).toHaveTextContent("Ce fichier n'est pas du type annoncé.")
    expect(errorMessage).toHaveBeenCalledWith(refusal)

    await userEvent.upload(input, png(1000))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(onUpload).toHaveBeenCalledTimes(2)
  })

  it('accepts a dropped file and marks the zone while a file is dragged over it', async () => {
    const { input, onUpload } = renderDropzone()
    const zone = input.parentElement as HTMLElement
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'] } })
    expect(zone).toHaveAttribute('data-drag-active', 'true')
    fireEvent.dragLeave(zone)
    expect(zone).not.toHaveAttribute('data-drag-active')
    fireEvent.drop(zone, { dataTransfer: { files: [png(1000)] } })
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1))
  })

  it('lets the same file be chosen again after a refusal', async () => {
    const { input } = renderDropzone()
    await userEvent.upload(input, png(3 * MB))
    await screen.findByRole('alert')
    expect(input.value).toBe('')
  })
})

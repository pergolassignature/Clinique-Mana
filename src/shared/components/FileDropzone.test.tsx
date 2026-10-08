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

/** A PNG whose IHDR states `width` × `height`, named and typed as given. */
function pngSized(width: number, height: number, name = 'grand.png'): File {
  const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
  const ihdr = [0, 0, 0, 0x0d, ...[...'IHDR'].map((c) => c.charCodeAt(0)), ...be32(width), ...be32(height), 8, 6, 0, 0, 0]
  return new File([new Uint8Array([...PNG_HEAD, ...ihdr, 0, 0, 0, 0])], name, { type: 'image/png' })
}

function renderDropzone(overrides: Partial<Parameters<typeof FileDropzone>[0]> = {}) {
  const onUpload = vi.fn<(file: File, mimeType: string, onStep: (step: UploadStep) => void) => Promise<void>>(async () => {})
  const errorMessage = vi.fn((error: unknown) => (error instanceof Error ? error.message : 'Erreur'))
  const result = render(
    <>
      <input aria-label="avant" />
      <FileDropzone buttonLabel={BUTTON} hint={HINT} accept={['image/png', 'image/jpeg']} maxBytes={2 * MB} onUpload={onUpload} errorMessage={errorMessage} {...overrides} />
      <input aria-label="après" />
    </>,
  )
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  return { onUpload, errorMessage, input, unmount: result.unmount }
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

  it('refuses an empty file before any upload', async () => {
    const { onUpload, input } = renderDropzone()
    await userEvent.upload(input, new File([], 'logo.png', { type: 'image/png' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t('storage.dropzone.empty'))
    expect(onUpload).not.toHaveBeenCalled()
  })

  it('refuses a text file renamed .png by its content, before any upload', async () => {
    const { onUpload, input } = renderDropzone()
    await userEvent.upload(input, new File(['Ceci est du texte.'], 'logo.png', { type: 'image/png' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t('storage.dropzone.wrongType'))
    expect(onUpload).not.toHaveBeenCalled()
  })

  it('refuses an image wider or taller than the side cap, read from its header, before any upload', async () => {
    const { onUpload, input } = renderDropzone({ maxImageSide: 4000 })
    await userEvent.upload(input, pngSized(4001, 200))
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Cette image dépasse la taille permise \(4\s000 pixels de côté\)\.$/)
    expect(onUpload).not.toHaveBeenCalled()

    await userEvent.upload(input, pngSized(4000, 4000))
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1))
  })

  it('without a side cap, does not read the image size', async () => {
    const { onUpload, input } = renderDropzone()
    await userEvent.upload(input, pngSized(9000, 9000))
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1))
  })

  it('while shown, a file dropped outside the zone is cancelled (the tab does not open it); not after', () => {
    /** Dispatches a drag event carrying `dataTransfer` as is; true when its default was not prevented. */
    const drag = (target: Element, type: 'dragover' | 'drop', dataTransfer: object) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
      return target.dispatchEvent(event)
    }
    const { input, unmount } = renderDropzone()
    const outside = screen.getByRole('textbox', { name: 'avant' })
    const files = { types: ['Files'], files: [png(10)], dropEffect: 'copy' }
    expect(drag(outside, 'dragover', files)).toBe(false)
    expect(files.dropEffect).toBe('none')
    expect(drag(outside, 'drop', files)).toBe(false)
    // Dragged text is left alone.
    expect(drag(outside, 'drop', { types: ['text/plain'], dropEffect: 'copy' })).toBe(true)
    // Over the zone, the drop stays allowed.
    const over = { types: ['Files'], files: [], dropEffect: 'copy' }
    expect(drag(input.parentElement as HTMLElement, 'dragover', over)).toBe(false)
    expect(over.dropEffect).toBe('copy')

    unmount()
    expect(drag(document.body, 'dragover', { types: ['Files'], dropEffect: 'copy' })).toBe(true)
    expect(drag(document.body, 'drop', files)).toBe(true)
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { SigningPreviewDialog } from './SigningPreviewDialog'

const mocks = vi.hoisted(() => ({ previewProfessionalContract: vi.fn() }))
vi.mock('../../api/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/contracts')>()),
  previewProfessionalContract: mocks.previewProfessionalContract,
}))

const P = 'modules.professionals.contract.preview'
const PRO_ID = '11111111-1111-4111-8111-111111111111'
const KEY = '22222222-2222-4222-8222-222222222222'
const TITLE = 'Contrat de service — Christine Sirois'
const BLOB_URL = 'blob:http://localhost/preview'

/** `undefined` is an older browser (or jsdom): the frame is used, as before. */
function setPdfViewerEnabled(value: boolean | undefined) {
  Object.defineProperty(navigator, 'pdfViewerEnabled', { value, configurable: true })
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => BLOB_URL)
  URL.revokeObjectURL = vi.fn()
  mocks.previewProfessionalContract.mockResolvedValue({
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    pageCount: 6,
    title: TITLE,
    signers: [{ role: 'professional', name: 'Christine Sirois', order: 1 }],
    summary: [],
  })
})

afterEach(() => {
  vi.resetAllMocks()
  setPdfViewerEnabled(undefined)
})

function renderDialog() {
  return render(
    renderWithContexts(
      <SigningPreviewDialog
        form="service_contract"
        professionalId={PRO_ID}
        firstName="Christine"
        version={3}
        source={{ kind: 'prepare', action: 'send', key: KEY }}
        onClose={() => {}}
      />,
    ),
  )
}

describe('SigningPreviewDialog: the PDF frame', () => {
  it('frames the PDF when the browser draws PDFs in the page', async () => {
    setPdfViewerEnabled(true)
    renderDialog()

    expect(await screen.findByTitle(t(`${P}.frameTitle`))).toHaveAttribute('src', BLOB_URL)
    expect(screen.queryByText(t(`${P}.noInlineViewer`))).toBeNull()
  })

  it('offers the document instead of a frame that would stay empty', async () => {
    setPdfViewerEnabled(false)
    renderDialog()

    expect(await screen.findByText(t(`${P}.noInlineViewer`))).toBeInTheDocument()
    // The frame is not drawn at all: a refused one reports nothing and would look broken.
    expect(screen.queryByTitle(t(`${P}.frameTitle`))).toBeNull()

    const download = screen.getByRole('link', { name: t(`${P}.download`) })
    expect(download).toHaveAttribute('href', BLOB_URL)
    expect(download).toHaveAttribute('download', `${TITLE}.pdf`)
  })

  it('keeps the facts and the new-tab link in both cases', async () => {
    setPdfViewerEnabled(false)
    renderDialog()

    expect(await screen.findByText('Christine Sirois')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t(`${P}.openTab`) })).toHaveAttribute('href', BLOB_URL)
  })
})

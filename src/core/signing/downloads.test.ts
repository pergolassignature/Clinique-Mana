import { beforeEach, describe, expect, it, vi } from 'vitest'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { canSplit, prepareSignedDownload, signedDownloadErrorMessage, type SignedDocumentFiles } from './downloads'
import { PdfSplitError } from './pdf-split-error'
import { pageCountOf, pdfWithPages } from './test/pdf-fixture'

const mocks = vi.hoisted(() => ({ fetchStoredFile: vi.fn() }))
vi.mock('@/core/storage/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/core/storage/api')>()), fetchStoredFile: mocks.fetchStoredFile }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const SIGNED = 'signed-file'
const SOURCE = 'source-file'

function files(over: Partial<SignedDocumentFiles> = {}): SignedDocumentFiles {
  return { title: 'Contrat de service — Marie Tremblay', completedAt: '2026-10-09T15:00:00Z', signedFileId: SIGNED, sourceFileId: SOURCE, pageCount: 7, ...over }
}

/** The stored files: the sealed PDF (`sealed` pages) and the source (`source` pages). */
async function stored({ sealed, source }: { sealed: number; source: number }) {
  const bytes: Record<string, Uint8Array> = { [SIGNED]: await pdfWithPages(sealed), [SOURCE]: await pdfWithPages(source) }
  mocks.fetchStoredFile.mockImplementation((id: string) => Promise.resolve(bytes[id]))
}

beforeEach(() => mocks.fetchStoredFile.mockReset())

describe('prepareSignedDownload (P4-500)', () => {
  it('N recorded: the contract alone, named with its signing date; the source is not read', async () => {
    await stored({ sealed: 10, source: 7 })
    const result = await prepareSignedDownload(files(), 'document')
    expect(result.file!.fileName).toBe('Contrat de service - Marie Tremblay - signé le 2026-10-09.pdf')
    expect(await pageCountOf(result.file!.bytes)).toBe(7)
    expect(result.hasCertificate).toBe(true)
    expect(mocks.fetchStoredFile.mock.calls.map(([id]) => id)).toEqual([SIGNED])
  })

  it('the certificate and journal: pages N+1…end', async () => {
    await stored({ sealed: 10, source: 7 })
    const result = await prepareSignedDownload(files(), 'certificate')
    expect(result.file!.fileName).toBe('Contrat de service - Marie Tremblay - certificat et journal de signature.pdf')
    expect(await pageCountOf(result.file!.bytes)).toBe(3)
  })

  it('N not recorded (an earlier contract): the stored source file’s page count', async () => {
    await stored({ sealed: 15, source: 7 })
    const result = await prepareSignedDownload(files({ pageCount: null }), 'certificate')
    expect(await pageCountOf(result.file!.bytes)).toBe(8)
    expect(mocks.fetchStoredFile.mock.calls.map(([id]) => id).sort()).toEqual([SIGNED, SOURCE].sort())
  })

  it('N = total: no certificate file (hasCertificate false); the contract is the sealed file itself', async () => {
    await stored({ sealed: 7, source: 7 })
    const certificate = await prepareSignedDownload(files(), 'certificate')
    expect(certificate).toEqual({ file: null, hasCertificate: false })
    const document = await prepareSignedDownload(files(), 'document')
    expect(await pageCountOf(document.file!.bytes)).toBe(7)
  })

  it('N unknown (no count, no source): nothing is read, page_count_unknown', async () => {
    expect(canSplit(files({ pageCount: null, sourceFileId: null }))).toBe(false)
    await expect(prepareSignedDownload(files({ pageCount: null, sourceFileId: null }), 'document')).rejects.toMatchObject({ code: 'page_count_unknown' })
    expect(mocks.fetchStoredFile).not.toHaveBeenCalled()
  })

  it('the sealed original: the stored bytes untouched, « … - complet scellé.pdf », pdf-lib not needed', async () => {
    await stored({ sealed: 10, source: 7 })
    const result = await prepareSignedDownload(files({ pageCount: null, sourceFileId: null }), 'sealed')
    expect(result.file!.fileName).toBe('Contrat de service - Marie Tremblay - complet scellé.pdf')
    expect(await pageCountOf(result.file!.bytes)).toBe(10)
    expect(result.hasCertificate).toBeNull()
  })
})

describe('signedDownloadErrorMessage', () => {
  it('a 429 with its delay, an unknown N, a failed split, anything else', () => {
    expect(signedDownloadErrorMessage(new FunctionCallError('rate_limited', 429, 'x', {}, 120))).toContain(t('signing.downloads.errors.rateLimited'))
    expect(signedDownloadErrorMessage(new PdfSplitError('page_count_unknown'))).toBe(t('signing.downloads.cannotSplit'))
    expect(signedDownloadErrorMessage(new PdfSplitError('page_count_mismatch'))).toBe(t('signing.downloads.errors.splitFailed'))
    expect(signedDownloadErrorMessage(new Error('network'))).toBe(t('signing.downloads.errors.failed'))
  })
})

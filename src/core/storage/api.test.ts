import { afterEach, describe, expect, it, vi } from 'vitest'
import { FunctionCallError } from '@/core/supabase/functions'
import { forbiddenNameChar } from '../../../supabase/functions/_shared/file-name'
import { registryName, signedFileUrl, uploadFile, UploadSendError } from './api'

const mocks = vi.hoisted(() => {
  const uploadToSignedUrl = vi.fn()
  const from = vi.fn(() => ({ uploadToSignedUrl }))
  return { uploadToSignedUrl, from, invokeFunction: vi.fn() }
})
vi.mock('@/core/supabase/client', () => ({ supabase: { storage: { from: mocks.from } } }))
vi.mock('@/core/supabase/functions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/supabase/functions')>()),
  invokeFunction: mocks.invokeFunction,
}))

afterEach(() => vi.clearAllMocks())

const FILE_ID = '11111111-1111-4111-8111-111111111111'
const PREPARED = { file_id: FILE_ID, bucket: 'org-assets', path: `o1/core/o1/${FILE_ID}.png`, token: 'upload-token' }
const file = () => new File([new Uint8Array([1, 2, 3])], 'logo.jpg', { type: 'image/jpeg' })
const input = (overrides: Partial<Parameters<typeof uploadFile>[0]> = {}) => ({
  purpose: 'org_logo',
  subjectType: 'organization',
  subjectId: 'o1',
  file: file(),
  mimeType: 'image/png',
  ...overrides,
})

/** The function answers in turn: `storage-upload`, then `storage-confirm`. */
function functionsAnswer() {
  mocks.invokeFunction.mockImplementation(async (name: string) => (name === 'storage-upload' ? PREPARED : { file_id: FILE_ID }))
}

describe('uploadFile', () => {
  it('prepares, sends to the signed path on the browser client, then confirms, in that order', async () => {
    functionsAnswer()
    mocks.uploadToSignedUrl.mockResolvedValue({ data: { path: PREPARED.path }, error: null })
    const steps: string[] = []
    const chosen = file()

    await expect(uploadFile(input({ file: chosen, onStep: (s) => steps.push(s) }))).resolves.toEqual({ fileId: FILE_ID })

    expect(mocks.invokeFunction.mock.calls.map(([name]) => name)).toEqual(['storage-upload', 'storage-confirm'])
    expect(mocks.invokeFunction).toHaveBeenNthCalledWith(1, 'storage-upload', {
      purpose: 'org_logo',
      subject_type: 'organization',
      subject_id: 'o1',
      original_name: 'logo.jpg',
      mime_type: 'image/png',
      size_bytes: 3,
    })
    expect(mocks.invokeFunction).toHaveBeenNthCalledWith(2, 'storage-confirm', { file_id: FILE_ID })
    expect(mocks.from).toHaveBeenCalledWith('org-assets')
    // The body carries the declared type (storage records it; storage-confirm compares it), not the name's.
    const [path, token, body, options] = mocks.uploadToSignedUrl.mock.calls[0] ?? []
    expect([path, token]).toEqual([PREPARED.path, 'upload-token'])
    expect(body).toBeInstanceOf(Blob)
    expect((body as Blob).type).toBe('image/png')
    expect((body as Blob).size).toBe(chosen.size)
    expect(options).toEqual({ contentType: 'image/png' })
    expect(steps).toEqual(['preparing', 'sending', 'confirming'])
    const order = [mocks.invokeFunction.mock.invocationCallOrder[0], mocks.uploadToSignedUrl.mock.invocationCallOrder[0], mocks.invokeFunction.mock.invocationCallOrder[1]]
    expect(order).toEqual([...order].sort((a, b) => (a ?? 0) - (b ?? 0)))
  })

  it("declares the browser's type when none is given", async () => {
    functionsAnswer()
    mocks.uploadToSignedUrl.mockResolvedValue({ data: {}, error: null })
    await uploadFile(input({ mimeType: undefined }))
    expect(mocks.invokeFunction).toHaveBeenNthCalledWith(1, 'storage-upload', expect.objectContaining({ mime_type: 'image/jpeg' }))
  })

  it('stops at storage-upload when it refuses: nothing sent, nothing confirmed', async () => {
    const refusal = new FunctionCallError('invalid_request', 400, 'Ce fichier dépasse la taille permise (2 Mo).')
    mocks.invokeFunction.mockRejectedValue(refusal)
    await expect(uploadFile(input())).rejects.toBe(refusal)
    expect(mocks.uploadToSignedUrl).not.toHaveBeenCalled()
    expect(mocks.invokeFunction).toHaveBeenCalledTimes(1)
  })

  it('stops when the upload itself fails: nothing confirmed', async () => {
    functionsAnswer()
    mocks.uploadToSignedUrl.mockResolvedValue({ data: null, error: Object.assign(new Error('The resource already exists'), { status: 409 }) })
    await expect(uploadFile(input())).rejects.toBeInstanceOf(UploadSendError)
    expect(mocks.invokeFunction).toHaveBeenCalledTimes(1)
  })

  it("passes storage-confirm's refusal on", async () => {
    const refusal = new FunctionCallError('invalid_request', 400, "Ce fichier n'est pas du type annoncé.")
    mocks.invokeFunction.mockImplementation(async (name: string) => {
      if (name === 'storage-upload') return PREPARED
      throw refusal
    })
    mocks.uploadToSignedUrl.mockResolvedValue({ data: {}, error: null })
    await expect(uploadFile(input())).rejects.toBe(refusal)
  })

  describe('storage-confirm tried again', () => {
    /** storage-upload answers; storage-confirm fails with each of `failures` in turn, then answers. */
    function confirmFails(...failures: FunctionCallError[]) {
      mocks.invokeFunction.mockImplementation(async (name: string) => {
        if (name === 'storage-upload') return PREPARED
        const failure = failures.shift()
        if (failure) throw failure
        return { file_id: FILE_ID }
      })
      mocks.uploadToSignedUrl.mockResolvedValue({ data: {}, error: null })
    }
    const confirms = () => mocks.invokeFunction.mock.calls.filter(([name]) => name === 'storage-confirm')

    it.each([
      ['the network', new FunctionCallError('network', 0, 'Function unreachable')],
      ['a 500', new FunctionCallError('internal', 500, 'Confirm failed')],
      ['a 503', new FunctionCallError('not_configured', 503, 'Storage unavailable')],
    ])('once after %s (a repeated confirm answers 200): the upload succeeds, sent once', async (_case, failure) => {
      confirmFails(failure)
      await expect(uploadFile(input())).resolves.toEqual({ fileId: FILE_ID })
      expect(confirms()).toEqual([
        ['storage-confirm', { file_id: FILE_ID }],
        ['storage-confirm', { file_id: FILE_ID }],
      ])
      expect(mocks.uploadToSignedUrl).toHaveBeenCalledTimes(1)
    })

    it('only once: a second failure is passed on', async () => {
      const second = new FunctionCallError('internal', 502, 'Bad gateway')
      confirmFails(new FunctionCallError('network', 0, 'Function unreachable'), second)
      await expect(uploadFile(input())).rejects.toBe(second)
      expect(confirms()).toHaveLength(2)
    })

    it.each([
      ['a refusal (400)', new FunctionCallError('invalid_request', 400, "Ce fichier n'est pas du type annoncé.")],
      ['a conflict (409)', new FunctionCallError('conflict', 409, 'Already settled')],
      ['an expired upload (404)', new FunctionCallError('not_found', 404, 'No pending upload')],
      ['a rate limit (429)', new FunctionCallError('rate_limited', 429, 'Too many attempts', {}, 60)],
    ])('never after %s', async (_case, failure) => {
      confirmFails(failure)
      await expect(uploadFile(input())).rejects.toBe(failure)
      expect(confirms()).toHaveLength(1)
    })
  })

  it('refuses an unexpected answer from storage-upload before sending anything', async () => {
    mocks.invokeFunction.mockResolvedValue({ file_id: FILE_ID, bucket: 'org-assets', signed_url: 'http://x' })
    await expect(uploadFile(input())).rejects.toThrow()
    expect(mocks.uploadToSignedUrl).not.toHaveBeenCalled()
  })

  it.each([
    ['a\u202Egnp.exe', 'a_gnp.exe'],
    ['  ', 'fichier'],
    [`${'n'.repeat(250)}.png`, `${'n'.repeat(196)}.png`],
  ])('sends a name the registry accepts (%#)', async (name, sent) => {
    functionsAnswer()
    mocks.uploadToSignedUrl.mockResolvedValue({ data: {}, error: null })
    await uploadFile(input({ file: new File(['x'], name, { type: 'image/png' }) }))
    expect(mocks.invokeFunction).toHaveBeenNthCalledWith(1, 'storage-upload', expect.objectContaining({ original_name: sent }))
  })
})

describe('signedFileUrl', () => {
  it('asks storage-sign for a read URL (never signs one itself)', async () => {
    mocks.invokeFunction.mockResolvedValue({ url: 'http://127.0.0.1:55321/storage/v1/object/sign/x?token=t', expires_at: '2026-10-08T12:05:00.000Z' })
    const signal = new AbortController().signal
    await expect(signedFileUrl(FILE_ID, { signal })).resolves.toEqual({
      url: 'http://127.0.0.1:55321/storage/v1/object/sign/x?token=t',
      expiresAt: '2026-10-08T12:05:00.000Z',
    })
    expect(mocks.invokeFunction).toHaveBeenCalledWith('storage-sign', { file_id: FILE_ID }, { signal })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('asks for a download URL when told to', async () => {
    mocks.invokeFunction.mockResolvedValue({ url: 'https://x.test/a', expires_at: '2026-10-08T12:05:00.000Z' })
    await signedFileUrl(FILE_ID, { download: true })
    expect(mocks.invokeFunction).toHaveBeenCalledWith('storage-sign', { file_id: FILE_ID, download: true }, {})
  })

  it('passes a 404 or a 429 on', async () => {
    const limited = new FunctionCallError('rate_limited', 429, 'Too many attempts', {}, 600)
    mocks.invokeFunction.mockRejectedValue(limited)
    await expect(signedFileUrl(FILE_ID)).rejects.toBe(limited)
  })
})

describe('registryName and storage-upload', () => {
  // The three-way list (browser, function, SQL) is file-name-parity.test.ts; this checks that
  // registryName replaces what the function refuses.
  it("replaces exactly the characters storage-upload refuses (the client's set is the server's)", () => {
    const forbidden = (code: number) => forbiddenNameChar(String.fromCharCode(code))
    const mismatches: string[] = []
    for (let code = 0; code <= 0xffff; code++) {
      const name = `a${String.fromCharCode(code)}b`
      const replaced = registryName(name) !== name
      if (replaced !== forbidden(code)) mismatches.push(`U+${code.toString(16).padStart(4, '0')}`)
    }
    expect(mismatches).toEqual([])
  })
})

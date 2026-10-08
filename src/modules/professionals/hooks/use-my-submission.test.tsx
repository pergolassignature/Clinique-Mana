import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { mySubmission } from '../test/fixtures-questionnaire'
import { setupQueryClient } from '../test/query-client'
import { professionalKeys } from './keys'
import { AUTOSAVE_DELAY_MS, useQuestionnaireAutosave } from './use-my-submission'

const mocks = vi.hoisted(() => ({ saveMySubmissionDraft: vi.fn() }))
vi.mock('../api/self', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/self')>()), saveMySubmissionDraft: mocks.saveMySubmissionDraft }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

/** A promise and its resolvers, to hold a save in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup() {
  const submission = mySubmission({ values: {} })
  const { queryClient, wrapper, invalidated } = setupQueryClient()
  queryClient.setQueryData(professionalKeys.mySubmission(), submission)
  const hook = renderHook(() => useQuestionnaireAutosave(submission), { wrapper })
  return { hook, queryClient, invalidated }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('useQuestionnaireAutosave', () => {
  it('saves a section once, 2.5 s after the last edit, never per keystroke', async () => {
    mocks.saveMySubmissionDraft.mockResolvedValue('2026-10-08T18:32:00+00:00')
    const { hook } = setup()
    let city = 'L'
    const collect = () => ({ city })
    act(() => hook.result.current.schedule('personal', collect))
    await act(() => vi.advanceTimersByTimeAsync(1000))
    city = 'Laval'
    act(() => hook.result.current.schedule('personal', collect))
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1))
    expect(mocks.saveMySubmissionDraft).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(mocks.saveMySubmissionDraft).toHaveBeenCalledTimes(1)
    expect(mocks.saveMySubmissionDraft).toHaveBeenCalledWith('personal', { city: 'Laval' })
    expect(hook.result.current.answered.personal).toEqual({ city: 'Laval' })
    expect(hook.result.current.state).toMatchObject({ saving: false, savedAt: '2026-10-08T18:32:00+00:00', failed: false })
  })

  it('chains the saves of a section: the next one waits, and diffs against what landed', async () => {
    const first = deferred<string>()
    mocks.saveMySubmissionDraft.mockReturnValueOnce(first.promise).mockResolvedValueOnce('2026-10-08T18:33:00+00:00')
    const { hook } = setup()
    let city = 'Laval'
    // Sends only what differs from what the section holds once the previous save has landed.
    const collect = () => (hook.result.current.current('personal').city === city ? null : { city })
    act(() => hook.result.current.schedule('personal', collect))
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS))
    expect(hook.result.current.state.saving).toBe(true)
    city = 'Montréal'
    act(() => hook.result.current.schedule('personal', collect))
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS))
    // Still one call: the second waits for the first.
    expect(mocks.saveMySubmissionDraft).toHaveBeenCalledTimes(1)
    await act(async () => first.resolve('2026-10-08T18:32:00+00:00'))
    expect(mocks.saveMySubmissionDraft).toHaveBeenCalledTimes(2)
    expect(mocks.saveMySubmissionDraft).toHaveBeenNthCalledWith(2, 'personal', { city: 'Montréal' })
    expect(hook.result.current.answered.personal).toEqual({ city: 'Montréal' })
  })

  it('flushes a pending autosave at once', async () => {
    mocks.saveMySubmissionDraft.mockResolvedValue('2026-10-08T18:32:00+00:00')
    const { hook } = setup()
    act(() => hook.result.current.schedule('portrait', () => ({ bio: 'Bonjour' })))
    let outcome: unknown
    await act(async () => {
      outcome = await hook.result.current.flush('portrait')
    })
    expect(outcome).toEqual({ ok: true })
    expect(mocks.saveMySubmissionDraft).toHaveBeenCalledWith('portrait', { bio: 'Bonjour' })
    // The timer no longer fires a second save.
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS))
    expect(mocks.saveMySubmissionDraft).toHaveBeenCalledTimes(1)
  })

  it('shows the failure banner on a network error, and « Réessayer » sends again', async () => {
    mocks.saveMySubmissionDraft.mockRejectedValueOnce({ code: '', message: 'TypeError: Failed to fetch' }).mockResolvedValueOnce('2026-10-08T18:34:00+00:00')
    const { hook } = setup()
    act(() => hook.result.current.schedule('personal', () => ({ city: 'Laval' })))
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS))
    expect(hook.result.current.state.failed).toBe(true)
    act(() => hook.result.current.retry())
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(mocks.saveMySubmissionDraft).toHaveBeenCalledTimes(2)
    expect(hook.result.current.state).toMatchObject({ failed: false, savedAt: '2026-10-08T18:34:00+00:00' })
  })

  it('gives a field refusal to the step, without the banner', async () => {
    const refusal = { code: 'P0001', message: 'Code postal invalide : format A1A 1A1 attendu.', hint: 'postal_code' }
    mocks.saveMySubmissionDraft.mockRejectedValue(refusal)
    const { hook } = setup()
    const handler = vi.fn()
    act(() => void hook.result.current.onRefusal('personal', handler))
    act(() => hook.result.current.schedule('personal', () => ({ postal_code: 'H2X' })))
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS))
    expect(handler).toHaveBeenCalledWith(refusal)
    expect(hook.result.current.state.failed).toBe(false)
    expect(hook.result.current.answered.personal).toBeUndefined()
  })

  it('reloads the submission when it was sent or closed elsewhere', async () => {
    mocks.saveMySubmissionDraft.mockRejectedValue({ code: 'P0001', message: 'Votre profil a déjà été envoyé.', hint: 'submitted' })
    const { hook, invalidated } = setup()
    act(() => hook.result.current.schedule('personal', () => ({ city: 'Laval' })))
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS))
    expect(hook.result.current.state.pageRefusal).toBe('Votre profil a déjà été envoyé.')
    expect(invalidated()).toContainEqual(professionalKeys.mySubmission())
  })

  it('writes each saved section into the cached submission', async () => {
    mocks.saveMySubmissionDraft.mockResolvedValue('2026-10-08T18:35:00+00:00')
    const { hook, queryClient } = setup()
    await act(async () => {
      await hook.result.current.save('languages', { language_ids: ['a'] })
    })
    expect(queryClient.getQueryData(professionalKeys.mySubmission())).toMatchObject({
      values: { languages: { language_ids: ['a'] } },
      updatedAt: '2026-10-08T18:35:00+00:00',
    })
  })
})

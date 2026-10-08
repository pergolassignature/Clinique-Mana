import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { t } from '@/i18n'
import { mySubmission } from '../test/fixtures-questionnaire'
import { setupQueryClient } from '../test/query-client'
import { professionalKeys } from './keys'
import { AUTOSAVE_DELAY_MS, useQuestionnaireAutosave } from './use-my-submission'

const mocks = vi.hoisted(() => ({ saveMySubmissionDraft: vi.fn() }))
vi.mock('../api/self', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/self')>()), saveMySubmissionDraft: mocks.saveMySubmissionDraft }))
const sentry = vi.hoisted(() => ({ captureException: vi.fn() }))
vi.mock('@sentry/react', () => sentry)

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

function setup(options: Parameters<typeof useQuestionnaireAutosave>[1] = {}) {
  const submission = mySubmission({ values: {} })
  const { queryClient, wrapper, invalidated } = setupQueryClient()
  queryClient.setQueryData(professionalKeys.mySubmission(), submission)
  const hook = renderHook(() => useQuestionnaireAutosave(submission, options), { wrapper })
  return { hook, queryClient, invalidated }
}

const POSTAL_REFUSAL = { code: 'P0001', message: 'Code postal invalide : format A1A 1A1 attendu.', hint: 'postal_code' }
const NETWORK = { code: '', message: 'TypeError: Failed to fetch' }

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

  it('reports to the step a refusal of a save it did not start (a flush, not the timer)', async () => {
    mocks.saveMySubmissionDraft.mockRejectedValue(POSTAL_REFUSAL)
    const { hook } = setup()
    const handler = vi.fn()
    act(() => void hook.result.current.onRefusal('personal', handler))
    act(() => hook.result.current.schedule('personal', () => ({ postal_code: 'H2X' })))
    await act(async () => void (await hook.result.current.flushAll()))
    expect(handler).toHaveBeenCalledWith(POSTAL_REFUSAL)
    // Kept per section, with its message, until a save of the section lands.
    expect(hook.result.current.state.refused).toEqual({ personal: POSTAL_REFUSAL.message })
    expect(hook.result.current.refusalOf('personal')).toEqual({ message: POSTAL_REFUSAL.message, error: POSTAL_REFUSAL })
    expect(hook.result.current.problems()).toEqual({ refused: ['personal'], failed: false, closed: false })
    mocks.saveMySubmissionDraft.mockResolvedValue('2026-10-08T18:40:00+00:00')
    // A picker's or a file's save of the section does not fix the step's edits…
    await act(async () => void (await hook.result.current.save('personal', { address_line2: 'App. 2' })))
    expect(hook.result.current.state.refused).toEqual({ personal: POSTAL_REFUSAL.message })
    // … a save of them does.
    act(() => hook.result.current.schedule('personal', () => ({ postal_code: 'H2X 1Y4' })))
    await act(async () => void (await hook.result.current.flush('personal')))
    expect(hook.result.current.state.refused).toEqual({})
  })

  it('leaves the refusal of a picker’s or a file’s own save to its caller', async () => {
    mocks.saveMySubmissionDraft.mockRejectedValue({ code: 'P0001', message: 'Choisissez au moins une langue.', hint: 'language_ids' })
    const { hook } = setup()
    const handler = vi.fn()
    act(() => void hook.result.current.onRefusal('languages', handler))
    let outcome: unknown
    await act(async () => {
      outcome = await hook.result.current.save('languages', { language_ids: [] })
    })
    expect(outcome).toMatchObject({ ok: false })
    expect(handler).not.toHaveBeenCalled()
    expect(hook.result.current.state.refused).toEqual({})
  })

  it('« Réessayer » resends a picker’s save failed in transit, unless a later one of the same kind landed', async () => {
    mocks.saveMySubmissionDraft.mockRejectedValueOnce(NETWORK).mockResolvedValue('2026-10-08T18:43:00+00:00')
    const { hook } = setup()
    await act(async () => void (await hook.result.current.save('languages', { language_ids: ['a'] })))
    expect(hook.result.current.state.failed).toBe(true)
    // A form save of the section does not supersede the picker's…
    act(() => hook.result.current.schedule('languages', () => ({ other: 1 })))
    await act(async () => void (await hook.result.current.flush('languages')))
    expect(hook.result.current.state.failed).toBe(true)
    // … a later picker save does: nothing older is sent again.
    await act(async () => void (await hook.result.current.save('languages', { language_ids: ['b'] })))
    expect(hook.result.current.state.failed).toBe(false)
    act(() => hook.result.current.retry())
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(mocks.saveMySubmissionDraft).toHaveBeenCalledTimes(3)
  })

  it('flush reports only the saves it starts: nothing pending is ok, even after a refused save', async () => {
    mocks.saveMySubmissionDraft.mockRejectedValueOnce({ code: 'P0001', message: 'La photo doit être une image JPEG ou PNG de 5 Mo au plus.', hint: 'file_id' })
    const { hook } = setup()
    let refused: unknown
    await act(async () => {
      refused = await hook.result.current.save('photo', { file_id: 'f1' })
    })
    expect(refused).toMatchObject({ ok: false })
    let outcome: unknown
    await act(async () => {
      outcome = await hook.result.current.flush('photo')
    })
    expect(outcome).toEqual({ ok: true })
    let all: unknown
    await act(async () => {
      all = await hook.result.current.flushAll()
    })
    expect(all).toBe(true)
    expect(mocks.saveMySubmissionDraft).toHaveBeenCalledTimes(1)
  })

  it('a refusal replaces an earlier failure in transit: the banner goes, « Réessayer » sends nothing', async () => {
    mocks.saveMySubmissionDraft.mockRejectedValueOnce(NETWORK).mockRejectedValueOnce(POSTAL_REFUSAL)
    const { hook } = setup()
    act(() => hook.result.current.schedule('personal', () => ({ city: 'Laval' })))
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS))
    expect(hook.result.current.state).toMatchObject({ failed: true, refused: {} })
    act(() => hook.result.current.schedule('personal', () => ({ city: 'Laval', postal_code: 'H2X' })))
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS))
    expect(hook.result.current.state).toMatchObject({ failed: false, refused: { personal: POSTAL_REFUSAL.message } })
    act(() => hook.result.current.retry())
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(mocks.saveMySubmissionDraft).toHaveBeenCalledTimes(2)
  })

  it('« Réessayer » resends only failures in transit; any other failure is kept with its step and reported (code only)', async () => {
    mocks.saveMySubmissionDraft
      .mockRejectedValueOnce(NETWORK)
      .mockRejectedValueOnce({ code: '22023', message: 'Valeur invalide pour 4567.' })
      .mockResolvedValue('2026-10-08T18:41:00+00:00')
    const { hook } = setup()
    act(() => hook.result.current.schedule('personal', () => ({ city: 'Laval' })))
    act(() => hook.result.current.schedule('portrait', () => ({ bio: 'Bonjour' })))
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS))
    expect(hook.result.current.state.failed).toBe(true)
    expect(hook.result.current.state.refused).toEqual({ portrait: t('modules.professionals.questionnaire.autosave.notSaved') })
    const [report, context] = sentry.captureException.mock.calls[0] as [Error, { tags: Record<string, string>; extra: Record<string, string> }]
    expect(report.name).toBe('RpcError 22023')
    expect(report.message).toBe('save_my_submission_draft failed')
    expect(context.extra).toEqual({ submission_id: mySubmission().id })
    act(() => hook.result.current.retry())
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(mocks.saveMySubmissionDraft).toHaveBeenCalledTimes(3)
    expect(mocks.saveMySubmissionDraft).toHaveBeenLastCalledWith('personal', { city: 'Laval' })
    expect(hook.result.current.state).toMatchObject({ failed: false, refused: { portrait: expect.any(String) } })
  })

  it('drops a refusal once the step shows what the section holds (nothing left to send)', async () => {
    mocks.saveMySubmissionDraft.mockRejectedValueOnce(POSTAL_REFUSAL)
    const { hook } = setup()
    act(() => hook.result.current.schedule('personal', () => ({ postal_code: 'H2X' })))
    await act(async () => void (await hook.result.current.flush('personal')))
    expect(hook.result.current.state.refused).toHaveProperty('personal')
    act(() => hook.result.current.schedule('personal', () => null))
    await act(async () => void (await hook.result.current.flush('personal')))
    expect(hook.result.current.state.refused).toEqual({})
  })

  it('tells the page when the questionnaire was closed under it', async () => {
    mocks.saveMySubmissionDraft.mockRejectedValue({ code: 'P0001', message: 'Aucun questionnaire à compléter.', hint: 'submission' })
    const onPageRefusal = vi.fn()
    const { hook } = setup({ onPageRefusal })
    act(() => hook.result.current.schedule('personal', () => ({ city: 'Laval' })))
    await act(async () => void (await hook.result.current.flushAll()))
    expect(onPageRefusal).toHaveBeenCalledWith('submission', 'Aucun questionnaire à compléter.')
    expect(hook.result.current.problems()).toEqual({ refused: [], failed: false, closed: true })
  })

  it('sends what is pending when the page unmounts', async () => {
    mocks.saveMySubmissionDraft.mockResolvedValue('2026-10-08T18:42:00+00:00')
    const { hook } = setup()
    act(() => hook.result.current.schedule('portrait', () => ({ bio: 'Bonjour' })))
    hook.unmount()
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.saveMySubmissionDraft).toHaveBeenCalledWith('portrait', { bio: 'Bonjour' })
  })
})

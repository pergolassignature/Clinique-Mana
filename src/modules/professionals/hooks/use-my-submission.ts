import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Sentry from '@sentry/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { moduleErrorMessage, rpcErrorCode, rpcErrorHint } from '@/core/modules/errors'
import {
  fetchMyProfessionalPrivate,
  fetchMySubmission,
  saveMySubmissionDraft,
  saveMySubmissionPrivate,
  submitMyProfile,
  type MySubmission,
  type SectionValues,
  type SubmissionPrivateInput,
} from '../api/self'
import { effectiveSection, type SubmissionSection } from '../lib/questionnaire'
import { professionalKeys } from './keys'

/** The open submission of the signed-in professional (null: nothing to complete). */
export function useMySubmission() {
  return useQuery({ queryKey: professionalKeys.mySubmission(), queryFn: fetchMySubmission })
}

/** The private data the record already holds (masks and plain numbers), read only for the « Fiscalité et banque » step. */
export function useMyProfessionalPrivate(enabled: boolean) {
  return useQuery({ queryKey: professionalKeys.myPrivate(), queryFn: fetchMyProfessionalPrivate, enabled })
}

/**
 * « Fiscalité et banque »: the private step, encrypted by the database. It carries a SIN or an
 * account number: never kept by React Query (`gcTime: 0`, CLAUDE.md §8). Refetches the
 * submission (masks, `private_saved_at`) and the record's masks.
 */
export function useSaveMyPrivate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SubmissionPrivateInput) => saveMySubmissionPrivate(input),
    gcTime: 0,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: professionalKeys.mySubmission() }),
        queryClient.invalidateQueries({ queryKey: professionalKeys.myPrivate() }),
      ]),
  })
}

/** « Envoyer mon profil » (`professionals-submit`); the submission is refetched (now `submitted`). */
export function useSubmitMyProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => submitMyProfile(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: professionalKeys.mySubmission() }),
  })
}

/** One server save per section this long after the last edit (security review of 4b.1: never per keystroke). */
export const AUTOSAVE_DELAY_MS = 2500

/** What a save resolved with: the caller shows a refusal (P0001) under its field. */
export type SaveOutcome = { ok: true } | { ok: false; error: unknown }

/** Reads the fields to send now (only those changed, P4-176), or null when there is nothing to send. */
export type Collect = () => Record<string, unknown> | null

/**
 * Refusals that say the questionnaire itself changed under the page (sent from another tab,
 * closed by the clinic, file deactivated): the page reloads the submission instead of a field error.
 */
const PAGE_HINTS: ReadonlySet<string> = new Set(['submitted', 'submission', 'status'])

/** A P0001 refusal (the database's French message, the field as HINT). */
export const isRefusal = (error: unknown) => rpcErrorCode(error) === 'P0001'

/**
 * A failure that may succeed when sent again: no SQLSTATE (the network, a gateway's page), a lost
 * connection (`08…`), a statement timeout, a serialization failure or a deadlock. Only these get
 * « Réessayer »; anything else is shown with its step, like a refusal.
 */
export function isTransient(error: unknown): boolean {
  const code = rpcErrorCode(error)
  return code === undefined || code === '' || code.startsWith('08') || code === '57014' || code === '40001' || code === '40P01'
}

/**
 * Reports a failed questionnaire RPC that is neither a refusal, a permission change nor the
 * network: the RPC's name, the SQLSTATE and the submission's id only (never a message, a HINT or a
 * value: the private step's errors could echo one).
 */
export function reportQuestionnaireError(rpc: string, error: unknown, submissionId: string) {
  const code = rpcErrorCode(error)
  if (code === 'P0001' || code === '42501' || code === undefined || code === '') return
  const report = new Error(`${rpc} failed`)
  report.name = `RpcError ${code}`
  Sentry.captureException(report, { tags: { area: 'professionals', code }, extra: { submission_id: submissionId } })
}

/**
 * The French text of a failed save: a refusal's own message, the connection text for a transient
 * failure, the permission text, else a plain « not saved » (reported by whoever got the error).
 */
export function saveErrorText(error: unknown): string {
  if (isRefusal(error)) return moduleErrorMessage(error, t('modules.professionals.questionnaire.autosave.notSaved'))
  if (isTransient(error)) return t('modules.professionals.questionnaire.autosave.failed')
  if (rpcErrorCode(error) === '42501') return t('common.errors.forbidden')
  return t('modules.professionals.questionnaire.autosave.notSaved')
}

/** A section whose last save did not land for a reason other than the network: shown until one does. */
export interface SectionRefusal {
  message: string
  error: unknown
}

/**
 * Where a save comes from: the step's form (its edits stay in the form until saved) or an explicit
 * save (a picker's « Enregistrer », a file, « Retirer »: the caller shows its outcome, and the step
 * then shows what the section holds).
 */
type SaveKind = 'form' | 'explicit'

interface SectionQueue {
  timer: ReturnType<typeof setTimeout> | null
  /** The pending autosave, read when its turn comes (so it diffs against the save before it). */
  collect: Collect | null
  /** Saves of this section run one after the other (an older payload never lands last); never rejects. */
  chain: Promise<unknown>
  /**
   * The last save of each kind that failed in transit (`isTransient`): « Réessayer » sends it again.
   * A later save of the same kind supersedes it (landed or refused); the other kind's never does.
   */
  failed: Partial<Record<SaveKind, Collect>>
}

const hasFailed = (q: SectionQueue) => q.failed.form !== undefined || q.failed.explicit !== undefined

export interface AutosaveState {
  /** A save is in flight. */
  saving: boolean
  /** An edit waits for its autosave delay (not sent yet): closing the tab now asks first. */
  scheduled: boolean
  /** The submission's `updated_at` after the last save (« Enregistré à 14:32 »). */
  savedAt: string | null
  /** A save failed in transit: the banner with « Réessayer ». */
  failed: boolean
  /** The sections whose last save was refused (or failed otherwise than in transit), with the reason. */
  refused: Readonly<Partial<Record<SubmissionSection, string>>>
  /** A page-level refusal (`PAGE_HINTS`): its French message. */
  pageRefusal: string | null
}

/** What « Envoyer mon profil » checks once everything pending has been sent. */
export interface AutosaveProblems {
  refused: SubmissionSection[]
  failed: boolean
  /** The questionnaire changed under the page (sent elsewhere, closed, file inactive). */
  closed: boolean
}

export interface QuestionnaireAutosave {
  /** The answers saved so far, by section (re-rendered after each save). */
  answered: Readonly<Record<string, SectionValues>>
  /** What a section shows now: prefill overlaid with the answers saved (the latest, even mid-render). */
  current: (section: SubmissionSection) => SectionValues
  /** The answers saved for a section, or undefined (never saved). */
  answeredOf: (section: SubmissionSection) => SectionValues | undefined
  /** A step's form values kept while the provider moves between steps (memory only, D4). */
  draft: <T>(section: SubmissionSection) => T | undefined
  setDraft: (section: SubmissionSection, values: unknown) => void
  /** Debounced autosave of a section: `collect` runs AUTOSAVE_DELAY_MS after the last call. */
  schedule: (section: SubmissionSection, collect: Collect) => void
  /**
   * Sends the section's pending autosave now and resolves with that save's outcome once it has
   * landed; with nothing pending, `{ ok: true }` once the saves in flight have settled (their own
   * outcome is reported where it belongs: the step, the page's alert, the banner).
   */
  flush: (section: SubmissionSection) => Promise<SaveOutcome>
  /** Flushes every section; true when none of the saves it started failed. */
  flushAll: () => Promise<boolean>
  /**
   * Saves these fields now, after whatever is queued for the section (pickers, files). The caller
   * shows its refusal (the sheet, the dropzone): the step then shows what the section holds, so it
   * is not kept as the section's « refusé » state.
   */
  save: (section: SubmissionSection, values: Record<string, unknown>) => Promise<SaveOutcome>
  /**
   * « Continuer »: replaces the section's pending autosave with `collect`, read once the saves in
   * flight have landed (one request, the smallest diff).
   */
  confirm: (section: SubmissionSection, collect: Collect) => Promise<SaveOutcome>
  /** Records answers saved by another RPC (the consent signature). */
  recordAnswer: (section: SubmissionSection, values: Record<string, unknown>) => void
  /** A step's handler for its refusals, whatever started the save (P0001 with the field as HINT). */
  onRefusal: (section: SubmissionSection, handler: (error: unknown) => void) => () => void
  /** The section's standing refusal, if any (a step shows it again when it opens). */
  refusalOf: (section: SubmissionSection) => SectionRefusal | undefined
  /** The standing problems, read when needed (not a render value). */
  problems: () => AutosaveProblems
  /**
   * A page-level refusal (`PAGE_HINTS`) met by another RPC (private step, consent, « Envoyer »):
   * shown and the submission reloaded. True when the hint was one of them.
   */
  pageRefusal: (hint: string | undefined, message: string) => boolean
  /** « Réessayer »: sends again the saves that failed in transit, only those. */
  retry: () => void
  state: AutosaveState
}

const OK: SaveOutcome = { ok: true }

interface AutosaveOptions {
  /** The questionnaire was closed or sent elsewhere (`PAGE_HINTS`): the page explains it once reloaded. */
  onPageRefusal?: (hint: string, message: string) => void
}

/**
 * The questionnaire's server autosave (4b.4, security review of 4b.1): per section, one debounced
 * save 2.5 s after the last edit, chained (at most one in flight; the next one computes its fields
 * once the previous one has landed), sending only the fields changed since what the section holds.
 * Pickers and files save at once through the same chain. No copy anywhere but memory (D4).
 *
 * Whatever started a save of a step's edits (the timer, the step leaving, the page hidden or left,
 * « Enregistrer le brouillon », a picker or a file saving after them), its outcome is kept per
 * section: a refusal (or any failure other than the network's) stays as the section's « refusé »
 * state until a save of those edits lands or the step shows what the section holds, and goes to the
 * step's handler when it is open; a failure in transit shows the banner until « Réessayer » or a
 * later save of the same kind lands. A refusal replaces the earlier transit failure of its kind.
 */
export function useQuestionnaireAutosave(submission: MySubmission, options: AutosaveOptions = {}): QuestionnaireAutosave {
  const queryClient = useQueryClient()
  const answeredRef = useRef<Record<string, SectionValues>>({ ...submission.values })
  const [answered, setAnswered] = useState<Readonly<Record<string, SectionValues>>>(answeredRef.current)
  const queues = useRef(new Map<SubmissionSection, SectionQueue>())
  const listeners = useRef(new Map<SubmissionSection, (error: unknown) => void>())
  const drafts = useRef(new Map<SubmissionSection, unknown>())
  const refusals = useRef(new Map<SubmissionSection, SectionRefusal>())
  const closed = useRef(false)
  const inFlight = useRef(0)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const [state, setState] = useState<AutosaveState>(() => ({
    saving: false,
    scheduled: false,
    savedAt: Object.keys(submission.values).length > 0 ? submission.updatedAt : null,
    failed: false,
    refused: {},
    pageRefusal: null,
  }))
  // The prefill never changes for a submission; a refetch (after the private step) must not
  // renew `current`, which every step's effect depends on.
  const prefill = useRef(submission.prefill).current

  const queue = useCallback((section: SubmissionSection): SectionQueue => {
    let q = queues.current.get(section)
    if (!q) {
      q = { timer: null, collect: null, chain: Promise.resolve(), failed: {} }
      queues.current.set(section, q)
    }
    return q
  }, [])

  /** The banner and the refusals as the queues now hold them. */
  const sync = useCallback(() => {
    const failed = [...queues.current.values()].some(hasFailed)
    const refused = Object.fromEntries([...refusals.current].map(([section, r]) => [section, r.message])) as AutosaveState['refused']
    setState((s) => ({ ...s, failed, refused }))
  }, [])

  const recordAnswer = useCallback(
    (section: SubmissionSection, values: Record<string, unknown>, updatedAt?: string) => {
      answeredRef.current = { ...answeredRef.current, [section]: { ...(answeredRef.current[section] ?? {}), ...values } }
      const next = answeredRef.current
      setAnswered(next)
      // The cache follows, so a return to the page starts from what is saved.
      queryClient.setQueryData<MySubmission | null>(professionalKeys.mySubmission(), (old) =>
        old && old.id === submission.id ? { ...old, values: next, ...(updatedAt && { updatedAt }) } : old,
      )
    },
    [queryClient, submission.id],
  )

  const pageRefusal = useCallback(
    (hint: string | undefined, message: string) => {
      if (!hint || !PAGE_HINTS.has(hint)) return false
      closed.current = true
      setState((s) => ({ ...s, pageRefusal: message }))
      optionsRef.current.onPageRefusal?.(hint, message)
      void queryClient.invalidateQueries({ queryKey: professionalKeys.mySubmission() })
      return true
    },
    [queryClient],
  )

  const send = useCallback(
    async (section: SubmissionSection, values: Record<string, unknown>, collect: Collect, kind: SaveKind): Promise<SaveOutcome> => {
      inFlight.current += 1
      setState((s) => ({ ...s, saving: true }))
      const q = queue(section)
      try {
        const updatedAt = await saveMySubmissionDraft(section, values)
        recordAnswer(section, values, updatedAt)
        delete q.failed[kind]
        if (kind === 'form') refusals.current.delete(section)
        setState((s) => ({ ...s, savedAt: updatedAt }))
        return OK
      } catch (error) {
        if (isRefusal(error) && pageRefusal(rpcErrorHint(error), moduleErrorMessage(error, ''))) return { ok: false, error }
        if (isTransient(error)) {
          q.failed[kind] = collect
        } else {
          // A refusal (or a failure that sending again would not fix) replaces the transit failure.
          reportQuestionnaireError('save_my_submission_draft', error, submission.id)
          delete q.failed[kind]
          if (kind === 'form') {
            refusals.current.set(section, { message: saveErrorText(error), error })
            listeners.current.get(section)?.(error)
          }
        }
        return { ok: false, error }
      } finally {
        sync()
        inFlight.current -= 1
        if (inFlight.current === 0) setState((s) => ({ ...s, saving: false }))
      }
    },
    [pageRefusal, queue, recordAnswer, submission.id, sync],
  )

  /** Appends `collect` to the section's chain; the outcome of this save only. */
  const enqueue = useCallback(
    (section: SubmissionSection, collect: Collect, kind: SaveKind): Promise<SaveOutcome> => {
      const q = queue(section)
      const outcome = q.chain.then(async () => {
        // Null: nothing to send. An empty object is sent (availability saved once, P4-330).
        const values = collect()
        if (values) return send(section, values, collect, kind)
        // What the step shows is what the section holds: an earlier refusal no longer applies.
        if (kind === 'form' && refusals.current.delete(section)) sync()
        return OK
      })
      q.chain = outcome
      return outcome
    },
    [queue, send, sync],
  )

  /** Sends the section's pending collect, if any (else waits for what is in flight, then OK). */
  const run = useCallback(
    (section: SubmissionSection): Promise<SaveOutcome> => {
      const q = queue(section)
      if (q.timer !== null) clearTimeout(q.timer)
      q.timer = null
      if (![...queues.current.values()].some((other) => other.timer !== null)) setState((st) => (st.scheduled ? { ...st, scheduled: false } : st))
      const collect = q.collect
      q.collect = null
      return collect ? enqueue(section, collect, 'form') : q.chain.then(() => OK)
    },
    [enqueue, queue],
  )

  const schedule = useCallback(
    (section: SubmissionSection, collect: Collect) => {
      const q = queue(section)
      q.collect = collect
      if (q.timer !== null) clearTimeout(q.timer)
      q.timer = setTimeout(() => void run(section), AUTOSAVE_DELAY_MS)
      setState((st) => (st.scheduled ? st : { ...st, scheduled: true }))
    },
    [queue, run],
  )

  const flush = useCallback((section: SubmissionSection) => run(section), [run])

  const flushAll = useCallback(async () => {
    const outcomes = await Promise.all([...queues.current.keys()].map((section) => run(section)))
    return outcomes.every((o) => o.ok)
  }, [run])

  const save = useCallback(
    (section: SubmissionSection, values: Record<string, unknown>) => {
      // The step's pending edits go first: they were made before.
      void run(section)
      return enqueue(section, () => values, 'explicit')
    },
    [enqueue, run],
  )

  const confirm = useCallback(
    (section: SubmissionSection, collect: Collect) => {
      queue(section).collect = collect
      return run(section)
    },
    [queue, run],
  )

  const retry = useCallback(() => {
    for (const [section, q] of queues.current) {
      const failed = q.failed
      q.failed = {}
      // The step's edits first, as they were made before a picker's or a file's save.
      if (failed.form) void enqueue(section, failed.form, 'form')
      if (failed.explicit) void enqueue(section, failed.explicit, 'explicit')
    }
    sync()
  }, [enqueue, sync])

  const onRefusal = useCallback((section: SubmissionSection, handler: (error: unknown) => void) => {
    listeners.current.set(section, handler)
    return () => {
      if (listeners.current.get(section) === handler) listeners.current.delete(section)
    }
  }, [])

  const refusalOf = useCallback((section: SubmissionSection) => refusals.current.get(section), [])
  const problems = useCallback(
    (): AutosaveProblems => ({
      refused: [...refusals.current.keys()],
      failed: [...queues.current.values()].some(hasFailed),
      closed: closed.current,
    }),
    [],
  )

  // Leaving the page sends what is pending (a step also flushes when it unmounts).
  useEffect(() => {
    const pending = queues.current
    return () => {
      for (const [section, q] of pending) if (q.timer !== null || q.collect) void run(section)
    }
  }, [run])

  const current = useCallback((section: SubmissionSection) => effectiveSection(prefill, answeredRef.current, section), [prefill])
  const answeredOf = useCallback((section: SubmissionSection) => answeredRef.current[section], [])
  const draft = useCallback(<T>(section: SubmissionSection) => drafts.current.get(section) as T | undefined, [])
  const setDraft = useCallback((section: SubmissionSection, values: unknown) => void drafts.current.set(section, values), [])
  const record = useCallback((section: SubmissionSection, values: Record<string, unknown>) => recordAnswer(section, values), [recordAnswer])

  // Every function is stable: a step subscribes once (its effect must not re-run, and flush, on each save).
  return useMemo(
    () => ({
      answered,
      current,
      answeredOf,
      draft,
      setDraft,
      schedule,
      flush,
      flushAll,
      save,
      confirm,
      recordAnswer: record,
      onRefusal,
      refusalOf,
      problems,
      pageRefusal,
      retry,
      state,
    }),
    [answered, current, answeredOf, draft, setDraft, schedule, flush, flushAll, save, confirm, record, onRefusal, refusalOf, problems, pageRefusal, retry, state],
  )
}

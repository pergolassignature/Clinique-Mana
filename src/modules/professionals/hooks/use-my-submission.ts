import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { moduleErrorMessage, rpcErrorCode, rpcErrorHint } from '@/core/modules/errors'
import {
  fetchMyProfessionalPrivate,
  fetchMySubmission,
  saveMySubmissionDraft,
  saveMySubmissionPrivate,
  signMyConsent,
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

/** « Consentement »: the signature; the submission is refetched for the server's time. */
export function useSignMyConsent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ versionId, signerName }: { versionId: string; signerName: string }) => signMyConsent(versionId, signerName),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: professionalKeys.mySubmission() }),
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

interface SectionQueue {
  timer: ReturnType<typeof setTimeout> | null
  /** The pending autosave, read when its turn comes (so it diffs against the save before it). */
  collect: Collect | null
  /** Saves of this section run one after the other: an older payload never lands last. */
  chain: Promise<SaveOutcome>
  /** The last save that failed for a reason other than a refusal (« Réessayer » runs it again). */
  failed: Collect | null
}

export interface AutosaveState {
  /** A save is in flight. */
  saving: boolean
  /** The submission's `updated_at` after the last save (« Enregistré à 14:32 »). */
  savedAt: string | null
  /** A save failed (network, server): the banner with « Réessayer ». */
  failed: boolean
  /** A page-level refusal (`PAGE_HINTS`): its French message. */
  pageRefusal: string | null
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
  /** Runs the section's pending autosave now; resolves once everything queued for it has settled. */
  flush: (section: SubmissionSection) => Promise<SaveOutcome>
  /** Flushes every section; true when nothing failed. */
  flushAll: () => Promise<boolean>
  /** Saves these fields now, after whatever is queued for the section (pickers, files). */
  save: (section: SubmissionSection, values: Record<string, unknown>) => Promise<SaveOutcome>
  /**
   * « Continuer »: replaces the section's pending autosave with `collect`, read once the saves in
   * flight have landed (one request, the smallest diff).
   */
  confirm: (section: SubmissionSection, collect: Collect) => Promise<SaveOutcome>
  /** Records answers saved by another RPC (the consent signature). */
  recordAnswer: (section: SubmissionSection, values: Record<string, unknown>) => void
  /** A step's handler for its autosave refusals (P0001 with the field as HINT). */
  onRefusal: (section: SubmissionSection, handler: (error: unknown) => void) => () => void
  retry: () => void
  state: AutosaveState
}

const OK: SaveOutcome = { ok: true }

/**
 * The questionnaire's server autosave (4b.4, security review of 4b.1): per section, one debounced
 * save 2.5 s after the last edit, chained (at most one in flight; the next one computes its fields
 * once the previous one has landed), sending only the fields changed since what the section holds.
 * Pickers and files save at once through the same chain. No copy anywhere but memory (D4).
 * A refusal goes to the step's handler; any other failure shows the banner until « Réessayer ».
 */
export function useQuestionnaireAutosave(submission: MySubmission): QuestionnaireAutosave {
  const queryClient = useQueryClient()
  const answeredRef = useRef<Record<string, SectionValues>>({ ...submission.values })
  const [answered, setAnswered] = useState<Readonly<Record<string, SectionValues>>>(answeredRef.current)
  const queues = useRef(new Map<SubmissionSection, SectionQueue>())
  const listeners = useRef(new Map<SubmissionSection, (error: unknown) => void>())
  const drafts = useRef(new Map<SubmissionSection, unknown>())
  const inFlight = useRef(0)
  const [state, setState] = useState<AutosaveState>(() => ({
    saving: false,
    savedAt: Object.keys(submission.values).length > 0 ? submission.updatedAt : null,
    failed: false,
    pageRefusal: null,
  }))
  // The prefill never changes for a submission; a refetch (after the private step) must not
  // renew `current`, which every step's effect depends on.
  const prefill = useRef(submission.prefill).current

  const queue = useCallback((section: SubmissionSection): SectionQueue => {
    let q = queues.current.get(section)
    if (!q) {
      q = { timer: null, collect: null, chain: Promise.resolve(OK), failed: null }
      queues.current.set(section, q)
    }
    return q
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

  const send = useCallback(
    async (section: SubmissionSection, values: Record<string, unknown>, collect: Collect): Promise<SaveOutcome> => {
      inFlight.current += 1
      setState((s) => ({ ...s, saving: true }))
      try {
        const updatedAt = await saveMySubmissionDraft(section, values)
        recordAnswer(section, values, updatedAt)
        queue(section).failed = null
        const failed = [...queues.current.values()].some((q) => q.failed !== null)
        setState((s) => ({ ...s, savedAt: updatedAt, failed }))
        return OK
      } catch (error) {
        if (isRefusal(error)) {
          const hint = rpcErrorHint(error)
          if (hint && PAGE_HINTS.has(hint)) {
            setState((s) => ({ ...s, pageRefusal: moduleErrorMessage(error, '') }))
            void queryClient.invalidateQueries({ queryKey: professionalKeys.mySubmission() })
          }
        } else {
          // Reported (no value: the message only); the banner says it in plain words.
          moduleErrorMessage(error, '', 'professionals')
          queue(section).failed = collect
          setState((s) => ({ ...s, failed: true }))
        }
        return { ok: false, error }
      } finally {
        inFlight.current -= 1
        if (inFlight.current === 0) setState((s) => ({ ...s, saving: false }))
      }
    },
    [queryClient, queue, recordAnswer],
  )

  /** Appends the pending collect to the section's chain; resolves when the chain has settled. */
  const run = useCallback(
    (section: SubmissionSection, fromTimer: boolean): Promise<SaveOutcome> => {
      const q = queue(section)
      if (q.timer !== null) clearTimeout(q.timer)
      q.timer = null
      const collect = q.collect
      q.collect = null
      if (collect) {
        q.chain = q.chain.then(async () => {
          // Null: nothing to send. An empty object is sent (availability saved once, P4-330).
          const values = collect()
          if (!values) return OK
          const outcome = await send(section, values, collect)
          if (!outcome.ok && fromTimer && isRefusal(outcome.error)) listeners.current.get(section)?.(outcome.error)
          return outcome
        })
      }
      return q.chain
    },
    [queue, send],
  )

  const schedule = useCallback(
    (section: SubmissionSection, collect: Collect) => {
      const q = queue(section)
      q.collect = collect
      if (q.timer !== null) clearTimeout(q.timer)
      q.timer = setTimeout(() => void run(section, true), AUTOSAVE_DELAY_MS)
    },
    [queue, run],
  )

  const flush = useCallback((section: SubmissionSection) => run(section, false), [run])

  const flushAll = useCallback(async () => {
    const outcomes = await Promise.all([...queues.current.keys()].map((section) => run(section, false)))
    return outcomes.every((o) => o.ok)
  }, [run])

  const save = useCallback(
    (section: SubmissionSection, values: Record<string, unknown>) => {
      void run(section, false)
      const q = queue(section)
      const collect: Collect = () => values
      q.chain = q.chain.then(() => send(section, values, collect))
      return q.chain
    },
    [queue, run, send],
  )

  const confirm = useCallback(
    (section: SubmissionSection, collect: Collect) => {
      const q = queue(section)
      if (q.timer !== null) clearTimeout(q.timer)
      q.timer = null
      q.collect = collect
      return run(section, false)
    },
    [queue, run],
  )

  const retry = useCallback(() => {
    for (const [section, q] of queues.current) {
      if (!q.failed) continue
      q.collect = q.failed
      q.failed = null
      void run(section, true)
    }
    setState((s) => ({ ...s, failed: false }))
  }, [run])

  const onRefusal = useCallback((section: SubmissionSection, handler: (error: unknown) => void) => {
    listeners.current.set(section, handler)
    return () => {
      if (listeners.current.get(section) === handler) listeners.current.delete(section)
    }
  }, [])

  // Leaving the page sends what is pending (a step also flushes when it unmounts).
  useEffect(() => {
    const pending = queues.current
    return () => {
      for (const [section, q] of pending) if (q.timer !== null || q.collect) void run(section, false)
    }
  }, [run])

  const current = useCallback((section: SubmissionSection) => effectiveSection(prefill, answeredRef.current, section), [prefill])
  const answeredOf = useCallback((section: SubmissionSection) => answeredRef.current[section], [])
  const draft = useCallback(<T>(section: SubmissionSection) => drafts.current.get(section) as T | undefined, [])
  const setDraft = useCallback((section: SubmissionSection, values: unknown) => void drafts.current.set(section, values), [])
  const record = useCallback((section: SubmissionSection, values: Record<string, unknown>) => recordAnswer(section, values), [recordAnswer])

  // Every function is stable: a step subscribes once (its effect must not re-run, and flush, on each save).
  return useMemo(
    () => ({ answered, current, answeredOf, draft, setDraft, schedule, flush, flushAll, save, confirm, recordAnswer: record, onRefusal, retry, state }),
    [answered, current, answeredOf, draft, setDraft, schedule, flush, flushAll, save, confirm, record, onRefusal, retry, state],
  )
}

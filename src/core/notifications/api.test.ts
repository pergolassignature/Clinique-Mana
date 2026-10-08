import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  IMPORTANT_NOTICES_LIMIT,
  NOTIFICATIONS_PAGE_SIZE,
  countMyUnreadNotifications,
  listImportantUnreadNotifications,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
} from './api'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }))

afterEach(() => vi.clearAllMocks())

const NOTICE = {
  id: 'a0000000-0000-0000-0000-000000000001',
  module_key: 'professionals',
  kind: 'professionals.insurance_expiring',
  importance: 'important',
  title: 'Assurance de Sophie Lavoie',
  body: "L'assurance responsabilité expire le 19 octobre.",
  link_path: '/professionnels/b0000000-0000-0000-0000-000000000001',
  subject_type: 'professional',
  subject_id: 'b0000000-0000-0000-0000-000000000001',
  created_at: '2026-10-08T12:07:00+00:00',
  is_read: false,
}

describe('countMyUnreadNotifications', () => {
  it('reads the one row of the RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ total: 3, important: 1 }], error: null })
    await expect(countMyUnreadNotifications()).resolves.toEqual({ total: 3, important: 1 })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('count_my_unread_notifications')
  })

  it('counts nothing when the RPC returns no row', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await expect(countMyUnreadNotifications()).resolves.toEqual({ total: 0, important: 0 })
  })

  it('throws the RPC error', async () => {
    const error = { code: '42501', message: 'permission denied' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(countMyUnreadNotifications()).rejects.toBe(error)
  })
})

describe('listMyNotifications', () => {
  it('asks for the newest page, plus one row to know whether more follow', async () => {
    mocks.rpc.mockResolvedValue({ data: [NOTICE], error: null })
    await expect(listMyNotifications(null)).resolves.toEqual({ notices: [NOTICE], hasMore: false })
    expect(NOTIFICATIONS_PAGE_SIZE).toBe(20)
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('list_my_notifications', { p_limit: 21 })
  })

  it('a full page and no extra row: nothing more', async () => {
    const page = Array.from({ length: 20 }, (_, i) => ({ ...NOTICE, id: `id-${i}` }))
    mocks.rpc.mockResolvedValue({ data: page, error: null })
    await expect(listMyNotifications(null)).resolves.toEqual({ notices: page, hasMore: false })
  })

  it('the extra row says more follow, and is dropped', async () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({ ...NOTICE, id: `id-${i}` }))
    mocks.rpc.mockResolvedValue({ data: rows, error: null })
    await expect(listMyNotifications(null)).resolves.toEqual({ notices: rows.slice(0, 20), hasMore: true })
  })

  it('pages on the last row seen: both cursor fields, always', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await listMyNotifications({ before: NOTICE.created_at, beforeId: NOTICE.id })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('list_my_notifications', {
      p_limit: 21,
      p_before: NOTICE.created_at,
      p_before_id: NOTICE.id,
    })
  })

  it('accepts a notice without body, link or subject', async () => {
    const bare = { ...NOTICE, body: null, link_path: null, subject_type: null, subject_id: null, importance: 'normal', is_read: true }
    mocks.rpc.mockResolvedValue({ data: [bare], error: null })
    await expect(listMyNotifications(null)).resolves.toEqual({ notices: [bare], hasMore: false })
  })

  it('throws the RPC error', async () => {
    const error = { code: '22023', message: 'cursor' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(listMyNotifications(null)).rejects.toBe(error)
  })
})

describe('listImportantUnreadNotifications', () => {
  it('asks for at most 5 important unread notices', async () => {
    mocks.rpc.mockResolvedValue({ data: [NOTICE], error: null })
    await expect(listImportantUnreadNotifications()).resolves.toEqual([NOTICE])
    expect(IMPORTANT_NOTICES_LIMIT).toBe(5)
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('list_my_notifications', {
      p_importance: 'important',
      p_unread_only: true,
      p_limit: 5,
    })
  })
})

describe('markNotificationsRead / markAllNotificationsRead', () => {
  it('mark some, then all', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await markNotificationsRead([NOTICE.id])
    await markAllNotificationsRead()
    expect(mocks.rpc.mock.calls).toEqual([
      ['mark_notifications_read', { p_ids: [NOTICE.id] }],
      ['mark_all_notifications_read'],
    ])
  })

  it('throw the RPC error', async () => {
    const error = { code: '22023', message: 'too many' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(markNotificationsRead([NOTICE.id])).rejects.toBe(error)
    await expect(markAllNotificationsRead()).rejects.toBe(error)
  })
})

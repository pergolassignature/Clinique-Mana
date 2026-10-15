import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useServerDraft } from './use-server-draft'

interface Row {
  key: string
  id?: string
  name: string
}

function start<T>(server: T) {
  return renderHook(({ value }: { value: T }) => useServerDraft<T>(value), {
    initialProps: { value: server },
  })
}

describe('useServerDraft', () => {
  it('a foreign change while clean is adopted silently', () => {
    const { result, rerender } = start({ name: 'A' })
    rerender({ value: { name: 'B' } })
    expect(result.current.values).toEqual({ name: 'B' })
    expect(result.current.dirty).toBe(false)
    expect(result.current.stale).toBe(false)
  })

  it('a foreign change while dirty shows the stale notice and keeps the edits', () => {
    const { result, rerender } = start({ name: 'A' })
    act(() => result.current.setValues({ name: 'Mine' }))
    rerender({ value: { name: 'Theirs' } })
    expect(result.current.stale).toBe(true)
    expect(result.current.values).toEqual({ name: 'Mine' })
    act(() => result.current.reload())
    expect(result.current.values).toEqual({ name: 'Theirs' })
    expect(result.current.stale).toBe(false)
  })

  it("the person's own edit come back (equal to the draft) is adopted: clean, never stale", () => {
    const { result, rerender } = start({ name: 'A' })
    act(() => result.current.setValues({ name: 'Mine' }))
    rerender({ value: { name: 'Mine' } })
    expect(result.current.stale).toBe(false)
    expect(result.current.dirty).toBe(false)
  })

  it('a save then the refetch: no stale notice', () => {
    const { result, rerender } = start({ name: 'A', note: '' })
    act(() => result.current.setValues({ name: 'Mine', note: ' ' }))
    act(() => result.current.commit())
    // The server normalised the note: not equal to the draft, but it is the save come back.
    rerender({ value: { name: 'Mine', note: '' } })
    expect(result.current.stale).toBe(false)
    expect(result.current.dirty).toBe(false)
    expect(result.current.values).toEqual({ name: 'Mine', note: '' })
  })

  it('a save with a newly added row: no stale notice, the row now has its id', () => {
    const { result, rerender } = start<Row[]>([{ key: 'p1', id: 'p1', name: 'Alice' }])
    act(() => result.current.setValues((prev) => [...prev, { key: 'new-1', name: 'Léo' }]))
    act(() => result.current.commit())
    rerender({
      value: [
        { key: 'p1', id: 'p1', name: 'Alice' },
        { key: 'p2', id: 'p2', name: 'Léo' },
      ],
    })
    expect(result.current.stale).toBe(false)
    expect(result.current.dirty).toBe(false)
    expect(result.current.values[1]).toEqual({
      key: 'p2',
      id: 'p2',
      name: 'Léo',
    })
  })

  it("the refetch arrives before the save's callback: the commit adopts it then", () => {
    const { result, rerender } = start({ rows: ['a'] })
    act(() => result.current.setValues({ rows: ['a', 'new'] }))
    rerender({ value: { rows: ['a', 'b'] } })
    act(() => result.current.commit())
    expect(result.current.stale).toBe(false)
    expect(result.current.values).toEqual({ rows: ['a', 'b'] })
  })

  it('typed more after the save: the base moves, her new edits stay', () => {
    const { result, rerender } = start({ name: 'A' })
    act(() => result.current.setValues({ name: 'Mine' }))
    act(() => result.current.commit())
    act(() => result.current.setValues({ name: 'Mine again' }))
    rerender({ value: { name: 'Mine' } })
    expect(result.current.stale).toBe(false)
    expect(result.current.base).toEqual({ name: 'Mine' })
    expect(result.current.values).toEqual({ name: 'Mine again' })
    expect(result.current.dirty).toBe(true)
    // A later foreign change is a real conflict again.
    rerender({ value: { name: 'Theirs' } })
    expect(result.current.stale).toBe(true)
  })
})

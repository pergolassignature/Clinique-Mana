import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { testAccess } from '@/test/contexts'
import { AccessContext, useAccess, useReadyAccess, type AccessContextValue } from './access-context'

function wrapperFor(overrides: Partial<AccessContextValue>) {
  const value: AccessContextValue = {
    status: 'ready',
    access: testAccess,
    problem: null,
    can: () => false,
    reload: () => {},
    isReloading: false,
    ...overrides,
  }
  return ({ children }: { children: ReactNode }) => <AccessContext.Provider value={value}>{children}</AccessContext.Provider>
}

/** renderHook rethrows render errors; silence React's error log for the expected throws. */
function expectHookToThrow(hook: () => unknown, wrapper?: ReturnType<typeof wrapperFor>) {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(() => renderHook(hook, { wrapper })).toThrow()
  error.mockRestore()
}

describe('useReadyAccess', () => {
  it('returns the access when ready', () => {
    const { result } = renderHook(() => useReadyAccess(), { wrapper: wrapperFor({}) })
    expect(result.current).toBe(testAccess)
  })

  it.each(['idle', 'loading', 'denied', 'error'] as const)('throws when the status is %s', (status) => {
    expectHookToThrow(() => useReadyAccess(), wrapperFor({ status }))
  })

  it('throws when ready without access', () => {
    expectHookToThrow(() => useReadyAccess(), wrapperFor({ access: null }))
  })
})

describe('useAccess', () => {
  it('throws outside AccessProvider', () => {
    expectHookToThrow(() => useAccess())
  })
})

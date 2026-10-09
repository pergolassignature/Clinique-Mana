import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { Storage } from 'happy-dom'
import { afterEach } from 'vitest'
import { setFrenchSpacing } from '@/i18n'

// Node 25 ships a global `localStorage` that is a method-less stub unless --localstorage-file
// is set, and it shadows happy-dom's. Install real (in-memory) Web Storage for the tests.
for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (typeof globalThis[name]?.setItem !== 'function') {
    Object.defineProperty(globalThis, name, { value: new Storage(), configurable: true, writable: true })
  }
}

// French spacing (U+202F before « ? ! ; : », inside « ») is off in tests: Testing Library turns it
// into a plain space in the DOM text but not in the expected string (see `setFrenchSpacing`).
// src/i18n/index.test.ts turns it on to test it.
setFrenchSpacing(false)

afterEach(() => cleanup())

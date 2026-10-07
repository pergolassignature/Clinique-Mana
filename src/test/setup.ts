import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { Storage } from 'happy-dom'
import { afterEach } from 'vitest'

// Node 25 ships a global `localStorage` that is a method-less stub unless --localstorage-file
// is set, and it shadows happy-dom's. Install real (in-memory) Web Storage for the tests.
for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (typeof globalThis[name]?.setItem !== 'function') {
    Object.defineProperty(globalThis, name, { value: new Storage(), configurable: true, writable: true })
  }
}

afterEach(() => cleanup())

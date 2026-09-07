import { afterEach, expect, it, vi } from 'vitest'
import { readBrowserPreference, writeBrowserPreference } from './browser-preferences'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

it('reads and writes optional preferences', () => {
  writeBrowserPreference('theme', 'dark')
  expect(readBrowserPreference('theme')).toBe('dark')
})

it.each(['SecurityError', 'QuotaExceededError'])('does not make optional preferences fatal for %s', (name) => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('storage unavailable', name)
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('storage unavailable', name)
  })
  expect(readBrowserPreference('theme')).toBeNull()
  expect(() => writeBrowserPreference('theme', 'dark')).not.toThrow()
})

it.each([
  new Error('unexpected bug'),
  new DOMException('unexpected storage failure', 'InvalidStateError'),
])('preserves unexpected read and write failures: %s', (error) => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw error
  })
  expect(() => readBrowserPreference('theme')).toThrow(error)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw error
  })
  expect(() => writeBrowserPreference('theme', 'dark')).toThrow(error)
})

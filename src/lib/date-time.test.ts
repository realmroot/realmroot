import { describe, expect, it } from 'vitest'
import { toLocalDateTimeValue } from './date-time'

describe('toLocalDateTimeValue', () => {
  it('formats the local calendar fields expected by datetime-local inputs', () => {
    expect(toLocalDateTimeValue(new Date(2026, 7, 1, 18, 5))).toBe('2026-08-01T18:05')
  })
})

import { hostedCustomCssSchema } from '@shared/api/configz'
import { describe, expect, it } from 'vitest'

describe('configz API schemas', () => {
  it('accepts only constrained hosted auth custom CSS declarations', () => {
    expect(hostedCustomCssSchema.parse('--auth-panel-radius: 8px; --auth-title-color: #111827;')).toBe(
      '--auth-panel-radius: 8px; --auth-title-color: #111827;',
    )
    expect(hostedCustomCssSchema.parse('')).toBe('')
    expect(() => hostedCustomCssSchema.parse('.authPanel { color: red; }')).toThrow()
    expect(() => hostedCustomCssSchema.parse('--auth-bg: url(https://evil.example/x.png);')).toThrow()
    expect(() => hostedCustomCssSchema.parse('@import "https://evil.example/x.css";')).toThrow()
    expect(() => hostedCustomCssSchema.parse('--other-token: red;')).toThrow()
  })
})

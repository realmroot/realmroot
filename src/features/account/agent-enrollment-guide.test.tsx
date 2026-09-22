import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentEnrollmentGuide } from './agent-enrollment-guide'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('shows self-enrollment instructions without creating an Agent [spec: account-center/account-section-routes]', () => {
  const fetch = vi.spyOn(window, 'fetch')
  render(<AgentEnrollmentGuide />)
  fireEvent.click(screen.getByRole('button', { name: 'How to enroll an Agent' }))
  expect(screen.getByRole('dialog', { name: 'Let your Agent enroll itself' })).toBeTruthy()
  const prompt = screen.getByRole('textbox', { name: 'Enrollment prompt' }) as HTMLTextAreaElement
  expect(prompt.value).toContain('/.well-known/agent-skills/index.json')
  expect(prompt.value).toContain('from your own environment')
  expect(prompt.readOnly).toBe(true)
  expect(fetch).not.toHaveBeenCalled()
})

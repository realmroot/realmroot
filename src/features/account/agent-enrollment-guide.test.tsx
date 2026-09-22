import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentEnrollmentGuide } from './agent-enrollment-guide'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('copies the current deployment instructions and resets confirmation when reopened', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  render(<AgentEnrollmentGuide />)
  fireEvent.click(screen.getByRole('button', { name: 'How to enroll an Agent' }))
  const instructions = (screen.getByRole('textbox', { name: 'Enrollment prompt' }) as HTMLTextAreaElement).value
  fireEvent.click(screen.getByRole('button', { name: 'Copy instructions' }))
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy()
  expect(writeText).toHaveBeenCalledWith(instructions)
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: 'How to enroll an Agent' }))
  expect(screen.getByRole('button', { name: 'Copy instructions' })).toBeTruthy()
})

it('keeps instructions selectable when clipboard access fails and allows retry', async () => {
  const writeText = vi.fn().mockRejectedValueOnce(new Error('Clipboard denied')).mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  render(<AgentEnrollmentGuide />)
  fireEvent.click(screen.getByRole('button', { name: 'How to enroll an Agent' }))
  fireEvent.click(screen.getByRole('button', { name: 'Copy instructions' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Unable to copy.')
  expect(screen.getByRole('textbox', { name: 'Enrollment prompt' })).toBeTruthy()
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: 'How to enroll an Agent' }))
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Copy instructions' }))
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy()
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

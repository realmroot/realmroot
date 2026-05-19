import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminShell } from './admin-shell'

let pathname = '/admin'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className, to }: { children: ReactNode; className?: string; to: string }) => (
    <a className={className} href={to}>
      {children}
    </a>
  ),
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => string }) =>
    select({ location: { pathname } }),
}))

afterEach(() => {
  cleanup()
  pathname = '/admin'
})

describe('AdminShell', () => {
  it('renders admin navigation and marks the exact dashboard route active', () => {
    render(<AdminShell>Dashboard content</AdminShell>)

    expect(screen.getAllByText('Admin console')).toHaveLength(2)
    expect(screen.getByText('Dashboard content')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Dashboard/ }).className).toContain('bg-muted')
    expect(screen.getByRole('link', { name: /Applications/ }).className).not.toContain('bg-muted')
    expect(screen.queryByRole('link', { name: /Onboarding/ })).toBeNull()
  })

  it('marks nested admin navigation sections active', () => {
    pathname = '/admin/applications/app-1'

    render(<AdminShell>Application details</AdminShell>)

    expect(screen.getByRole('link', { name: /Applications/ }).className).toContain('bg-muted')
    expect(screen.getByRole('link', { name: /Dashboard/ }).className).not.toContain('bg-muted')
  })
})

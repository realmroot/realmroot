import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UserDetailPage } from '@/features/console/extracted/users/user-detail'
import {
  consolePasskey,
  consoleSession,
  jsonResponse,
  pagination,
  profile,
  renderWithQuery,
  securityPolicy,
} from './console.test-utils'

globalThis.ResizeObserver ??= class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const personalAgent = {
  id: 'agent-personal',
  issuer: 'https://identity.example.com',
  subject: 'agt_personal',
  name: 'Personal Agent',
  homeSpace: { type: 'personal', userId: 'user-1' },
  owner: { id: 'user-1', type: 'user', displayName: 'Jane Stone' },
  status: 'active',
  retiredAt: null,
  installationCount: 1,
  pendingRequestCount: 0,
  activeGrantCount: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
}

describe('admin console user detail lifecycle', () => {
  it('operates populated authentication, sessions, Agents, apps, and account settings', async () => {
    const requests: Array<{ method: string; url: string; body?: unknown }> = []
    let currentUser = {
      ...profile,
      role: 'user',
      banned: false,
      banReason: null as string | null,
      banExpires: null as string | null,
    }
    let sessions = [
      {
        ...consoleSession,
        id: 'session-1',
        userAgent: 'Mozilla/5.0 (Mac OS X) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
        activeOrganizationId: 'org-1',
      },
      {
        ...consoleSession,
        id: 'session-2',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/140.0',
        activeOrganizationId: null,
      },
      {
        ...consoleSession,
        id: 'session-3',
        userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0 Edg/140.0',
        activeOrganizationId: null,
      },
      {
        ...consoleSession,
        id: 'session-4',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Safari/605.1.15',
        activeOrganizationId: null,
      },
    ]
    let passkeys = [consolePasskey]
    let accessGrants = [
      {
        id: 'usg-1',
        userId: 'user-1',
        organizationId: null,
        resourceServerId: 'resource-1',
        scopes: ['projects:admin'],
        status: 'active',
        grantedByUserId: 'admin-1',
        expiresAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        links: { self: '/api/users/user-1/scope-grants/usg-1', resourceServer: '/api/resource-servers/resource-1' },
      },
    ]
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input).split('?')[0]!
      const method = init?.method ?? 'GET'
      if (url === '/api/users/user-1' && method === 'GET') return Promise.resolve(jsonResponse({ user: currentUser }))
      if (url === '/api/users/user-1/sessions' && method === 'GET') {
        return Promise.resolve(jsonResponse({ sessions, pagination: { ...pagination, total: sessions.length } }))
      }
      if (url === '/api/users/user-1/sessions/session-1' && method === 'DELETE') {
        requests.push({ method, url })
        sessions = sessions.filter((session) => session.id !== 'session-1')
        return Promise.resolve(jsonResponse({ success: true }))
      }
      if (url === '/api/users/user-1/sessions' && method === 'DELETE') {
        requests.push({ method, url })
        sessions = []
        return Promise.resolve(jsonResponse({ success: true }))
      }
      if (url === '/api/users/user-1/linked-accounts') {
        return Promise.resolve(
          jsonResponse({
            accounts: [
              { id: 'account-1', accountId: 'user-1', providerId: 'credential', createdAt: '2026-01-01T00:00:00.000Z' },
              { id: 'account-2', accountId: 'octocat', providerId: 'github', createdAt: '2026-01-02T00:00:00.000Z' },
            ],
            pagination,
          }),
        )
      }
      if (url.startsWith('/api/access/consents')) {
        return Promise.resolve(
          jsonResponse({
            authorizations: [
              {
                id: 'consent-1',
                applicationId: 'app-1',
                user: { id: 'user-1', email: profile.email, displayName: profile.displayName },
                scopes: ['openid', 'profile'],
                grantedAt: '2026-01-01T00:00:00.000Z',
                expiresAt: null,
                revokedAt: null,
                status: 'active',
              },
              {
                id: 'consent-2',
                applicationId: 'app-2',
                user: { id: 'user-1', email: profile.email, displayName: profile.displayName },
                scopes: ['openid'],
                grantedAt: '2026-01-02T00:00:00.000Z',
                expiresAt: '2027-01-01T00:00:00.000Z',
                revokedAt: null,
                status: 'active',
              },
            ],
            pagination,
          }),
        )
      }
      if (url === '/api/applications' || url.startsWith('/api/applications?')) {
        return Promise.resolve(
          jsonResponse({
            applications: [
              { id: 'app-1', name: 'Customer portal', slug: 'customer-portal' },
              { id: 'app-2', name: 'Reports', slug: 'reports' },
            ],
            pagination,
          }),
        )
      }
      if (url === '/api/realm/security-policy') return Promise.resolve(jsonResponse(securityPolicy))
      if (url === '/api/users/user-1/security') {
        return Promise.resolve(
          jsonResponse({
            security: {
              userId: 'user-1',
              mfa: { enabled: true, factors: [{ id: 'factor-1', type: 'totp', verified: true }] },
              passkeys: { enabled: true, count: passkeys.length },
              policy: { mfa: { mode: 'required' }, passkeys: { enabled: true, rpName: 'Realmroot' } },
            },
          }),
        )
      }
      if (url === '/api/users/user-1/passkeys/passkey-1' && method === 'DELETE') {
        requests.push({ method, url })
        passkeys = []
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/users/user-1/passkeys') {
        return Promise.resolve(jsonResponse({ passkeys, pagination: { ...pagination, total: passkeys.length } }))
      }
      if (url === '/api/agents') {
        return Promise.resolve(
          jsonResponse({
            items: [
              personalAgent,
              {
                ...personalAgent,
                id: 'agent-org',
                name: 'Organization Agent',
                homeSpace: { type: 'organization', organizationId: 'org-1' },
              },
            ],
            pagination,
          }),
        )
      }
      if (url === '/api/resource-servers') {
        return Promise.resolve(jsonResponse({ items: [assignedResource], pagination }))
      }
      if (url === '/api/users/user-1/scope-grants' && method === 'GET') {
        return Promise.resolve(
          jsonResponse({ items: accessGrants, pagination: { ...pagination, total: accessGrants.length } }),
        )
      }
      if (url === '/api/users/user-1/scope-grants' && method === 'POST') {
        const body = JSON.parse(String(init?.body))
        accessGrants = [
          {
            id: 'usg-2',
            userId: 'user-1',
            organizationId: null,
            resourceServerId: body.resourceServerId,
            scopes: body.scopes,
            status: 'active',
            grantedByUserId: 'admin-1',
            expiresAt: body.expiresAt,
            createdAt: '2026-01-02T00:00:00.000Z',
            links: {
              self: '/api/users/user-1/scope-grants/usg-2',
              resourceServer: '/api/resource-servers/resource-1',
            },
          },
        ]
        return Promise.resolve(jsonResponse(accessGrants[0], 201))
      }
      if (url === '/api/users/user-1/scope-grants/usg-1' && method === 'DELETE') {
        accessGrants = []
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/users/user-1/password-reset-requests' && method === 'POST') {
        requests.push({ method, url })
        return Promise.resolve(jsonResponse({ status: true }))
      }
      if (url === '/api/users/user-1/suspension' && method === 'PUT') {
        const body = JSON.parse(String(init?.body))
        requests.push({ method, url, body })
        currentUser = { ...currentUser, banned: true, banReason: body.reason }
        return Promise.resolve(jsonResponse({ user: currentUser }))
      }
      throw new Error(`Unexpected request: ${method} ${url}`)
    })

    renderWithQuery(<UserDetailPage userId="user-1" />)

    expect(await screen.findByRole('heading', { name: 'Jane Stone' })).toBeTruthy()
    expect(screen.getAllByText('2', { selector: '.detailFlatRow > span' }).length).toBeGreaterThan(0)

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Authentication' }), { button: 0, ctrlKey: false })
    expect(await screen.findByText('Enrolled factors')).toBeTruthy()
    expect(screen.getByText('Backed up')).toBeTruthy()
    expect(screen.getByText('Local password credential')).toBeTruthy()
    expect(screen.getByText('github')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete MacBook Touch ID' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete passkey' }))
    expect(await screen.findByText('No passkeys')).toBeTruthy()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Sessions' }), { button: 0, ctrlKey: false })
    expect(await screen.findByText('Chrome · macOS')).toBeTruthy()
    expect(screen.getByText('Firefox · Windows')).toBeTruthy()
    expect(screen.getByText('Microsoft Edge · Android')).toBeTruthy()
    expect(screen.getByText('Safari · iOS')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Revoke Chrome · macOS' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Revoke session' }))
    await waitFor(() => expect(screen.queryByText('Chrome · macOS')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Revoke all sessions' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Revoke sessions' }))
    expect(await screen.findByText('No active sessions')).toBeTruthy()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Access grants' }), { button: 0, ctrlKey: false })
    expect(await screen.findByText('Projects API')).toBeTruthy()
    expect(screen.getByText('projects:admin')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Revoke access grant' }))
    expect(await screen.findByText('No access grants')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add access grant' }))
    const grantDialog = await screen.findByRole('dialog')
    fireEvent.click(within(grantDialog).getByRole('checkbox', { name: /projects:admin/ }))
    fireEvent.click(within(grantDialog).getByRole('button', { name: 'Add access grant' }))
    expect(await screen.findByText('projects:admin')).toBeTruthy()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Agents' }), { button: 0, ctrlKey: false })
    expect(await screen.findByText('Personal Agent')).toBeTruthy()
    expect(screen.queryByText('Organization Agent')).toBeNull()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Authorized apps' }), { button: 0, ctrlKey: false })
    expect(await screen.findByText('Customer portal')).toBeTruthy()
    expect(screen.getByText('Reports')).toBeTruthy()
    expect(screen.getByText('Never')).toBeTruthy()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Settings' }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('button', { name: 'Send password reset' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Send password reset' }))
    await waitFor(() =>
      expect(requests).toContainEqual({ method: 'POST', url: '/api/users/user-1/password-reset-requests' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Ban user' }))
    fireEvent.change(await screen.findByLabelText('Reason'), { target: { value: 'Policy violation' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ban user' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        method: 'PUT',
        url: '/api/users/user-1/suspension',
        body: { reason: 'Policy violation' },
      }),
    )
  })
})

const assignedResource = {
  id: 'resource-1',
  identifier: 'projects',
  name: 'Projects API',
  resourceUrl: 'https://api.example.com',
  connectorId: null,
  authorizationDetails: [],
  description: null,
  enabled: true,
  ownerOrganizationId: 'org-1',
  visibility: 'public',
  scopeRegistry: {
    discovery: {
      sourceUrl: 'https://api.example.com/openapi.json',
      etag: null,
      documentHash: 'hash',
      syncedAt: '2026-01-01T00:00:00.000Z',
      lastError: null,
    },
    scopes: [{ value: 'projects:admin', description: 'Manage projects', grantMode: 'assigned' }],
  },
  availableToAgents: true,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

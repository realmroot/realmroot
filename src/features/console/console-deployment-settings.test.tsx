import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from '@/features/console/extracted/deployment-misc/deployment'
import { queryClient } from '@/router'
import {
  consoleSharedFetch,
  emailSettings,
  generalSettings,
  jsonResponse,
  organization,
  pagination,
  renderWithQuery,
  user,
} from './console.test-utils'

globalThis.ResizeObserver ??= class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}
Element.prototype.scrollIntoView ??= () => {}

function requestDetails(input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request ? input : null
  const url = new URL(request?.url ?? String(input), 'https://realmroot.test')
  return {
    body: request?.body ? request.clone().json() : Promise.resolve(init?.body ? JSON.parse(String(init.body)) : null),
    cache: request?.cache ?? init?.cache ?? 'default',
    headers: request?.headers ?? new Headers(init?.headers),
    method: request?.method ?? init?.method ?? 'GET',
    path: url.pathname,
  }
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  queryClient.setDefaultOptions({})
  vi.restoreAllMocks()
})

describe('deployment settings operations', () => {
  it('persists Organization creation without exposing obsolete Organization Console controls', async () => {
    const writes: Array<{ body: unknown; path: string }> = []
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestDetails(input, init)
      if (request.path === '/api/organizations') {
        return jsonResponse({ items: [organization], pagination })
      }
      if (request.path === '/api/users') return jsonResponse({ items: [user], pagination })
      if (request.path === '/api/realm/organization-creation-policy' && request.method === 'PUT') {
        const body = await request.body
        writes.push({ path: request.path, body })
        return jsonResponse(body, 200, { ETag: '"organization-creation-v2"' })
      }
      if (request.path === '/api/realm/developer-console-access-policy' && request.method === 'PUT') {
        const body = await request.body
        writes.push({ path: request.path, body })
        return jsonResponse(body, 200, { ETag: '"developer-console-v2"' })
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<SettingsPage section="developer" />)
    expect(await screen.findByText('Organization creation')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Discard' })).toHaveProperty('disabled', true)
    fireEvent.change(await screen.findByLabelText('Organization creation'), {
      target: { value: 'Approved users' },
    })
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', false)
    fireEvent.click(await screen.findByRole('combobox', { name: 'Approved users' }))
    fireEvent.click(await screen.findByRole('option', { name: /Jane Doe/ }))
    expect(screen.getByText('Realm platform administrators only')).toBeTruthy()
    expect(screen.queryByLabelText('Console access')).toBeNull()
    expect(screen.queryByLabelText('Eligible access levels')).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Selected organizations' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(writes).toHaveLength(2))
    expect(writes).toEqual([
      {
        path: '/api/realm/organization-creation-policy',
        body: { mode: 'approved_users', approvedUserIds: ['user-1'] },
      },
      {
        path: '/api/realm/developer-console-access-policy',
        body: {
          mode: 'realm_operators',
          eligibleAccessLevels: ['owner', 'admin'],
          selectedOrganizationIds: [],
        },
      },
    ])
    expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0)
  })

  it('shows deployment fallbacks and prevents enabling email without a binding', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = requestDetails(input, init)
      if (request.path === '/api/realm/email-delivery-configuration') {
        if (request.method === 'PUT') {
          return request.body.then((body) =>
            jsonResponse({ ...(body as object), bindingAvailable: false, source: 'database' }, 200, {
              ETag: '"email-db"',
            }),
          )
        }
        return Promise.resolve(
          jsonResponse(
            {
              ...emailSettings,
              bindingAvailable: false,
              enabled: false,
              fromName: null,
              fromEmail: null,
              replyToEmail: null,
              source: 'environment',
            },
            200,
            { ETag: '"email-env"' },
          ),
        )
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<SettingsPage section="email" />)
    expect(await screen.findByText('Binding unavailable')).toBeTruthy()
    expect(screen.getByText('Deployment fallback')).toBeTruthy()
    expect(await screen.findByRole('switch', { name: 'Email delivery' })).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('Sender address'), { target: { value: 'sender@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Configure email delivery' })).toBeNull())
  })

  it('[spec: admin-console/admin-email-delivery-settings] refreshes a stale Email version and retries a safe save', async () => {
    let reads = 0
    const readCaches: Array<RequestCache | undefined> = []
    const ifMatches: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestDetails(input, init)
      if (request.path === '/api/realm/email-delivery-configuration') {
        if (request.method === 'GET') {
          reads += 1
          readCaches.push(request.cache)
          return jsonResponse(emailSettings, 200, { ETag: reads === 1 ? 'W/"email-v1"' : '"email-v2"' })
        }
        ifMatches.push(request.headers.get('If-Match') ?? '')
        if (ifMatches.length === 1) {
          return jsonResponse(
            {
              error: {
                code: 'precondition_failed',
                message: 'Email delivery configuration changed after it was read.',
              },
            },
            412,
          )
        }
        return jsonResponse({ ...(await request.body), bindingAvailable: true, source: 'database' }, 200, {
          ETag: '"email-v3"',
        })
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<SettingsPage section="email" />)
    fireEvent.change(await screen.findByLabelText('Sender address'), { target: { value: 'auth@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(ifMatches).toEqual(['W/"email-v1"', '"email-v2"']))
    expect(readCaches).toEqual(['no-store', 'no-store'])
    expect(screen.getByLabelText('Sender address')).toHaveProperty('value', 'auth@example.com')
    expect(screen.queryByText('Versioned resource response did not include an ETag.')).toBeNull()
  })

  it('does not retry a stale Email save after another administrator changes editable settings', async () => {
    let reads = 0
    let writes = 0
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestDetails(input, init)
      if (request.path === '/api/realm/email-delivery-configuration') {
        if (request.method === 'GET') {
          reads += 1
          return jsonResponse(
            reads === 1 ? emailSettings : { ...emailSettings, fromEmail: 'other-admin@example.com' },
            200,
            { ETag: reads === 1 ? '"email-v1"' : '"email-v2"' },
          )
        }
        writes += 1
        return jsonResponse(
          {
            error: { code: 'precondition_failed', message: 'Email delivery configuration changed after it was read.' },
          },
          412,
        )
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<SettingsPage section="email" />)
    fireEvent.change(await screen.findByLabelText('Sender address'), { target: { value: 'auth@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Email delivery configuration changed after it was read.')).toBeTruthy()
    expect(writes).toBe(1)
    expect(screen.getByLabelText('Sender address')).toHaveProperty('value', 'auth@example.com')
  })

  it('renders approved-user fallback labels while keeping Console access read-only', async () => {
    const nameOnlyOrganization = { ...organization, displayName: null, name: 'Acme Legal' }
    const displayNameUser = { ...user, displayName: 'Jane Display' }
    let emptySelections = false
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestDetails(input, init)
      if (request.path === '/api/organizations') {
        return jsonResponse({ items: [nameOnlyOrganization], pagination })
      }
      if (request.path === '/api/users') return jsonResponse({ items: [displayNameUser], pagination })
      if (request.path === '/api/realm/organization-creation-policy') {
        if (request.method === 'PUT') return jsonResponse(await request.body, 200, { ETag: '"org-policy-v2"' })
        return jsonResponse(
          { mode: 'approved_users', approvedUserIds: [emptySelections ? 'missing-user' : 'user-1'] },
          200,
          { ETag: '"org-policy-v1"' },
        )
      }
      if (request.path === '/api/realm/developer-console-access-policy') {
        if (request.method === 'PUT') return jsonResponse(await request.body, 200, { ETag: '"console-policy-v2"' })
        return jsonResponse(
          {
            mode: 'selected_organizations',
            eligibleAccessLevels: ['owner'],
            selectedOrganizationIds: [emptySelections ? 'missing-org' : 'org-1'],
          },
          200,
          { ETag: '"console-policy-v1"' },
        )
      }
      return consoleSharedFetch(input, init)
    })

    const { unmount } = renderWithQuery(<SettingsPage section="developer" />)
    expect(await screen.findByText('Realm platform administrators only')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Approved users' }).textContent).toContain('Jane Display')
    fireEvent.change(await screen.findByLabelText('Organization creation'), {
      target: { value: 'Any verified user' },
    })
    expect(screen.queryByRole('combobox', { name: 'Approved users' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Selected organizations' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    unmount()
    emptySelections = true
    queryClient.clear()
    renderWithQuery(<SettingsPage section="developer" />)
    expect(await screen.findByText('missing-user')).toBeTruthy()
    expect(screen.queryByText('missing-org')).toBeNull()
  })

  it('retries all settings resources after a failed query and keeps General editing inline', async () => {
    let realmAttempts = 0
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = requestDetails(input, init)
      if (request.path === '/api/realm') {
        realmAttempts += 1
        return Promise.resolve(
          realmAttempts === 1
            ? jsonResponse({ error: 'Settings unavailable.' }, 503, { ETag: '"realm-error"' })
            : jsonResponse(generalSettings, 200, { ETag: '"realm-v1"' }),
        )
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<SettingsPage />)
    expect(await screen.findByText('Settings unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(generalSettings.issuer)).toBeTruthy()
    expect(realmAttempts).toBeGreaterThanOrEqual(2)
    expect(await screen.findByLabelText('Realm name')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Realm name'), { target: { value: 'Unsaved name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByLabelText('Realm name')).toHaveProperty('value', generalSettings.name)
  })
})

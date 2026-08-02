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
  it('persists independent Organization creation and Console access policies', async () => {
    const writes: Array<{ body: unknown; path: string }> = []
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestDetails(input, init)
      if (request.path === '/api/organizations') {
        return jsonResponse({ organizations: [organization], pagination })
      }
      if (request.path === '/api/users') return jsonResponse({ users: [user], pagination })
      if (request.path === '/api/organization-creation-policy' && request.method === 'PUT') {
        const body = await request.body
        writes.push({ path: request.path, body })
        return jsonResponse(body, 200, { ETag: '"organization-creation-v2"' })
      }
      if (request.path === '/api/developer-console-access-policy' && request.method === 'PUT') {
        const body = await request.body
        writes.push({ path: request.path, body })
        return jsonResponse(body, 200, { ETag: '"developer-console-v2"' })
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<SettingsPage section="developer" />)
    expect(await screen.findByText('Organization creation')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit policy' }))
    fireEvent.change(await screen.findByLabelText('Organization creation'), {
      target: { value: 'Approved users' },
    })
    fireEvent.click(await screen.findByRole('combobox', { name: 'Approved users' }))
    fireEvent.click(await screen.findByRole('option', { name: /Jane Doe/ }))
    fireEvent.change(screen.getByLabelText('Console access'), { target: { value: 'Selected organizations' } })
    fireEvent.click(await screen.findByRole('combobox', { name: 'Selected organizations' }))
    fireEvent.click(await screen.findByRole('option', { name: /Acme Inc/ }))
    fireEvent.change(screen.getByLabelText('Eligible access levels'), {
      target: { value: 'Owner, Administrator, Developer' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(writes).toHaveLength(2))
    expect(writes).toEqual([
      {
        path: '/api/organization-creation-policy',
        body: { mode: 'approved_users', approvedUserIds: ['user-1'] },
      },
      {
        path: '/api/developer-console-access-policy',
        body: {
          mode: 'selected_organizations',
          eligibleAccessLevels: ['owner', 'admin', 'developer'],
          selectedOrganizationIds: ['org-1'],
        },
      },
    ])
    expect((await screen.findAllByText('Selected organizations')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Acme Inc.').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0)
  })

  it('shows deployment fallbacks and prevents enabling email without a binding', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = requestDetails(input, init)
      if (request.path === '/api/email-delivery-configuration') {
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
    expect(screen.getByText('Not configured')).toBeTruthy()
    expect(screen.getByText('Uses sender address')).toBeTruthy()
    expect(screen.getByText('Deployment fallback')).toBeTruthy()
    expect(screen.getAllByText('Unavailable')).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }))
    expect(await screen.findByRole('switch', { name: 'Email delivery' })).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('Sender address'), { target: { value: 'sender@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Configure email delivery' })).toBeNull())
  })

  it('renders selected policy members with fallback labels and saves the owner-only policy variants', async () => {
    const nameOnlyOrganization = { ...organization, displayName: null, name: 'Acme Legal' }
    const displayNameUser = { ...user, displayName: 'Jane Display' }
    let emptySelections = false
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = requestDetails(input, init)
      if (request.path === '/api/organizations') {
        return jsonResponse({ organizations: [nameOnlyOrganization], pagination })
      }
      if (request.path === '/api/users') return jsonResponse({ users: [displayNameUser], pagination })
      if (request.path === '/api/organization-creation-policy') {
        if (request.method === 'PUT') return jsonResponse(await request.body, 200, { ETag: '"org-policy-v2"' })
        return jsonResponse(
          { mode: 'approved_users', approvedUserIds: [emptySelections ? 'missing-user' : 'user-1'] },
          200,
          { ETag: '"org-policy-v1"' },
        )
      }
      if (request.path === '/api/developer-console-access-policy') {
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
    expect(await screen.findByText('Acme Legal')).toBeTruthy()
    expect(screen.getByText('Jane Display')).toBeTruthy()
    expect(screen.getByText('Owner only')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit policy' }))
    fireEvent.change(await screen.findByLabelText('Organization creation'), {
      target: { value: 'Any verified user' },
    })
    expect(screen.queryByRole('combobox', { name: 'Approved users' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Console access'), { target: { value: 'All organizations' } })
    expect(screen.queryByRole('combobox', { name: 'Selected organizations' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Eligible access levels'), { target: { value: 'Owner only' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Edit developer access' })).toBeNull())

    unmount()
    emptySelections = true
    queryClient.clear()
    renderWithQuery(<SettingsPage section="developer" />)
    expect(await screen.findByText('Organizations')).toBeTruthy()
    expect(screen.getByText('Users')).toBeTruthy()
    expect(screen.getAllByText('None selected')).toHaveLength(2)
  })

  it('retries all settings resources after a failed query and closes the general editor', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(await screen.findByLabelText('Realm name')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByLabelText('Realm name')).toBeNull())
  })
})

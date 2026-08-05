import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyPagination, jsonResponse, renderWithQuery } from '@/features/console/console.test-utils'
import { OrganizationActivityPage } from '@/features/organizations/organization-activity'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Organization activity', () => {
  it('loads only the active Organization audit stream [spec: admin-console/organization-console-resource-boundary]', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const request = input instanceof Request ? input : null
      const url = new URL(request?.url ?? String(input), window.location.origin)
      requests.push(`${url.pathname}${url.search}`)
      return Promise.resolve(
        jsonResponse({
          items: [
            {
              id: 'audit-1',
              action: 'agent.access.granted',
              result: 'allowed',
              controllerUserId: 'user-1',
              subjectIssuer: null,
              subject: null,
              agentIdentityId: 'agent-1',
              hostId: null,
              resourceId: 'projects',
              resourceConnectionId: null,
              accessGrantId: 'grant-1',
              scopes: ['projects:read'],
              reasonCode: null,
              metadata: null,
              occurredAt: '2026-08-05T12:00:00.000Z',
            },
          ],
          pagination: { ...emptyPagination, total: 1 },
        }),
      )
    })

    renderWithQuery(<OrganizationActivityPage organizationId="org-1" />)

    expect(await screen.findByText('agent.access.granted')).toBeTruthy()
    expect(screen.getByText('projects')).toBeTruthy()
    expect(requests).toEqual(['/api/realm/audit-events?organizationId=org-1'])
  })
})

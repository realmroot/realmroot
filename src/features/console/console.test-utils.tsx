import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
export function renderWithQuery(children: ReactNode) {
  const routeTree = createRootRoute({ component: () => children })
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/'] }),
    routeTree,
  })
  const result = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return { ...result, router }
}

export function metricValue(label: string) {
  const card = screen.getByText(label).closest('[data-slot="card"]')
  expect(card).toBeTruthy()
  return card?.querySelector('[data-slot="card-title"]')?.textContent ?? ''
}

export function summaryCard(title: string) {
  const card = screen.getByRole('heading', { name: title }).closest('[data-slot="card"]')
  expect(card).toBeTruthy()
  return within(card as HTMLElement)
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

export function unexpectedConsoleRequest(input: RequestInfo | URL, init?: RequestInit): never {
  const request = input instanceof Request ? input : null
  const parsedUrl = request?.url ? new URL(request.url) : null
  const url = parsedUrl ? `${parsedUrl.pathname}${parsedUrl.search}` : String(input)
  throw new Error(`Unexpected console request: ${request?.method ?? init?.method ?? 'GET'} ${url}`)
}

export function consoleSharedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request ? input : null
  const parsedUrl = request?.url ? new URL(request.url) : null
  const url = parsedUrl ? `${parsedUrl.pathname}${parsedUrl.search}` : String(input)

  if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
  if (url === '/api/account/profile') {
    return Promise.resolve(jsonResponse({ user: consoleAccountProfile }))
  }
  if (url === '/api/account/developer-console-access') return Promise.resolve(jsonResponse(consoleAccountAccess))
  if (url === '/api/account/organization-context') {
    return Promise.resolve(jsonResponse({ activeOrganizationId: null }))
  }
  if (url === '/api/account/security') return Promise.resolve(jsonResponse({ security: accountSecurity }))
  if (url === '/api/realm/sign-in-policy') return Promise.resolve(jsonResponse(signInSettings))
  if (url === '/api/realm/account-management-policy') return Promise.resolve(jsonResponse(accountCenterSettings))
  if (url === '/api/realm/organization-creation-policy') {
    return Promise.resolve(
      jsonResponse(
        {
          mode: developerSettings.organizationCreation,
          approvedUserIds: developerSettings.approvedUserIds,
        },
        200,
        { ETag: '"organization-creation-v1"' },
      ),
    )
  }
  if (url === '/api/realm/developer-console-access-policy') {
    return Promise.resolve(
      jsonResponse(
        {
          mode: developerSettings.consoleAccess,
          eligibleAccessLevels: developerSettings.eligibleAccessLevels,
          selectedOrganizationIds: developerSettings.selectedOrganizationIds,
        },
        200,
        { ETag: '"developer-console-v1"' },
      ),
    )
  }
  if (url === '/api/realm') return Promise.resolve(jsonResponse(generalSettings, 200, { ETag: '"realm-v1"' }))
  if (url === '/api/realm/email-delivery-configuration') {
    return Promise.resolve(jsonResponse(emailSettings, 200, { ETag: '"email-delivery-v1"' }))
  }
  if (url === '/api/realm/branding') return Promise.resolve(jsonResponse(brandingSettings))
  if (url === '/api/realm/security-policy') return Promise.resolve(jsonResponse(securityPolicy))
  if (url === '/api/connectors') return Promise.resolve(jsonResponse({ connectors: [connector], pagination }))
  if (url === '/api/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
  if (url === '/api/realm/configuration-status') {
    return Promise.resolve(
      jsonResponse({ admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] } }),
    )
  }
  if (url === '/api/agents') {
    return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
  }
  if (url === '/api/realm/audit-events') {
    return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
  }
  if (url.includes('/authorizations') || url.includes('/application-authorizations')) {
    return Promise.resolve(jsonResponse({ authorizations: [], pagination: emptyPagination }))
  }
  if (url === '/api/applications' || url.startsWith('/api/applications?')) {
    return Promise.resolve(jsonResponse({ applications: [], pagination: emptyPagination }))
  }
  if (/^\/api\/users(?:\?|$)/.test(url)) {
    return Promise.resolve(jsonResponse({ users: [user], pagination }))
  }
  if (url === '/api/organizations') {
    return Promise.resolve(jsonResponse({ organizations: [organization], pagination }))
  }
  if (url === '/api/resource-servers') {
    return Promise.resolve(jsonResponse({ items: [{ ...apiResource, authorization: null }], pagination }))
  }

  return unexpectedConsoleRequest(input, init)
}

export function accountRouteFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input)
  if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
  if (url === '/api/account/profile') {
    return Promise.resolve(jsonResponse({ user: { ...profile, bio: null, links: [], location: null } }))
  }
  if (url === '/api/account/developer-console-access') return Promise.resolve(jsonResponse(consoleAccountAccess))
  if (url === '/api/account/organization-context') {
    return Promise.resolve(jsonResponse({ activeOrganizationId: null }))
  }
  if (url === '/api/account/provider-connections?limit=100&offset=0') {
    return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
  }
  if (url === '/api/account/linked-accounts') return Promise.resolve(jsonResponse({ accounts: [] }))
  if (url === '/api/account/application-authorizations')
    return Promise.resolve(jsonResponse({ authorizations: [], pagination: emptyPagination }))
  if (url === '/api/account/agents') return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
  if (url === '/api/account/api-resources')
    return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
  if (url === '/api/account/account-connections')
    return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
  if (url === '/api/account/sessions') return Promise.resolve(jsonResponse({ sessions: [] }))
  if (url === '/api/account/security') return Promise.resolve(jsonResponse({ security: accountSecurity }))
  if (url === '/api/account/security/passkeys') return Promise.resolve(jsonResponse({ passkeys: [] }))
  return Promise.resolve(jsonResponse(init?.method ? { ok: true } : {}))
}

export function consoleRouteFetch(input: RequestInfo | URL) {
  const request = input instanceof Request ? input : null
  const url = request?.url ? new URL(request.url).pathname : String(input)
  if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
  if (url === '/api/account/profile') {
    return Promise.resolve(jsonResponse({ user: consoleAccountProfile, access: consoleAccountAccess }))
  }
  if (url === '/api/realm/sign-in-policy') return Promise.resolve(jsonResponse(signInSettings))
  if (url === '/api/realm/account-management-policy') return Promise.resolve(jsonResponse(accountCenterSettings))
  if (url === '/api/realm/configuration-status') {
    return Promise.resolve(
      jsonResponse({ admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] } }),
    )
  }
  if (url === '/api/applications') {
    return Promise.resolve(jsonResponse({ applications: [application], pagination }))
  }
  if (url === '/api/applications/app-1') return Promise.resolve(jsonResponse(application))
  if (url.startsWith('/api/users')) return Promise.resolve(jsonResponse({ users: [user], pagination }))
  if (url === '/api/connectors') {
    return Promise.resolve(jsonResponse({ connectors: [connector], pagination }))
  }
  if (url === '/api/connectors/templates') {
    return Promise.resolve(jsonResponse(connectorTemplates))
  }
  if (url === '/api/organizations') {
    return Promise.resolve(jsonResponse({ organizations: [organization], pagination }))
  }
  if (url === '/api/organizations/org-1') return Promise.resolve(jsonResponse(organization))
  if (url === '/api/organizations/org-1/roles') return Promise.resolve(jsonResponse({ roles: [role], pagination }))
  if (url === '/api/resource-servers') {
    return Promise.resolve(jsonResponse({ items: [{ ...apiResource, authorization: null }], pagination }))
  }
  if (/^\/api\/webhooks\/[^/]+\/deliveries/.test(url)) {
    return Promise.resolve(jsonResponse({ requests: [webhookRequest], pagination }))
  }
  if (url.startsWith('/api/webhooks'))
    return Promise.resolve(jsonResponse({ endpoints: [webhookEndpoint], pagination }))
  if (url === '/api/realm/security-policy') return Promise.resolve(jsonResponse(securityPolicy))
  if (url === '/api/realm/branding') return Promise.resolve(jsonResponse(brandingSettings))
  return consoleSharedFetch(input)
}

import {
  accountCenterSettings,
  accountSecurity,
  brandingSettings,
  configz,
  developerSettings,
  emailSettings,
  generalSettings,
  securityPolicy,
  signInSettings,
} from './console.settings-fixtures'
import {
  apiResource,
  application,
  connector,
  connectorTemplates,
  consoleAccountAccess,
  consoleAccountProfile,
  emptyPagination,
  organization,
  pagination,
  profile,
  role,
  user,
  webhookEndpoint,
  webhookRequest,
} from './console.test-fixtures'

export * from './console.settings-fixtures'
export * from './console.test-fixtures'

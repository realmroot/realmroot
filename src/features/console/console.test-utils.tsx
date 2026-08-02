import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect } from 'vitest'
export function renderWithQuery(children: ReactNode) {
  const routeTree = createRootRoute({ component: () => children })
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/'] }),
    routeTree,
  })
  const result = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
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

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
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
    return Promise.resolve(jsonResponse({ user: consoleAccountProfile, access: consoleAccountAccess }))
  }
  if (url === '/api/account/security') return Promise.resolve(jsonResponse({ security: accountSecurity }))
  if (url === '/api/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
  if (url === '/api/account-center-settings') return Promise.resolve(jsonResponse(accountCenterSettings))
  if (url === '/api/developer-settings') return Promise.resolve(jsonResponse(developerSettings))
  if (url === '/api/general-settings') return Promise.resolve(jsonResponse(generalSettings))
  if (url === '/api/email-settings') return Promise.resolve(jsonResponse(emailSettings))
  if (url === '/api/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
  if (url === '/api/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
  if (url === '/api/connectors') return Promise.resolve(jsonResponse({ connectors: [connector], pagination }))
  if (url === '/api/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
  if (url === '/api/readiness') {
    return Promise.resolve(
      jsonResponse({ admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] } }),
    )
  }
  if (url === '/api/agents') {
    return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
  }
  if (url === '/api/audit-events') {
    return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
  }
  if (/^\/api\/users(?:\?|$)/.test(url)) {
    return Promise.resolve(jsonResponse({ users: [user], pagination }))
  }
  if (url === '/api/organizations') {
    return Promise.resolve(jsonResponse({ organizations: [organization], pagination }))
  }

  return unexpectedConsoleRequest(input, init)
}

export function accountRouteFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input)
  if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
  if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user: profile }))
  if (url === '/api/account/linked-accounts') return Promise.resolve(jsonResponse({ accounts: [] }))
  if (url === '/api/account/applications') return Promise.resolve(jsonResponse({ applications: [] }))
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
  if (url === '/api/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
  if (url === '/api/account-center-settings') return Promise.resolve(jsonResponse(accountCenterSettings))
  if (url === '/api/readiness') {
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
  if (url === '/api/roles') return Promise.resolve(jsonResponse({ roles: [role], pagination }))
  if (url === '/api/api-resources') {
    return Promise.resolve(jsonResponse({ items: [{ ...apiResource, authorization: null }], pagination }))
  }
  if (url.startsWith('/api/webhooks/endpoints')) {
    return Promise.resolve(jsonResponse({ endpoints: [webhookEndpoint], pagination }))
  }
  if (url.startsWith('/api/webhooks/requests')) {
    return Promise.resolve(jsonResponse({ requests: [webhookRequest], pagination }))
  }
  if (url === '/api/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
  if (url === '/api/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
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

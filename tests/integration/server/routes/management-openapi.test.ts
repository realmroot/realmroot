import { createApp } from '@server/http/app'
import { listManagementConnectorsResponseSchema, managementConnectorResponseSchema } from '@shared/api/management'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  adminHeaders,
  connectorFixture,
  createAuthMock,
  createConnectorServiceMock,
  createWebhookServiceMock,
  userHeaders,
  webhookEndpointResponse,
  webhookRequestResponse,
} from './management.test-utils'

describe('management routes 4', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  it('exposes management connector config CRUD with pagination', async () => {
    const connectors = createConnectorServiceMock()
    const app = createApp(createAuthMock(), {
      connectorServiceFactory: () => connectors,
    })
    const headers = adminHeaders()

    const list = await app.request('/api/management/connectors?limit=1&offset=0', { headers })
    const templates = await app.request('/api/management/connectors/templates', { headers })
    const created = await app.request('/api/management/connectors', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: 'google',
        providerType: 'social',
        providerId: 'google',
        displayName: 'Google',
        enabled: true,
        clientId: 'client-1',
        clientSecret: 'secret://google',
        issuer: 'https://accounts.google.com',
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
        userInfoEndpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
        jwksEndpoint: 'https://www.googleapis.com/oauth2/v3/certs',
        scopes: ['openid', 'email', 'profile'],
        providerMetadata: { prompt: 'select_account' },
      }),
    })
    const detail = await app.request('/api/management/connectors/connector-1', { headers })
    const readiness = await app.request('/api/management/connectors/connector-1/readiness', { headers })
    const updated = await app.request('/api/management/connectors/connector-1', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ enabled: false, displayName: 'Google Workspace' }),
    })
    const deleted = await app.request('/api/management/connectors/connector-1', { method: 'DELETE', headers })

    expect(list.status).toBe(200)
    await expect(list.json()).resolves.toEqual(
      listManagementConnectorsResponseSchema.parse({
        connectors: [connectorFixture()],
        pagination: {
          limit: 1,
          offset: 0,
          total: 1,
          hasMore: false,
          nextOffset: null,
        },
      }),
    )
    expect(templates.status).toBe(200)
    await expect(templates.json()).resolves.toMatchObject({
      templates: [expect.objectContaining({ providerId: 'google', icon: 'google' })],
    })
    expect(created.status).toBe(201)
    await expect(created.json()).resolves.toEqual(managementConnectorResponseSchema.parse(connectorFixture()))
    await expect(detail.json()).resolves.toEqual(managementConnectorResponseSchema.parse(connectorFixture()))
    await expect(readiness.json()).resolves.toMatchObject({
      connectorId: 'connector-1',
      ready: true,
      checks: [expect.objectContaining({ key: 'clientId', ok: true })],
    })
    await expect(updated.json()).resolves.toEqual(
      managementConnectorResponseSchema.parse({
        ...connectorFixture(),
        enabled: false,
        displayName: 'Google Workspace',
      }),
    )
    expect(deleted.status).toBe(204)
    expect(connectors.create).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'google',
        providerType: 'social',
        clientSecret: 'secret://google',
        scopes: ['openid', 'email', 'profile'],
      }),
    )
    expect(connectors.update).toHaveBeenCalledWith('connector-1', { enabled: false, displayName: 'Google Workspace' })
    expect(connectors.delete).toHaveBeenCalledWith('connector-1')
  })

  it('stores connector client secrets without returning secret values', async () => {
    const connectors = createConnectorServiceMock()
    const app = createApp(createAuthMock(), {
      connectorServiceFactory: () => connectors,
    })
    const headers = adminHeaders()

    const created = await app.request('/api/management/connectors', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        providerType: 'social',
        providerId: 'github',
        displayName: 'GitHub',
        enabled: true,
        clientId: 'review-client-id',
        clientSecret: 'REVIEW_CLIENT_SECRET',
      }),
    })
    const updated = await app.request('/api/management/connectors/connector-1', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        enabled: true,
        clientSecret: 'REVIEW_CLIENT_SECRET',
      }),
    })
    const list = await app.request('/api/management/connectors?limit=1&offset=0', { headers })
    const templates = await app.request('/api/management/connectors/templates', { headers })

    expect(created.status).toBe(201)
    await expect(created.json()).resolves.toMatchObject({ clientSecretConfigured: true })
    expect(updated.status).toBe(200)
    await expect(updated.json()).resolves.toMatchObject({ clientSecretConfigured: true })
    expect(list.status).toBe(200)
    expect(templates.status).toBe(200)
    expect(connectors.create).toHaveBeenCalledWith(expect.objectContaining({ clientSecret: 'REVIEW_CLIENT_SECRET' }))
    expect(connectors.update).toHaveBeenCalledWith(
      'connector-1',
      expect.objectContaining({ clientSecret: 'REVIEW_CLIENT_SECRET' }),
    )
  })

  it('rejects unsupported connector provider types at the request boundary', async () => {
    const connectors = createConnectorServiceMock()
    const response = await createApp(createAuthMock(), {
      connectorServiceFactory: () => connectors,
    }).request('/api/management/connectors', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        slug: 'saml',
        providerType: 'saml',
        providerId: 'saml',
        displayName: 'SAML',
        clientId: 'client-1',
        clientSecret: 'secret://saml',
      }),
    })

    expect(response.status).toBe(400)
    expect(connectors.create).not.toHaveBeenCalled()
  })

  it('reuses connector contracts for generic OAuth request validation', async () => {
    const connectors = createConnectorServiceMock()
    const response = await createApp(createAuthMock(), {
      connectorServiceFactory: () => connectors,
    }).request('/api/management/connectors', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        providerType: 'generic_oauth',
        providerId: 'okta-main',
        displayName: 'Okta',
        clientId: 'client-1',
        clientSecret: 'secret://okta',
        authorizationEndpoint: 'https://idp.example.com/oauth2/v1/authorize',
      }),
    })

    expect(response.status).toBe(400)
    expect(connectors.create).not.toHaveBeenCalled()
  })

  it('exposes webhook endpoint and request resources through the management boundary', async () => {
    const webhooks = createWebhookServiceMock()
    const app = createApp(createAuthMock(), { webhookServiceFactory: () => webhooks })
    const headers = adminHeaders()

    const list = await app.request('/api/management/webhooks/endpoints?limit=10&offset=5&search=auth&status=enabled', {
      headers,
    })
    const created = await app.request('/api/management/webhooks/endpoints', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url: 'https://events.example.com/flareauth',
        events: ['user.created'],
        enabled: true,
      }),
    })
    const detail = await app.request('/api/management/webhooks/endpoints/wh_1', { headers })
    const updated = await app.request('/api/management/webhooks/endpoints/wh_1', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ enabled: false }),
    })
    const rotated = await app.request('/api/management/webhooks/endpoints/wh_1/secrets', { method: 'POST', headers })
    const requests = await app.request('/api/management/webhooks/requests?limit=2&offset=4&status=failed', {
      headers,
    })
    const requestDetail = await app.request('/api/management/webhooks/requests/whr_1', { headers })
    const retried = await app.request('/api/management/webhooks/requests/whr_1/retries', { method: 'POST', headers })
    const deleted = await app.request('/api/management/webhooks/endpoints/wh_1', { method: 'DELETE', headers })

    expect(list.status).toBe(200)
    await expect(list.json()).resolves.toEqual({
      endpoints: [webhookEndpointResponse()],
      pagination: { limit: 10, offset: 5, total: 1, hasMore: false, nextOffset: null },
    })
    expect(created.status).toBe(201)
    await expect(created.json()).resolves.toEqual({
      endpoint: webhookEndpointResponse(),
      signingSecret: 'whsec_created_secret',
    })
    await expect(detail.json()).resolves.toEqual(webhookEndpointResponse())
    await expect(updated.json()).resolves.toEqual({ ...webhookEndpointResponse(), enabled: false })
    expect(rotated.status).toBe(201)
    await expect(rotated.json()).resolves.toEqual({
      endpoint: webhookEndpointResponse(),
      signingSecret: 'whsec_rotated_secret',
    })
    await expect(requests.json()).resolves.toEqual({
      requests: [webhookRequestResponse()],
      pagination: { limit: 2, offset: 4, total: 1, hasMore: false, nextOffset: null },
    })
    await expect(requestDetail.json()).resolves.toEqual(webhookRequestResponse())
    expect(retried.status).toBe(202)
    await expect(retried.json()).resolves.toEqual({ ...webhookRequestResponse(), status: 'pending' })
    expect(deleted.status).toBe(204)

    expect(webhooks.listEndpoints).toHaveBeenCalledWith({
      limit: 10,
      offset: 5,
      search: 'auth',
      status: 'enabled',
    })
    expect(webhooks.createEndpoint).toHaveBeenCalledWith(
      { url: 'https://events.example.com/flareauth', events: ['user.created'], enabled: true },
      'admin-1',
    )
    expect(webhooks.updateEndpoint).toHaveBeenCalledWith('wh_1', { enabled: false })
    expect(webhooks.rotateSecret).toHaveBeenCalledWith('wh_1')
    expect(webhooks.listRequests).toHaveBeenCalledWith({ limit: 2, offset: 4, status: 'failed' })
    expect(webhooks.getRequest).toHaveBeenCalledWith('whr_1')
    expect(webhooks.retryRequest).toHaveBeenCalledWith('whr_1')
    expect(webhooks.deleteEndpoint).toHaveBeenCalledWith('wh_1')
  })

  it('protects and validates webhook management requests', async () => {
    const webhooks = createWebhookServiceMock()
    const app = createApp(createAuthMock(), { webhookServiceFactory: () => webhooks })

    const unauthenticated = await app.request('/api/management/webhooks/endpoints')
    const nonAdmin = await app.request('/api/management/webhooks/endpoints', { headers: userHeaders() })
    const invalid = await app.request('/api/management/webhooks/endpoints', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ url: 'http://events.example.com/flareauth', events: [] }),
    })

    expect(unauthenticated.status).toBe(401)
    expect(nonAdmin.status).toBe(403)
    expect(invalid.status).toBe(400)
    expect(webhooks.createEndpoint).not.toHaveBeenCalled()
  })
})

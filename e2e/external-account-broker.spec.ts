import { expect, test } from '@playwright/test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { baseURL, resetAndBootstrap, signIn } from './helpers/real-app'
import { createRestishAgentPlugin } from './helpers/restish-agent-plugin'

const externalBrowserOrigin = `http://127.0.0.1:${process.env.E2E_EXTERNAL_PORT ?? '4399'}`
const externalOrigin = 'https://fake-external.example'

test.describe('external account credential brokerage', () => {
  test.beforeEach(async () => {
    await resetAndBootstrap()
    const reset = await fetch(`${externalBrowserOrigin}/__reset`, { method: 'POST' })
    expect(reset.ok).toBe(true)
  })

  test(`[spec: agent-identity/external-account-connection]
        [spec: agent-identity/agent-egress-proxy]
        [spec: agent-identity/agent-egress-revocation]
        an Agent uses a real OAuth connection through constrained credential-injecting egress`, async ({ page }) => {
    await signIn(page)
    const plugin = createRestishAgentPlugin(baseURL)

    try {
      const whoami = plugin.firstWhoami('External Account E2E Agent')
      await page.goto(await whoami.approvalUrl)
      await page.getByRole('button', { name: 'Approve login' }).click()
      await expect(page.getByRole('heading', { name: 'Authorization successful' })).toBeVisible()
      const identity = (await whoami.result).identity

      const connectorResponse = await page.request.post('/api/management/connectors', {
        data: {
          providerType: 'generic_oauth',
          providerId: 'e2e-fake-oidc',
          displayName: 'E2E Fake OIDC',
          clientId: 'e2e-client',
          clientSecret: 'e2e-client-secret',
          issuer: externalOrigin,
          apiBaseUrl: externalOrigin,
          credentialModes: ['oauth'],
          allowedMethods: ['GET'],
          allowedPathPrefixes: ['/api/repos'],
          scopes: ['openid', 'repo:read'],
        },
      })
      expect(connectorResponse.status()).toBe(201)
      const connector = (await connectorResponse.json()) as { id: string }

      const intentResponse = await page.request.post('/api/account/external-oauth-intents', {
        data: {
          connectorId: connector.id,
          owner: { type: 'user' },
          displayName: 'E2E Repository Account',
        },
      })
      const intentBody = await intentResponse.text()
      expect(intentResponse.status(), intentBody).toBe(201)
      const intent = JSON.parse(intentBody) as { authorizationUrl: string }

      const authorization = new URL(intent.authorizationUrl)
      await page.goto(`${externalBrowserOrigin}${authorization.pathname}${authorization.search}`)
      expect(page.url()).toContain('/api/external-accounts/oauth/callback')
      const account = JSON.parse(await page.locator('body').innerText()) as {
        id: string
        credentialConfigured: boolean
        credentialKind: string
        externalSubject: string
      }
      expect(account).toMatchObject({
        credentialConfigured: true,
        credentialKind: 'oauth',
        externalSubject: 'external-account-42',
      })

      const externalGrantResponse = await page.request.post(`/api/account/external-accounts/${account.id}/grants`, {
        data: {
          agentIdentityId: identity.id,
          scopes: ['repo:read'],
          allowedMethods: ['GET'],
          allowedPathPrefixes: ['/api/repos'],
        },
      })
      expect(externalGrantResponse.status()).toBe(201)
      const externalGrant = (await externalGrantResponse.json()) as { id: string }

      const authorityResponse = await page.request.post(
        `/api/account/agent-identities/${identity.id}/authority-grants`,
        {
          data: {
            mode: 'autonomous',
            audience: externalOrigin,
            scopes: ['repo:read'],
          },
        },
      )
      expect(authorityResponse.status()).toBe(201)
      const authority = (await authorityResponse.json()) as { id: string }

      const keyPair = await generateKeyPair('ES256')
      const publicJwk = await exportJWK(keyPair.publicKey)
      const tokenProof = await dpopProof('POST', `${baseURL}/api/auth/oauth2/token`, keyPair.privateKey, publicJwk)
      const token = plugin.requestAgentToken(authority.id, tokenProof)
      expect(token).toMatchObject({ token_type: 'DPoP', scope: 'repo:read' })

      const egressUrl = `${baseURL}/api/agent/egress/${account.id}/api/repos/42`
      const egressProof = await dpopProof('GET', egressUrl, keyPair.privateKey, publicJwk, token.access_token)
      const egress = await fetch(egressUrl, {
        headers: {
          authorization: `DPoP ${token.access_token}`,
          dpop: egressProof,
        },
      })
      expect(egress.status).toBe(200)
      await expect(egress.json()).resolves.toEqual({ id: 42, name: 'agent-ready-repository' })
      expect(egress.headers.get('x-ratelimit-remaining')).toBe('9')

      const upstreamState = await fetch(`${externalBrowserOrigin}/__state`).then((response) => response.json())
      expect(upstreamState).toMatchObject({
        authorizationRequests: 1,
        tokenExchanges: 1,
        tokenRefreshes: 1,
        apiRequests: 1,
        credentialInjected: true,
      })

      const revoke = await page.request.delete(
        `/api/account/external-accounts/${account.id}/grants/${externalGrant.id}`,
      )
      expect(revoke.status()).toBe(204)

      const revokedProof = await dpopProof('GET', egressUrl, keyPair.privateKey, publicJwk, token.access_token)
      const revoked = await fetch(egressUrl, {
        headers: {
          authorization: `DPoP ${token.access_token}`,
          dpop: revokedProof,
        },
      })
      expect(revoked.status).toBe(403)
      const finalUpstreamState = await fetch(`${externalBrowserOrigin}/__state`).then((response) => response.json())
      expect(finalUpstreamState.apiRequests).toBe(1)
    } finally {
      plugin.dispose()
    }
  })
})

async function dpopProof(
  method: string,
  url: string,
  privateKey: CryptoKey,
  publicJwk: JsonWebKey,
  accessToken?: string,
) {
  const claims: Record<string, string | number> = {
    htm: method,
    htu: url,
    jti: crypto.randomUUID(),
    iat: Math.floor(Date.now() / 1000),
  }
  if (accessToken) claims.ath = await sha256(accessToken)
  return new SignJWT(claims).setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: publicJwk }).sign(privateKey)
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Buffer.from(digest).toString('base64url')
}

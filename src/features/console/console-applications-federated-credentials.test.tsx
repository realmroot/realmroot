import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApplicationFederatedCredentialsPage } from '@/features/console/extracted/applications/application-detail-pages'
import {
  ApplicationFederatedCredentialsPanel,
  parseFederatedCredentialForm,
  parseKeyMaterial,
} from '@/features/console/extracted/applications/application-federated-credentials'
import { jsonResponse, renderWithQuery } from './console.test-utils'

vi.mock('@/features/console/extracted/applications/application-detail', () => ({
  ApplicationDetailPage: ({ applicationId, section }: { applicationId: string; section: string }) =>
    `${applicationId}:${section}`,
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('admin console application federated credentials', () => {
  it('parses federated credential key material', () => {
    expect(parseKeyMaterial(' https://issuer.example.com/jwks ', '')).toEqual({
      jwksUrl: 'https://issuer.example.com/jwks',
    })
    expect(parseKeyMaterial('', '{"keys":[{"kty":"RSA","kid":"rsa-1"}]}')).toEqual({
      publicKeys: [{ kty: 'RSA', kid: 'rsa-1' }],
    })
    expect(parseKeyMaterial('', '[{"kty":"EC","kid":"ec-1"}]')).toEqual({
      publicKeys: [{ kty: 'EC', kid: 'ec-1' }],
    })
    expect(parseKeyMaterial('', '{"kty":"OKP","kid":"okp-1"}')).toEqual({
      publicKeys: [{ kty: 'OKP', kid: 'okp-1' }],
    })

    expect(() => parseKeyMaterial('https://issuer.example.com/jwks', '{"kty":"RSA"}')).toThrow(
      'Provide either a JWKS URL or inline public keys, not both.',
    )
    expect(() => parseKeyMaterial('', '')).toThrow(
      'A federated credential requires either a JWKS URL or one or more public keys.',
    )
    expect(() => parseKeyMaterial('', 'not json')).toThrow('Public keys must be a valid JWK or JWK Set in JSON format.')
    expect(() => parseKeyMaterial('', '"not-a-key"')).toThrow(
      'Public keys must be a valid JWK or JWK Set in JSON format.',
    )
  })

  it('parses federated credential form data', () => {
    const jwksForm = new FormData()
    jwksForm.set('name', 'JWKS credential')
    jwksForm.set('issuer', 'https://issuer.example.com')
    jwksForm.set('subject', 'workload-1')
    jwksForm.set('audienceResourceId', 'res_1')
    jwksForm.set('jwksUrl', 'https://issuer.example.com/jwks')

    expect(parseFederatedCredentialForm(jwksForm)).toEqual({
      material: { jwksUrl: 'https://issuer.example.com/jwks' },
      base: {
        name: 'JWKS credential',
        issuer: 'https://issuer.example.com',
        subject: 'workload-1',
        audienceResourceId: 'res_1',
      },
    })

    const inlineKeyForm = new FormData()
    inlineKeyForm.set('publicKeys', '{"kty":"RSA","kid":"key-1"}')

    expect(parseFederatedCredentialForm(inlineKeyForm)).toEqual({
      material: { publicKeys: [{ kty: 'RSA', kid: 'key-1' }] },
      base: { name: '', issuer: '', subject: '', audienceResourceId: '' },
    })
  })

  it('routes the federated credential detail section', () => {
    renderWithQuery(<ApplicationFederatedCredentialsPage applicationId="app-1" />)

    expect(screen.getByText('app-1:federated-credentials')).toBeTruthy()
  })

  it('lists, creates, disables, and deletes federated credentials', async () => {
    const requests: Array<{ method: string; url: string; body: unknown }> = []
    let credentials = [
      {
        id: 'cred-1',
        applicationId: 'app-1',
        name: 'Worker credential',
        issuer: 'https://platform.example.com',
        subject: 'org_1:*',
        audienceResourceId: 'res_1',
        jwksUrl: null,
        publicKeys: [{ kty: 'RSA', kid: 'key-1' }],
        enabled: true,
        metadata: {},
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]

    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/management/api-resources') {
        return jsonResponse({
          resources: [
            {
              id: 'res_1',
              name: 'Runner API',
              identifier: 'https://auth.example.com/api/runner',
              audience: 'https://auth.example.com/api/runner',
              enabled: true,
              metadata: {},
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          pagination: { limit: 50, offset: 0, total: 1, hasMore: false, nextOffset: null },
        })
      }
      if (url === '/api/management/applications/app-1/federated-credentials' && method === 'GET') {
        return jsonResponse({ credentials })
      }
      if (url === '/api/management/applications/app-1/federated-credentials' && method === 'POST') {
        const body = JSON.parse(String(init?.body))
        requests.push({ method, url, body })
        const created = {
          id: 'cred-2',
          applicationId: 'app-1',
          enabled: true,
          metadata: {},
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          publicKeys: null,
          ...body,
        }
        credentials = [...credentials, created]
        return jsonResponse({ credential: created }, 201)
      }
      if (url === '/api/management/applications/app-1/federated-credentials/cred-1' && method === 'PATCH') {
        const body = JSON.parse(String(init?.body))
        requests.push({ method, url, body })
        credentials = credentials.map((credential) =>
          credential.id === 'cred-1' ? { ...credential, ...body } : credential,
        )
        return jsonResponse({ credential: credentials[0] })
      }
      if (url === '/api/management/applications/app-1/federated-credentials/cred-1' && method === 'DELETE') {
        requests.push({ method, url, body: null })
        credentials = credentials.filter((credential) => credential.id !== 'cred-1')
        return new Response(null, { status: 204 })
      }
      throw new Error(`Unexpected request: ${method} ${url}`)
    })

    renderWithQuery(<ApplicationFederatedCredentialsPanel applicationId="app-1" />)

    expect(await screen.findByText('Worker credential')).toBeTruthy()
    expect(
      screen.getByText(
        (_, element) => element?.tagName === 'P' && (element.textContent?.includes('1 public key(s)') ?? false),
      ),
    ).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'JWKS credential' } })
    fireEvent.change(screen.getByLabelText('Issuer'), { target: { value: 'https://issuer.example.com' } })
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'workload-1' } })
    fireEvent.change(screen.getByLabelText('Audience'), { target: { value: 'res_1' } })
    fireEvent.change(screen.getByLabelText('JWKS URL'), {
      target: { value: 'https://issuer.example.com/.well-known/jwks.json' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add credential' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        method: 'POST',
        url: '/api/management/applications/app-1/federated-credentials',
        body: {
          name: 'JWKS credential',
          issuer: 'https://issuer.example.com',
          subject: 'workload-1',
          audienceResourceId: 'res_1',
          jwksUrl: 'https://issuer.example.com/.well-known/jwks.json',
        },
      })
    })
    expect(await screen.findByText('JWKS credential')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Disable' })[0])
    await waitFor(() => {
      expect(requests).toContainEqual({
        method: 'PATCH',
        url: '/api/management/applications/app-1/federated-credentials/cred-1',
        body: { enabled: false },
      })
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    await waitFor(() => {
      expect(requests).toContainEqual({
        method: 'DELETE',
        url: '/api/management/applications/app-1/federated-credentials/cred-1',
        body: null,
      })
    })
  })

  it('shows fallback row values for disabled credentials', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/management/api-resources') {
        return jsonResponse({
          resources: [],
          pagination: { limit: 50, offset: 0, total: 0, hasMore: false, nextOffset: null },
        })
      }
      if (url === '/api/management/applications/app-1/federated-credentials' && method === 'GET') {
        return jsonResponse({
          credentials: [
            {
              id: 'cred-1',
              applicationId: 'app-1',
              name: 'Disabled credential',
              issuer: 'https://platform.example.com',
              subject: 'org_1:*',
              audienceResourceId: 'missing-resource',
              jwksUrl: null,
              publicKeys: null,
              enabled: false,
              metadata: {},
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        })
      }
      throw new Error(`Unexpected request: ${method} ${url}`)
    })

    renderWithQuery(<ApplicationFederatedCredentialsPanel applicationId="app-1" />)

    expect(await screen.findByText('Disabled credential')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enable' })).toBeTruthy()
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' && (element.textContent?.includes('missing-resource · 0 public key(s)') ?? false),
      ),
    ).toBeTruthy()
  })
})

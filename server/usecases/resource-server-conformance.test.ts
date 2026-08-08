import { ApiError } from '@server/domain/errors'
import type { Deps } from '@server/usecases/deps'
import { requireResourceServerConformance } from '@server/usecases/resource-server-conformance'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  inspectExternalResourceConnector: vi.fn(),
  readProtectedResourceMetadata: vi.fn(),
  readResourceContract: vi.fn(),
  validateResourceUrl: vi.fn(),
}))

vi.mock('@server/usecases/resource-connectors', () => ({
  inspectExternalResourceConnector: mocks.inspectExternalResourceConnector,
}))
vi.mock('@server/usecases/resource-metadata', () => ({
  readProtectedResourceMetadata: mocks.readProtectedResourceMetadata,
}))
vi.mock('@server/usecases/resource-openapi', () => ({
  readResourceContract: mocks.readResourceContract,
  validateResourceUrl: mocks.validateResourceUrl,
}))

const deps = {} as Deps
const resourceUrl = 'https://api.example.com'
const metadata = {
  sourceUrl: `${resourceUrl}/.well-known/oauth-protected-resource`,
  resource: resourceUrl,
  authorizationServers: ['https://issuer.example.com'],
  scopesSupported: ['projects:read'],
  etag: null,
}
const contract = {
  sourceUrl: `${resourceUrl}/openapi.json`,
  etag: null,
  documentHash: 'contract',
  name: 'Projects API',
  description: null,
  scopes: [{ value: 'projects:read', description: null }],
  operations: [
    {
      method: 'GET',
      path: '/projects',
      operationId: 'listProjects',
      summary: null,
      description: null,
      requiredScopeSets: [['projects:read']],
    },
  ],
}

describe('resource server conformance', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.readProtectedResourceMetadata.mockResolvedValue(metadata)
    mocks.readResourceContract.mockResolvedValue(contract)
    mocks.inspectExternalResourceConnector.mockResolvedValue([])
  })

  it('returns complete discovery results for a conforming resource server', async () => {
    await expect(validate()).resolves.toEqual({ metadata, contract })
  })

  it('reports invalid resource URLs and blocks dependent discovery checks', async () => {
    mocks.validateResourceUrl.mockImplementation(() => {
      throw new Error('Resource URL must use HTTPS.')
    })

    await expectChecks(validate(), 400, [
      ['RESOURCE-HTTPS', 'failed'],
      ['RESOURCE-METADATA', 'blocked'],
      ['API-SERVICE-DESC', 'blocked'],
      ['API-OPENAPI', 'blocked'],
    ])
    expect(mocks.readProtectedResourceMetadata).not.toHaveBeenCalled()
  })

  it('adds connector findings even when an invalid resource URL blocks discovery', async () => {
    mocks.validateResourceUrl.mockImplementation(() => {
      throw 'invalid resource URL'
    })
    mocks.inspectExternalResourceConnector.mockResolvedValue([
      { requirement: 'DPOP', status: 'failed', message: 'DPoP is missing.' },
    ])

    await expectChecks(validate({ connectorId: 'connector-1' }), 400, [
      ['RESOURCE-HTTPS', 'failed'],
      ['DPOP', 'failed'],
    ])
  })

  it('turns connector API errors into conformance findings on invalid URLs', async () => {
    mocks.validateResourceUrl.mockImplementation(() => {
      throw new Error('invalid')
    })
    mocks.inspectExternalResourceConnector.mockRejectedValue(new ApiError(404, 'not_found', 'Connector missing.'))

    await expectChecks(validate({ connectorId: 'connector-1' }), 400, [['OIDC-CONNECTION', 'failed']])
  })

  it('does not hide unexpected connector errors on invalid URLs', async () => {
    mocks.validateResourceUrl.mockImplementation(() => {
      throw new Error('invalid')
    })
    mocks.inspectExternalResourceConnector.mockRejectedValue(new TypeError('adapter bug'))

    await expect(validate({ connectorId: 'connector-1' })).rejects.toThrow('adapter bug')
  })

  it('reports metadata and service discovery failures together and preserves gateway status', async () => {
    mocks.readProtectedResourceMetadata.mockRejectedValue(new ApiError(502, 'bad_gateway', 'Metadata unavailable.'))
    mocks.readResourceContract.mockRejectedValue(new Error('Business resource must advertise its OpenAPI document.'))

    await expectChecks(validate(), 502, [
      ['RESOURCE-METADATA', 'failed'],
      ['API-SERVICE-DESC', 'failed'],
      ['API-OPENAPI', 'blocked'],
    ])
  })

  it('classifies OpenAPI document fetch and parsing failures without blocking the document check', async () => {
    mocks.readResourceContract.mockRejectedValue(
      new ApiError(400, 'bad_request', 'Business resource OpenAPI discovery failed.', {
        stage: 'openapi_document',
      }),
    )

    await expectChecks(validate(), 400, [['API-OPENAPI', 'failed']])

    mocks.readResourceContract.mockRejectedValue(new Error('OpenAPI document was invalid.'))
    await expectChecks(validate(), 400, [['API-OPENAPI', 'failed']])
  })

  it('reports an empty OpenAPI discovery result', async () => {
    mocks.readResourceContract.mockResolvedValue(null)

    await expectChecks(validate(), 400, [['API-OPENAPI', 'failed']])
  })

  it('reports every operation scope absent from protected resource metadata once', async () => {
    mocks.readResourceContract.mockResolvedValue({
      ...contract,
      operations: [{ ...contract.operations[0], requiredScopeSets: [['projects:write'], ['projects:write']] }],
    })

    const error = await rejectedApiError(validate())
    expect(error.details?.checks).toEqual([
      expect.objectContaining({
        requirement: 'API-OPENAPI',
        message:
          'OpenAPI operations require scopes not advertised by RFC 9728 metadata: GET /projects: projects:write.',
      }),
    ])
  })

  it('aggregates connector findings and connector API errors after discovery', async () => {
    mocks.inspectExternalResourceConnector.mockResolvedValue([
      { requirement: 'TOKEN-EXCHANGE', status: 'failed', message: 'Token exchange is missing.' },
    ])
    await expectChecks(validate({ connectorId: 'connector-1' }), 400, [['TOKEN-EXCHANGE', 'failed']])

    mocks.inspectExternalResourceConnector.mockRejectedValue(new ApiError(400, 'bad_request', 'Connector invalid.'))
    await expectChecks(validate({ connectorId: 'connector-1' }), 400, [['OIDC-CONNECTION', 'failed']])
  })

  it('does not hide unexpected connector errors after discovery', async () => {
    mocks.inspectExternalResourceConnector.mockRejectedValue(new TypeError('connector adapter bug'))

    await expect(validate({ connectorId: 'connector-1' })).rejects.toThrow('connector adapter bug')
  })

  it('requires a connector when rich authorization details are configured', async () => {
    await expectChecks(validate({ authorizationDetails: [{ type: 'project_access', actions: ['read'] }] }), 400, [
      ['RICH-AUTHORIZATION', 'failed'],
    ])
  })

  it('fails fast if discovery reports success without metadata', async () => {
    mocks.readProtectedResourceMetadata.mockResolvedValue(null)

    await expect(validate()).rejects.toThrow('Conformance passed without complete discovery results.')
  })
})

function validate(overrides: Partial<Parameters<typeof requireResourceServerConformance>[1]> = {}) {
  return requireResourceServerConformance(deps, {
    resourceUrl,
    connectorId: null,
    authorizationDetails: [],
    ...overrides,
  })
}

async function rejectedApiError(promise: ReturnType<typeof validate>) {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    return error as ApiError
  }
  throw new Error('Expected conformance validation to fail.')
}

async function expectChecks(
  promise: ReturnType<typeof validate>,
  status: number,
  checks: Array<[string, 'failed' | 'blocked']>,
) {
  const error = await rejectedApiError(promise)
  expect(error).toMatchObject({
    status,
    details: {
      checks: expect.arrayContaining(
        checks.map(([requirement, checkStatus]) => expect.objectContaining({ requirement, status: checkStatus })),
      ),
    },
  })
}

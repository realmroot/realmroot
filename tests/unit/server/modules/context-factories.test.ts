import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('module context factories', () => {
  it('creates application services with request-derived issuer', async () => {
    const db = { kind: 'db' }
    const repository = { kind: 'applications' }
    const service = { kind: 'application-service' }
    const createDb = vi.fn().mockReturnValue(db)
    const createDrizzleApplicationRepository = vi.fn().mockReturnValue(repository)
    const ApplicationService = vi.fn(function ApplicationService() {
      return service
    })
    vi.doMock('../../../../server/db/client', () => ({ createDb }))
    vi.doMock('@server/adapters/repos/applications', () => ({
      createDrizzleApplicationRepository,
    }))
    vi.doMock('@server/usecases/applications', () => ({ ApplicationService }))

    const { createApplicationService } = await import('@server/composition')

    expect(createApplicationService(context('https://auth.example.com/api/management/applications'))).toBe(service)
    expect(createDb).toHaveBeenCalledWith('database-binding')
    expect(createDrizzleApplicationRepository).toHaveBeenCalledWith(db)
    expect(ApplicationService).toHaveBeenCalledWith(repository, { issuer: 'https://auth.example.com' })
  })

  it('creates authorization services from the request database binding', async () => {
    const db = { kind: 'db' }
    const repository = { kind: 'authorization' }
    const service = { kind: 'authorization-service' }
    const createDb = vi.fn().mockReturnValue(db)
    const createDrizzleAuthorizationRepository = vi.fn().mockReturnValue(repository)
    const AuthorizationService = vi.fn(function AuthorizationService() {
      return service
    })
    vi.doMock('../../../../server/db/client', () => ({ createDb }))
    vi.doMock('@server/adapters/repos/authorization', () => ({
      createDrizzleAuthorizationRepository,
    }))
    vi.doMock('@server/usecases/authorization', () => ({ AuthorizationService }))

    const { createAuthorizationService } = await import('@server/composition')

    expect(createAuthorizationService(context('https://auth.example.com/api/management/roles'))).toBe(service)
    expect(createDb).toHaveBeenCalledWith('database-binding')
    expect(createDrizzleAuthorizationRepository).toHaveBeenCalledWith(db)
    expect(AuthorizationService).toHaveBeenCalledWith(repository)
  })

  it('creates connector services from the request database binding', async () => {
    const db = { kind: 'db' }
    const repository = { kind: 'connectors' }
    const service = { kind: 'connector-service' }
    const createDb = vi.fn().mockReturnValue(db)
    const createConnectorRepository = vi.fn().mockReturnValue(repository)
    const ConnectorService = vi.fn(function ConnectorService() {
      return service
    })
    vi.doMock('../../../../server/db/client', () => ({ createDb }))
    vi.doMock('@server/adapters/repos/connectors', () => ({ createConnectorRepository }))
    vi.doMock('@server/usecases/connectors', () => ({ ConnectorService }))

    const { createConnectorService } = await import('@server/composition')

    expect(createConnectorService(context('https://auth.example.com/api/management/connectors'))).toBe(service)
    expect(createDb).toHaveBeenCalledWith('database-binding')
    expect(createConnectorRepository).toHaveBeenCalledWith(db)
    expect(ConnectorService).toHaveBeenCalledWith(repository)
  })

  it('creates webhook services from the request database binding', async () => {
    const db = { kind: 'db' }
    const repository = { kind: 'webhooks' }
    const service = { kind: 'webhook-service' }
    const createDb = vi.fn().mockReturnValue(db)
    const createWebhookRepository = vi.fn().mockReturnValue(repository)
    const WebhookService = vi.fn(function WebhookService() {
      return service
    })
    vi.doMock('../../../../server/db/client', () => ({ createDb }))
    vi.doMock('@server/adapters/repos/webhooks', () => ({ createWebhookRepository }))
    vi.doMock('@server/usecases/webhooks', () => ({ WebhookService }))

    const { createWebhookService } = await import('@server/composition')

    expect(createWebhookService(context('https://auth.example.com/api/management/webhooks/endpoints'))).toBe(service)
    expect(createDb).toHaveBeenCalledWith('database-binding')
    expect(createWebhookRepository).toHaveBeenCalledWith(db)
    expect(WebhookService).toHaveBeenCalledWith(repository)
  })
})

function context(url: string) {
  return {
    env: { DB: 'database-binding' },
    req: { url },
  } as never
}

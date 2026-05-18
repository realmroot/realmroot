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
    vi.doMock('../db/client', () => ({ createDb }))
    vi.doMock('./applications/drizzle-repository', () => ({ createDrizzleApplicationRepository }))
    vi.doMock('./applications/service', () => ({ ApplicationService }))

    const { createApplicationService } = await import('./applications/context')

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
    vi.doMock('../db/client', () => ({ createDb }))
    vi.doMock('./authorization/drizzle-repository', () => ({ createDrizzleAuthorizationRepository }))
    vi.doMock('./authorization/service', () => ({ AuthorizationService }))

    const { createAuthorizationService } = await import('./authorization/context')

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
    vi.doMock('../db/client', () => ({ createDb }))
    vi.doMock('./connectors/repository', () => ({ createConnectorRepository }))
    vi.doMock('./connectors/service', () => ({ ConnectorService }))

    const { createConnectorService } = await import('./connectors/context')

    expect(createConnectorService(context('https://auth.example.com/api/management/connectors'))).toBe(service)
    expect(createDb).toHaveBeenCalledWith('database-binding')
    expect(createConnectorRepository).toHaveBeenCalledWith(db)
    expect(ConnectorService).toHaveBeenCalledWith(repository)
  })
})

function context(url: string) {
  return {
    env: { DB: 'database-binding' },
    req: { url },
  } as never
}

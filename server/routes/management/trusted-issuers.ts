import { Hono } from 'hono'
import {
  createManagementTrustedIssuerRequestSchema,
  createManagementTrustedIssuerResponseSchema,
  listManagementTrustedIssuersResponseSchema,
} from '../../../shared/api/management'
import type { TokenExchangeServiceFactory } from '../../app'
import { requireAdmin } from '../../middleware/admin'
import { createTokenExchangeService, type TokenExchangeBindings } from '../../modules/token-exchange/context'
import { readJson } from '../validation'

export function createTrustedIssuerRoutes(factory: TokenExchangeServiceFactory = createTokenExchangeService) {
  const app = new Hono<{ Bindings: TokenExchangeBindings }>()

  app.use('*', requireAdmin())

  app.get('/', async (c) => {
    const issuers = await factory(c).listTrustedIssuers()
    return c.json(listManagementTrustedIssuersResponseSchema.parse({ issuers: issuers.map(trustedIssuerResponse) }))
  })

  app.post('/', async (c) => {
    const issuer = await factory(c).createTrustedIssuer(await readJson(c, createManagementTrustedIssuerRequestSchema))
    return c.json(createManagementTrustedIssuerResponseSchema.parse({ issuer: trustedIssuerResponse(issuer) }), 201)
  })

  return app
}

function trustedIssuerResponse(
  issuer: Awaited<ReturnType<ReturnType<TokenExchangeServiceFactory>['createTrustedIssuer']>>,
) {
  return {
    id: issuer.id,
    name: issuer.name,
    issuer: issuer.issuer,
    jwksUrl: issuer.jwksUrl,
    sharedSecretConfigured: !!issuer.sharedSecret,
    allowedAudiences: issuer.allowedAudiences ?? [],
    enabled: issuer.enabled,
    metadata: issuer.metadata ?? {},
    createdAt: issuer.createdAt.toISOString(),
    updatedAt: issuer.updatedAt.toISOString(),
  }
}

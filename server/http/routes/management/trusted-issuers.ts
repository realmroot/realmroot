import type { TrustedExternalIssuerRecord } from '@server/usecases/ports'
import { createTrustedIssuer, listTrustedIssuers } from '@server/usecases/token-exchange'
import {
  createManagementTrustedIssuerRequestSchema,
  createManagementTrustedIssuerResponseSchema,
  listManagementTrustedIssuersResponseSchema,
} from '@shared/api/management'
import { Hono } from 'hono'
import { requireAdmin } from '../../middleware/admin'
import { getDeps } from '../../middleware/deps'
import { readJson } from '../validation'

export function createTrustedIssuerRoutes() {
  const app = new Hono()

  app.use('*', requireAdmin())

  app.get('/', async (c) => {
    const issuers = await listTrustedIssuers(getDeps(c))
    return c.json(listManagementTrustedIssuersResponseSchema.parse({ issuers: issuers.map(trustedIssuerResponse) }))
  })

  app.post('/', async (c) => {
    const issuer = await createTrustedIssuer(getDeps(c), await readJson(c, createManagementTrustedIssuerRequestSchema))
    return c.json(createManagementTrustedIssuerResponseSchema.parse({ issuer: trustedIssuerResponse(issuer) }), 201)
  })

  return app
}

function trustedIssuerResponse(issuer: TrustedExternalIssuerRecord) {
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

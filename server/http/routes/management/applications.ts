import {
  createApplication,
  deleteApplication,
  getApplication,
  listApplicationSecrets,
  listApplications,
  replaceRedirectUris,
  rotateApplicationSecret,
  updateApplication,
} from '@server/usecases/applications'
import type { FederatedCredentialRecord } from '@server/usecases/ports'
import {
  createFederatedCredential,
  deleteFederatedCredential,
  listFederatedCredentials,
  updateFederatedCredential,
} from '@server/usecases/token-exchange'
import {
  createApplicationRequestSchema,
  paginationQuerySchema,
  replaceRedirectUrisRequestSchema,
  updateApplicationRequestSchema,
} from '@shared/api/applications'
import {
  createManagementFederatedCredentialRequestSchema,
  createManagementFederatedCredentialResponseSchema,
  listManagementFederatedCredentialsResponseSchema,
  updateManagementFederatedCredentialRequestSchema,
} from '@shared/api/management'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { requireAdmin } from '../../middleware/admin'
import { getActorUserId } from '../../middleware/auth-context'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export const managementApplicationsRoute = new Hono()

managementApplicationsRoute.use('*', requireAdmin())

managementApplicationsRoute.get('/', async (c) => {
  const query = readQuery(c, paginationQuerySchema)
  return c.json(await listApplications(getDeps(c), issuerFor(c), query))
})

managementApplicationsRoute.post('/', async (c) => {
  const body = await readJson(c, createApplicationRequestSchema)
  const application = await createApplication(getDeps(c), issuerFor(c), body, getActorUserId(c))
  return c.json(application, 201)
})

managementApplicationsRoute.get('/:applicationId', async (c) => {
  const application = await getApplication(getDeps(c), issuerFor(c), c.req.param('applicationId'))
  return c.json(application)
})

managementApplicationsRoute.patch('/:applicationId', async (c) => {
  const body = await readJson(c, updateApplicationRequestSchema)
  const application = await updateApplication(getDeps(c), issuerFor(c), c.req.param('applicationId'), body)
  return c.json(application)
})

managementApplicationsRoute.delete('/:applicationId', async (c) => {
  await deleteApplication(getDeps(c), c.req.param('applicationId'))
  return c.body(null, 204)
})

managementApplicationsRoute.get('/:applicationId/redirect-uris', async (c) => {
  const application = await getApplication(getDeps(c), issuerFor(c), c.req.param('applicationId'))
  const pagination = readQuery(c, paginationQuerySchema)
  const redirectUris = application.redirectUris.slice(pagination.offset, pagination.offset + pagination.limit)
  return c.json({
    redirectUris,
    pagination: {
      ...pagination,
      total: application.redirectUris.length,
      hasMore: pagination.offset + pagination.limit < application.redirectUris.length,
      nextOffset:
        pagination.offset + pagination.limit < application.redirectUris.length
          ? pagination.offset + pagination.limit
          : null,
    },
  })
})

managementApplicationsRoute.put('/:applicationId/redirect-uris', async (c) => {
  const body = await readJson(c, replaceRedirectUrisRequestSchema)
  const application = await replaceRedirectUris(getDeps(c), issuerFor(c), c.req.param('applicationId'), body)
  return c.json({ redirectUris: application.redirectUris })
})

managementApplicationsRoute.get('/:applicationId/client-secrets', async (c) => {
  const query = readQuery(c, paginationQuerySchema)
  return c.json(await listApplicationSecrets(getDeps(c), c.req.param('applicationId'), query))
})

managementApplicationsRoute.post('/:applicationId/client-secrets', async (c) => {
  const secret = await rotateApplicationSecret(getDeps(c), c.req.param('applicationId'), getActorUserId(c))
  return c.json(secret, 201)
})

// Workload identity federation credentials are children of an application.
managementApplicationsRoute.get('/:applicationId/federated-credentials', async (c) => {
  const credentials = await listFederatedCredentials(getDeps(c), c.req.param('applicationId'))
  return c.json(
    listManagementFederatedCredentialsResponseSchema.parse({
      credentials: credentials.map(federatedCredentialResponse),
    }),
  )
})

managementApplicationsRoute.post('/:applicationId/federated-credentials', async (c) => {
  const body = await readJson(c, createManagementFederatedCredentialRequestSchema)
  const credential = await createFederatedCredential(getDeps(c), c.req.param('applicationId'), body)
  return c.json(
    createManagementFederatedCredentialResponseSchema.parse({ credential: federatedCredentialResponse(credential) }),
    201,
  )
})

managementApplicationsRoute.patch('/:applicationId/federated-credentials/:credentialId', async (c) => {
  const body = await readJson(c, updateManagementFederatedCredentialRequestSchema)
  const credential = await updateFederatedCredential(
    getDeps(c),
    c.req.param('applicationId'),
    c.req.param('credentialId'),
    body,
  )
  return c.json(
    createManagementFederatedCredentialResponseSchema.parse({ credential: federatedCredentialResponse(credential) }),
  )
})

managementApplicationsRoute.delete('/:applicationId/federated-credentials/:credentialId', async (c) => {
  await deleteFederatedCredential(getDeps(c), c.req.param('applicationId'), c.req.param('credentialId'))
  return c.body(null, 204)
})

function federatedCredentialResponse(credential: FederatedCredentialRecord) {
  return {
    id: credential.id,
    applicationId: credential.applicationId,
    name: credential.name,
    issuer: credential.issuer,
    subject: credential.subject,
    audienceResourceId: credential.audienceResourceId,
    jwksUrl: credential.jwksUrl,
    publicKeys: credential.publicKeys,
    enabled: credential.enabled,
    metadata: credential.metadata ?? {},
    createdAt: credential.createdAt.toISOString(),
    updatedAt: credential.updatedAt.toISOString(),
  }
}

function issuerFor(c: Context) {
  const url = new URL(c.req.url)
  return `${url.protocol}//${url.host}`
}

import { notFound } from '@server/domain/errors'
import {
  createApplication,
  deleteApplication,
  getApplication,
  getApplicationAuthorization,
  listApplicationAuthorizations,
  listApplicationSecrets,
  listApplications,
  putApplicationAuthorizationRevocation,
  replaceRedirectUris,
  rotateApplicationSecret,
  updateApplication,
} from '@server/usecases/applications'
import type { FederatedCredentialRecord } from '@server/usecases/ports'
import {
  createFederatedCredential,
  deleteFederatedCredential,
  getFederatedCredential,
  listFederatedCredentials,
  updateFederatedCredential,
} from '@server/usecases/token-exchange'
import { publishWebhookEvent } from '@server/usecases/webhooks'
import {
  type ApplicationResponse,
  applicationAuthorizationSchema,
  createApplicationRequestSchema,
  listApplicationAuthorizationsQuerySchema,
  listApplicationAuthorizationsResponseSchema,
  listApplicationsQuerySchema,
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
import { getActorUserId } from '../../middleware/authn'
import {
  authorizedOrganizationIds,
  authorizedOrganizationOwnerId,
  authorizeOrganization,
  authorizeOrganizationOwner,
} from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export const managementApplicationsRoute = new Hono()

managementApplicationsRoute.get('/', async (c) => {
  const query = readQuery(c, listApplicationsQuerySchema)
  return c.json(
    await listApplications(
      getDeps(c),
      issuerFor(c),
      query,
      await filterOrganizationSelection(c, query.ownerOrganizationId, 'applications:read'),
    ),
  )
})

managementApplicationsRoute.get('/:id/authorizations', async (c) => {
  await requireApplicationAccess(c, c.req.param('id'))
  const query = readQuery(c, listApplicationAuthorizationsQuerySchema)
  return c.json(
    listApplicationAuthorizationsResponseSchema.parse(
      await listApplicationAuthorizations(
        getDeps(c),
        { ...query, applicationId: c.req.param('id') },
        await authorizedOrganizationIds(c, 'applications:read'),
      ),
    ),
  )
})

managementApplicationsRoute.get('/:id/authorizations/:authorizationId', async (c) => {
  const authorization = await requireNestedApplicationAuthorization(c)
  return c.json(applicationAuthorizationSchema.parse(authorization))
})

managementApplicationsRoute.delete('/:id/authorizations/:authorizationId', async (c) => {
  await requireNestedApplicationAuthorization(c)
  await putApplicationAuthorizationRevocation(getDeps(c), c.req.param('authorizationId'))
  return c.body(null, 204)
})

managementApplicationsRoute.post('/', async (c) => {
  const body = await readJson(c, createApplicationRequestSchema)
  const owner = await authorizeOrganizationOwner(c, body.ownerOrganizationId, 'applications:write')
  const application = await createApplication(
    getDeps(c),
    issuerFor(c),
    { ...body, ownerOrganizationId: authorizedOrganizationOwnerId(owner) },
    getActorUserId(c),
  )
  await publishWebhookEvent(getDeps(c), 'application.created', { application: applicationWebhookData(application) })
  c.header('Location', `/api/applications/${encodeURIComponent(application.id)}`)
  return c.json(application, 201)
})

managementApplicationsRoute.get('/:applicationId', async (c) => {
  const application = await requireApplicationAccess(c)
  return c.json(application)
})

managementApplicationsRoute.patch('/:applicationId', async (c) => {
  await requireApplicationAccess(c)
  const body = await readJson(c, updateApplicationRequestSchema)
  const owner = body.ownerOrganizationId
    ? await authorizeOrganizationOwner(c, body.ownerOrganizationId, 'applications:write')
    : null
  const application = await updateApplication(getDeps(c), issuerFor(c), c.req.param('applicationId'), {
    ...body,
    ...(owner ? { ownerOrganizationId: authorizedOrganizationOwnerId(owner) } : {}),
  })
  await publishWebhookEvent(getDeps(c), 'application.updated', { application: applicationWebhookData(application) })
  return c.json(application)
})

managementApplicationsRoute.delete('/:applicationId', async (c) => {
  await requireApplicationAccess(c)
  await deleteApplication(getDeps(c), c.req.param('applicationId'))
  return c.body(null, 204)
})

managementApplicationsRoute.get('/:applicationId/redirect-uris', async (c) => {
  const application = await requireApplicationAccess(c)
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
  await requireApplicationAccess(c)
  const body = await readJson(c, replaceRedirectUrisRequestSchema)
  const application = await replaceRedirectUris(getDeps(c), issuerFor(c), c.req.param('applicationId'), body)
  await publishWebhookEvent(getDeps(c), 'application.updated', { application: applicationWebhookData(application) })
  return c.json({ redirectUris: application.redirectUris })
})

function applicationWebhookData(application: ApplicationResponse) {
  return {
    id: application.id,
    slug: application.slug,
    name: application.name,
    description: application.description,
    homepageUrl: application.homepageUrl,
    iconUrl: application.iconUrl,
    clientId: application.clientId,
    clientType: application.clientType,
    firstParty: application.firstParty,
    trusted: application.trusted,
    disabled: application.disabled,
    ownerOrganizationId: application.ownerOrganizationId,
    allowedGrantTypes: application.allowedGrantTypes,
    oidcScopes: application.oidcScopes,
    resourceScopes: application.resourceScopes,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
  }
}

managementApplicationsRoute.get('/:applicationId/client-secrets', async (c) => {
  await requireApplicationAccess(c)
  const query = readQuery(c, paginationQuerySchema)
  return c.json(await listApplicationSecrets(getDeps(c), c.req.param('applicationId'), query))
})

managementApplicationsRoute.post('/:applicationId/client-secrets', async (c) => {
  await requireApplicationAccess(c)
  const secret = await rotateApplicationSecret(getDeps(c), c.req.param('applicationId'), getActorUserId(c))
  return c.json(secret, 201)
})

// Workload identity federation credentials are children of an application.
managementApplicationsRoute.get('/:applicationId/federated-credentials', async (c) => {
  await requireApplicationAccess(c)
  const credentials = await listFederatedCredentials(getDeps(c), c.req.param('applicationId'))
  return c.json(
    listManagementFederatedCredentialsResponseSchema.parse({
      credentials: credentials.map(federatedCredentialResponse),
    }),
  )
})

managementApplicationsRoute.post('/:applicationId/federated-credentials', async (c) => {
  await requireApplicationAccess(c)
  const body = await readJson(c, createManagementFederatedCredentialRequestSchema)
  const credential = await createFederatedCredential(getDeps(c), c.req.param('applicationId'), body)
  return c.json(
    createManagementFederatedCredentialResponseSchema.parse({ credential: federatedCredentialResponse(credential) }),
    201,
  )
})

managementApplicationsRoute.get('/:applicationId/federated-credentials/:credentialId', async (c) => {
  await requireApplicationAccess(c)
  const credential = await getFederatedCredential(getDeps(c), c.req.param('applicationId'), c.req.param('credentialId'))
  return c.json(
    createManagementFederatedCredentialResponseSchema.parse({ credential: federatedCredentialResponse(credential) }),
  )
})

managementApplicationsRoute.patch('/:applicationId/federated-credentials/:credentialId', async (c) => {
  await requireApplicationAccess(c)
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
  await requireApplicationAccess(c)
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

async function requireApplicationAccess(c: Context, applicationId = c.req.param('applicationId')!) {
  const application = await getApplication(getDeps(c), issuerFor(c), applicationId)
  await authorizeOrganization(
    c,
    application.ownerOrganizationId,
    c.req.method === 'GET' || c.req.method === 'HEAD' ? 'applications:read' : 'applications:write',
  )
  return application
}

async function requireNestedApplicationAuthorization(c: Context) {
  await requireApplicationAccess(c, c.req.param('id'))
  const authorization = await getApplicationAuthorization(getDeps(c), c.req.param('authorizationId')!)
  if (authorization.applicationId !== c.req.param('id')) {
    throw notFound('Application authorization was not found.')
  }
  return authorization
}

async function filterOrganizationSelection(
  c: Context,
  requestedOrganizationId: string | undefined,
  scope: 'applications:read',
) {
  const allowed = await authorizedOrganizationIds(c, scope)
  if (!allowed) return requestedOrganizationId ? [requestedOrganizationId] : undefined
  if (!requestedOrganizationId) return allowed
  return allowed.includes(requestedOrganizationId) ? [requestedOrganizationId] : []
}

import { badRequest, forbidden, payloadTooLarge, unauthorized } from '@server/domain/errors'
import { getPrincipal } from '@server/http/middleware/authn'
import { applyProviderConnectionEvent } from '@server/usecases/provider-connection-events'
import { providerConnectionEventIdSchema, providerConnectionEventSchema } from '@shared/api/external-resources'
import { Hono } from 'hono'
import { getDeps } from '../middleware/deps'
import { readParam } from './validation'

export function createProviderConnectionEventRoutes() {
  const app = new Hono()

  app.put('/:resourceServerId/connection-events/:eventId', async (c) => {
    const resourceServer = await getDeps(c).authorization.findResource(c.req.param('resourceServerId'))
    if (!resourceServer) throw unauthorized('Connection Event credentials are invalid.')
    const application = getPrincipal(c).application
    if (!application) throw unauthorized('Application authentication is required.')
    if (!application.scopes.includes('connection-events:write')) {
      throw forbidden('OAuth scope "connection-events:write" is required.')
    }
    if (application.ownerOrganizationId !== resourceServer.ownerOrganizationId) {
      throw forbidden('The Application cannot publish events for this Resource Server.')
    }
    const eventId = readParam(c, 'eventId', providerConnectionEventIdSchema)
    const rawBody = await readLimitedBody(c.req.raw)
    let representation: unknown
    try {
      representation = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody))
    } catch {
      throw badRequest('Invalid JSON body.')
    }
    const parsed = providerConnectionEventSchema.safeParse(representation)
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid Connection Event representation.')
    await applyProviderConnectionEvent(getDeps(c), eventId, resourceServer.resourceUrl, parsed.data, rawBody)
    return c.body(null, 204)
  })

  return app
}

const maximumEventBodyBytes = 64 * 1024

async function readLimitedBody(request: Request) {
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maximumEventBodyBytes) {
    throw payloadTooLarge('Connection Event representations cannot exceed 64 KiB.')
  }
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.length
    if (length > maximumEventBodyBytes) {
      await reader.cancel()
      throw payloadTooLarge('Connection Event representations cannot exceed 64 KiB.')
    }
    chunks.push(value)
  }
  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.length
  }
  return body
}

import { badRequest, payloadTooLarge, unauthorized } from '@server/domain/errors'
import { authenticateProviderConnectionEvent } from '@server/http/provider-connection-event-auth'
import { applyProviderConnectionEvent } from '@server/usecases/provider-connection-events'
import { providerConnectionEventIdSchema, providerConnectionEventSchema } from '@shared/api/external-resources'
import { Hono } from 'hono'
import { getDeps } from '../middleware/deps'
import { readParam } from './validation'

export function createProviderConnectionEventRoutes(secrets: Record<string, string>) {
  const app = new Hono()

  app.put('/:eventId', async (c) => {
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
    const secret = secrets[parsed.data.resource]
    if (!secret) throw unauthorized('Connection Event credentials are invalid.')
    await authenticateProviderConnectionEvent(c.req.raw, rawBody, secret)
    await applyProviderConnectionEvent(getDeps(c), eventId, parsed.data, rawBody)
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

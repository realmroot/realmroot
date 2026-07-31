import { getAgentInfo } from '@server/usecases/agent-identities'
import { agentInfoQuerySchema, agentInfoSchema } from '@shared/api/agent-api'
import { Hono } from 'hono'
import { getDeps } from '../middleware/deps'
import { readQuery } from './validation'

const cacheControl = 'public, max-age=300'

export function createAgentInfoRoutes(resolveIssuer: (requestUrl: string) => string) {
  const app = new Hono()

  app.get('/', async (c) => {
    const issuer = resolveIssuer(c.req.url)
    const { sub } = readQuery(c, agentInfoQuerySchema)
    const info = agentInfoSchema.parse(await getAgentInfo(getDeps(c), issuer, sub))
    const etag = `"${info.sub}:${info.updated_at}"`

    c.header('Access-Control-Allow-Origin', '*')
    c.header('Cache-Control', cacheControl)
    c.header('ETag', etag)
    if (matchesEtag(c.req.header('If-None-Match'), etag)) return c.body(null, 304)
    return c.json(info)
  })

  return app
}

function matchesEtag(header: string | undefined, etag: string) {
  return header?.split(',').some((value) => value.trim() === etag || value.trim() === '*') ?? false
}

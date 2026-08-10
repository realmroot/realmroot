import { getPublicAgentProfile, getPublicUserProfile } from '@server/usecases/public-profiles'
import { agentSubjectSchema } from '@shared/api/identifiers'
import {
  publicAgentResponseSchema,
  publicProfileQuerySchema,
  publicUserResponseSchema,
} from '@shared/api/public-profiles'
import { usernameSchema } from '@shared/api/users'
import { type Context, Hono } from 'hono'
import { getDeps } from '../middleware/deps'
import { readParam, readQuery } from './validation'

const publicProfileCacheControl = 'public, max-age=60, stale-while-revalidate=300'
export function createPublicProfileRoutes(resolveIssuer: (requestUrl: string) => string) {
  const app = new Hono()

  app.get('/users/:username', async (c) => {
    const username = readParam(c, 'username', usernameSchema)
    const { view } = readQuery(c, publicProfileQuerySchema)
    const profile = publicUserResponseSchema.parse(
      await getPublicUserProfile(getDeps(c), username, view, new URL(c.req.url).origin),
    )
    return publicProfileResponse(c, profile)
  })

  app.get('/agents/:subject', async (c) => {
    const subject = readParam(c, 'subject', agentSubjectSchema)
    const { view } = readQuery(c, publicProfileQuerySchema)
    const profile = publicAgentResponseSchema.parse(
      await getPublicAgentProfile(getDeps(c), resolveIssuer(c.req.url), subject, view),
    )
    return publicProfileResponse(c, profile)
  })

  return app
}

async function publicProfileResponse(c: Context, profile: object) {
  const etag = await representationEtag(profile)
  c.header('Cache-Control', publicProfileCacheControl)
  c.header('ETag', etag)
  if (matchesEtag(c.req.header('If-None-Match'), etag)) return c.body(null, 304)
  return c.json(profile)
}

async function representationEtag(profile: object) {
  const bytes = new TextEncoder().encode(JSON.stringify(profile))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `"${hex}"`
}

function matchesEtag(header: string | undefined, etag: string) {
  return header?.split(',').some((value) => value.trim() === etag || value.trim() === '*') ?? false
}

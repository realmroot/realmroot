import { unauthorized } from '@server/domain/errors'
import type { AppConfig } from './app-types'

type RequestOriginConfig = Pick<AppConfig, 'baseURL' | 'trustedOrigins'>

export function trustedRequestUrl(config: RequestOriginConfig, requestUrl: string) {
  const request = new URL(requestUrl)
  const trustedOrigins = config.trustedOrigins?.length
    ? config.trustedOrigins
    : config.baseURL
      ? [config.baseURL]
      : [request.origin]

  if (trustedOrigins.includes(request.origin)) return request

  const matchingOrigins = trustedOrigins.filter((origin) => new URL(origin).host === request.host)
  if (matchingOrigins.length !== 1) throw unauthorized('Request origin is not trusted.')

  const trustedOrigin = new URL(matchingOrigins[0]!)
  request.protocol = trustedOrigin.protocol
  request.host = trustedOrigin.host
  return request
}

export function trustedRequestOrigin(config: RequestOriginConfig, requestUrl: string) {
  return trustedRequestUrl(config, requestUrl).origin
}

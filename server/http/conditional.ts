import { preconditionFailed, preconditionRequired } from '@server/domain/errors'

export async function representationWithEtag<T>(representation: T) {
  const bytes = new TextEncoder().encode(JSON.stringify(representation))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const hash = [...digest].map((value) => value.toString(16).padStart(2, '0')).join('')
  return { representation, etag: `"${hash}"` }
}

export function requireMatchingIfMatch(header: string | undefined, currentEtag: string, resourceName: string) {
  if (!header) throw preconditionRequired(`If-Match is required when updating ${resourceName}.`)
  const matches = header
    .split(',')
    .map((value) => value.trim())
    .some((value) => value === '*' || value === currentEtag)
  if (!matches) throw preconditionFailed(`${resourceName} changed after it was read.`)
}

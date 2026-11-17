import { parse } from 'tldts'

// A registered redirect URI, post sign-out redirect URI, or CORS origin may carry one
// wildcard that stands for the leftmost host label or that label's prefix, e.g.
// `https://*-app.example.com/callback`. Everything else in the value is matched exactly.

const wildcard = '*'
const wildcardPrefix = `https://${wildcard}`
const labelSuffixPattern = /^[a-z0-9-]*$/
const matchedPrefixPattern = /^[a-z0-9-]+$/
const dnsLabelPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const maxDnsLabelLength = 63
const samplePrefix = 'x'

export function hasWildcard(value: string) {
  return value.includes(wildcard)
}

/**
 * Explains why a value containing `*` is not an honored wildcard pattern, or returns
 * null when it is. Values without `*` are not patterns and return null.
 */
export function wildcardPatternProblem(value: string): string | null {
  if (!hasWildcard(value)) return null
  if (value.indexOf(wildcard) !== value.lastIndexOf(wildcard)) return 'may contain only one "*".'
  if (!value.startsWith(wildcardPrefix)) {
    return 'may use "*" only at the start of the leftmost host label of an HTTPS URL, such as https://*-app.example.com.'
  }

  const sample = `https://${samplePrefix}${value.slice(wildcardPrefix.length)}`
  if (sample.includes('#')) return 'must not include fragments.'
  let url: URL
  try {
    url = new URL(sample)
  } catch {
    return 'must be absolute URLs.'
  }
  const authority = sample.slice('https://'.length)
  const authorityEnd = authority.search(/[/?#]/)
  const rawHost = authorityEnd === -1 ? authority : authority.slice(0, authorityEnd)
  if (url.username || url.password || rawHost !== url.host) {
    return 'must write a wildcard host in canonical form: lowercase, no default port, and no user information.'
  }

  const firstDot = url.hostname.indexOf('.')
  const labelSuffix = url.hostname.slice(samplePrefix.length, firstDot === -1 ? undefined : firstDot)
  if (firstDot === -1 || !labelSuffixPattern.test(labelSuffix)) {
    return 'may use "*" only for the leftmost host label or its prefix, never across dots.'
  }

  const fixedSuffix = parse(url.hostname.slice(firstDot + 1), { allowPrivateDomains: true })
  if (fixedSuffix.isIp || !fixedSuffix.domain) {
    return 'must keep a wildcard host under a registrable domain, not directly under a public suffix.'
  }
  return null
}

/**
 * Whether a requested URI or origin is covered by a registered value: an exact match,
 * or a match of a well-formed wildcard pattern where `*` expands to the non-empty prefix
 * of one DNS label. Stored values that are not well-formed patterns only match exactly.
 */
export function matchesRegisteredUri(registered: string, requested: string) {
  if (registered === requested) return true
  if (!hasWildcard(registered) || wildcardPatternProblem(registered) !== null) return false

  const tail = registered.slice(wildcardPrefix.length)
  if (!requested.startsWith('https://') || !requested.endsWith(tail)) return false
  const matchedPrefix = requested.slice('https://'.length, requested.length - tail.length)
  if (!matchedPrefixPattern.test(matchedPrefix)) return false

  const firstDot = tail.indexOf('.')
  const label = matchedPrefix + tail.slice(0, firstDot)
  return label.length <= maxDnsLabelLength && dnsLabelPattern.test(label)
}

export function matchesAnyRegisteredUri(registered: readonly string[], requested: string) {
  return registered.some((value) => matchesRegisteredUri(value, requested))
}

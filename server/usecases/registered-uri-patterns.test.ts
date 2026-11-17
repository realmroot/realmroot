import { describe, expect, it } from 'vitest'
import { matchesAnyRegisteredUri, matchesRegisteredUri, wildcardPatternProblem } from './registered-uri-patterns'

describe('registered URI wildcard patterns', () => {
  it.each([
    'https://*-app.example.com/callback',
    'https://*.preview.example.com/callback',
    'https://*-bstack-playground.saltbo.workers.dev/callback',
    'https://*-app.example.com',
    'https://*-app.example.com:8443/callback?mode=spa',
    'https://*.example.co.uk/',
    'https://app.example.com/callback',
  ])('accepts %s [spec: management-api/management-application-wildcard-uris]', (value) => {
    expect(wildcardPatternProblem(value)).toBeNull()
  })

  it.each([
    ['https://*-*.example.com/callback', 'may contain only one "*".'],
    ['http://*-app.example.com/callback', 'at the start of the leftmost host label'],
    ['https://app-*.example.com/callback', 'at the start of the leftmost host label'],
    ['https://app.*.example.com/callback', 'at the start of the leftmost host label'],
    ['https://app.example.com/*', 'at the start of the leftmost host label'],
    ['https://app.example.com/callback?branch=*', 'at the start of the leftmost host label'],
    ['https://app.example.com:*/callback', 'at the start of the leftmost host label'],
    ['*://app.example.com/callback', 'at the start of the leftmost host label'],
    ['com.example.app://*/callback', 'at the start of the leftmost host label'],
    ['https://*-app.example.com/callback#done', 'must not include fragments.'],
    ['https://*-app.example.com:99999/callback', 'must be absolute URLs.'],
    ['https://*-App.example.com/callback', 'canonical form'],
    ['https://*-app.example.com:443/callback', 'canonical form'],
    ['https://*user@app.example.com/callback', 'canonical form'],
    ['https://*-app/callback', 'never across dots'],
    ['https://*_app.example.com/callback', 'never across dots'],
    ['https://*.workers.dev/callback', 'not directly under a public suffix'],
    ['https://*-app.workers.dev/callback', 'not directly under a public suffix'],
    ['https://*.com/callback', 'not directly under a public suffix'],
    ['https://*.co.uk/callback', 'not directly under a public suffix'],
    ['https://*.localhost/callback', 'not directly under a public suffix'],
  ])('rejects %s [spec: management-api/management-application-wildcard-uris]', (value, problem) => {
    expect(wildcardPatternProblem(value)).toContain(problem)
  })

  it.each([
    ['https://*-app.example.com/callback', 'https://feature-1-app.example.com/callback'],
    ['https://*-app.example.com/callback', 'https://a-app.example.com/callback'],
    ['https://*.preview.example.com/callback', 'https://main.preview.example.com/callback'],
    ['https://*-app.example.com', 'https://feature-1-app.example.com'],
    ['https://*-app.example.com:8443/callback?mode=spa', 'https://pr-7-app.example.com:8443/callback?mode=spa'],
    ['https://app.example.com/callback', 'https://app.example.com/callback'],
    ['com.example.app:/callback', 'com.example.app:/callback'],
  ])('matches %s to %s [spec: hosted-auth/oidc-preview-wildcard-redirect]', (registered, requested) => {
    expect(matchesRegisteredUri(registered, requested)).toBe(true)
  })

  it.each([
    ['https://*-app.example.com/callback', 'https://-app.example.com/callback'],
    ['https://*-app.example.com/callback', 'https://a.b-app.example.com/callback'],
    ['https://*-app.example.com/callback', 'https://evil.com/x-app.example.com/callback'],
    ['https://*-app.example.com/callback', 'https://evil.com?-app.example.com/callback'],
    ['https://*-app.example.com/callback', 'https://user@x-app.example.com/callback'],
    ['https://*-app.example.com/callback', 'https://Feature-app.example.com/callback'],
    ['https://*-app.example.com/callback', 'http://feature-app.example.com/callback'],
    ['https://*-app.example.com/callback', 'https://feature-app.example.com:8443/callback'],
    ['https://*-app.example.com/callback', 'https://feature-app.example.com/callback/extra'],
    ['https://*-app.example.com/callback', 'https://feature-app.example.com/callback?x=1'],
    ['https://*-app.example.com/callback', 'https://feature-app.example.org/callback'],
    ['https://*-app.example.com/callback', 'https://featureapp.example.com/callback'],
    ['https://*-app.example.com/callback', `https://${'a'.repeat(60)}-app.example.com/callback`],
    ['https://*.preview.example.com/callback', 'https://-.preview.example.com/callback'],
    ['https://*.preview.example.com/callback', 'https://main-.preview.example.com/callback'],
    ['https://*.preview.example.com/callback', 'https://preview.example.com/callback'],
    ['https://*.workers.dev/callback', 'https://attacker.workers.dev/callback'],
    ['https://*-*.example.com/callback', 'https://a-b.example.com/callback'],
    ['https://app.example.com/callback', 'https://app.example.com/callback/'],
    ['https://app.example.com/callback', 'https://other.example.com/callback'],
  ])('does not match %s to %s [spec: hosted-auth/oidc-preview-wildcard-redirect]', (registered, requested) => {
    expect(matchesRegisteredUri(registered, requested)).toBe(false)
  })

  it('matches against any registered value', () => {
    const registered = ['https://app.example.com/callback', 'https://*-app.example.com/callback']
    expect(matchesAnyRegisteredUri(registered, 'https://pr-1-app.example.com/callback')).toBe(true)
    expect(matchesAnyRegisteredUri(registered, 'https://app.example.com/callback')).toBe(true)
    expect(matchesAnyRegisteredUri(registered, 'https://pr-1.example.com/callback')).toBe(false)
    expect(matchesAnyRegisteredUri([], 'https://app.example.com/callback')).toBe(false)
  })
})

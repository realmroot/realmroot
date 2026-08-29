import { readFileSync } from 'node:fs'
import { realmrootOrganizationClaim } from '@shared/oauth-token-profile'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

describe('Kubernetes Realmroot authentication fixture', () => {
  it('maps the verified OIDC identity contract to Kubernetes users and groups', () => {
    const fixture = parse(
      readFileSync(new URL('../examples/kubernetes/realmroot-authentication.yaml', import.meta.url), 'utf8'),
    ) as {
      apiVersion: string
      kind: string
      jwt: Array<{
        issuer: { audiences: string[] }
        claimValidationRules: Array<{ expression: string }>
        claimMappings: { username: { claim: string }; groups: { claim: string }; uid: { claim: string } }
      }>
    }
    const authentication = fixture.jwt[0]!

    expect(fixture).toMatchObject({ apiVersion: 'apiserver.config.k8s.io/v1', kind: 'AuthenticationConfiguration' })
    expect(authentication.issuer.audiences).toEqual(['KUBERNETES_APPLICATION_CLIENT_ID'])
    expect(authentication.claimValidationRules.map(({ expression }) => expression)).toEqual(
      expect.arrayContaining([
        `claims['${realmrootOrganizationClaim}'] == 'REALMROOT_ORGANIZATION_ID'`,
        'has(claims.act) && has(claims.act.iss) && has(claims.act.sub)',
      ]),
    )
    expect(authentication.claimMappings).toMatchObject({
      username: { claim: 'sub' },
      groups: { claim: 'groups' },
      uid: { claim: 'sub' },
    })
  })
})

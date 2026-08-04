import { conflict } from '@server/domain/errors'
import {
  type SecurityPolicy,
  type SecurityPolicyResponse,
  securityPolicyResponseSchema,
  updateSecurityPolicySchema,
} from '@shared/api/security'
import { Hono } from 'hono'
import { getPrincipal } from '../../middleware/authn'
import { getDeps } from '../../middleware/deps'
import { readJson } from '../validation'

export function managementSecurityRoutes() {
  const app = new Hono()

  app.get('/', async (c) => c.json({ policy: managementSecurityPolicy(await getDeps(c).security.getPolicy()) }))

  app.patch('/', async (c) => {
    const deps = getDeps(c)
    const input = await readJson(c, updateSecurityPolicySchema)
    const current = await deps.security.getPolicy()
    if (current.mfa.mode !== 'required' && input.policy.mfa?.mode === 'required') {
      const user = getPrincipal(c).user
      if (!user || !(await deps.security.getSecurityState(user.id)).mfa.enabled) {
        throw conflict('Enroll MFA for your operator account before requiring it for the Realm.')
      }
    }
    const policy = await deps.security.updatePolicy(input)
    return c.json({ policy: managementSecurityPolicy(policy) })
  })

  return app
}

function managementSecurityPolicy(policy: SecurityPolicy): SecurityPolicyResponse {
  return securityPolicyResponseSchema.parse({
    ...policy,
    captcha: {
      enabled: policy.captcha.enabled,
      provider: policy.captcha.provider,
      siteKey: policy.captcha.siteKey,
      projectId: policy.captcha.projectId,
      secretConfigured: Boolean(policy.captcha.secretKey || policy.captcha.legacySecretBinding),
    },
  })
}

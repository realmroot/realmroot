import {
  getDeveloperConsoleAccessPolicy,
  getEmailDeliveryConfiguration,
  getManagementAccountCenterSettings,
  getManagementBrandingSettings,
  getManagementRealm,
  getManagementSignInSettings,
  getOrganizationCreationPolicy,
  replaceDeveloperConsoleAccessPolicy,
  replaceEmailDeliveryConfiguration,
  replaceOrganizationCreationPolicy,
  updateManagementAccountCenterSettings,
  updateManagementBrandingSettings,
  updateManagementRealm,
  updateManagementSignInSettings,
} from '@server/usecases/configz'
import {
  developerConsoleAccessPolicyResponseSchema,
  emailDeliveryConfigurationResponseSchema,
  managementAccountCenterSettingsResponseSchema,
  managementBrandingSettingsResponseSchema,
  managementRealmResponseSchema,
  managementSignInSettingsResponseSchema,
  organizationCreationPolicyResponseSchema,
  replaceDeveloperConsoleAccessPolicyRequestSchema,
  replaceEmailDeliveryConfigurationRequestSchema,
  replaceOrganizationCreationPolicyRequestSchema,
  updateManagementAccountCenterSettingsRequestSchema,
  updateManagementBrandingSettingsRequestSchema,
  updateManagementRealmRequestSchema,
  updateManagementSignInSettingsRequestSchema,
} from '@shared/api/management'
import { siteNavigationResponseSchema, siteNavigationSchema } from '@shared/api/navigation'
import type { SecurityPolicy } from '@shared/api/security'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { configzOptions } from '../../app-config'
import { representationWithEtag, requireMatchingIfMatch } from '../../conditional'
import { authorizePlatformOrganization } from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import { readJson } from '../validation'

export function createManagementSettingsRoutes(securityPolicy?: SecurityPolicy) {
  const app = new Hono()

  const requireRealmAccess = async (c: Context, next: () => Promise<void>) => {
    await authorizePlatformOrganization(c, c.req.method === 'GET' ? 'settings:read' : 'settings:write')
    await next()
  }
  app.use('/realm', requireRealmAccess)
  app.use('/realm/*', requireRealmAccess)

  app.get('/realm/navigation', async (c) =>
    versionedResponse(c, siteNavigationResponseSchema.parse(await getDeps(c).configz.getNavigation())),
  )
  app.put('/realm/navigation', async (c) => {
    const repository = getDeps(c).configz
    const current = await repository.getNavigation()
    const representation = await representationWithEtag(current)
    requireMatchingIfMatch(c.req.header('If-Match'), representation.etag, 'Site navigation')
    const input = await readJson(c, siteNavigationSchema)
    await repository.replaceNavigation(input, current.revision)
    return versionedResponse(c, siteNavigationResponseSchema.parse(await repository.getNavigation()))
  })

  app.get('/realm/sign-in-policy', async (c) => {
    const response = await getManagementSignInSettings(getDeps(c), configzOptions(c, securityPolicy))
    return c.json(managementSignInSettingsResponseSchema.parse(response))
  })
  app.patch('/realm/sign-in-policy', async (c) => {
    const input = await readJson(c, updateManagementSignInSettingsRequestSchema)
    const response = await updateManagementSignInSettings(getDeps(c), configzOptions(c, securityPolicy), input)
    return c.json(managementSignInSettingsResponseSchema.parse(response))
  })

  app.get('/realm/branding', async (c) => {
    const response = await getManagementBrandingSettings(getDeps(c), configzOptions(c, securityPolicy))
    return c.json(managementBrandingSettingsResponseSchema.parse(response))
  })
  app.patch('/realm/branding', async (c) => {
    const input = await readJson(c, updateManagementBrandingSettingsRequestSchema)
    const response = await updateManagementBrandingSettings(getDeps(c), configzOptions(c, securityPolicy), input)
    return c.json(managementBrandingSettingsResponseSchema.parse(response))
  })

  app.get('/realm/account-management-policy', async (c) => {
    const response = await getManagementAccountCenterSettings(getDeps(c), configzOptions(c, securityPolicy))
    return c.json(managementAccountCenterSettingsResponseSchema.parse(response))
  })
  app.patch('/realm/account-management-policy', async (c) => {
    const input = await readJson(c, updateManagementAccountCenterSettingsRequestSchema)
    const response = await updateManagementAccountCenterSettings(getDeps(c), configzOptions(c, securityPolicy), input)
    return c.json(managementAccountCenterSettingsResponseSchema.parse(response))
  })

  app.get('/realm/organization-creation-policy', async (c) =>
    versionedResponse(
      c,
      organizationCreationPolicyResponseSchema.parse(await getOrganizationCreationPolicy(getDeps(c))),
    ),
  )
  app.put('/realm/organization-creation-policy', async (c) => {
    const current = await representationWithEtag(
      organizationCreationPolicyResponseSchema.parse(await getOrganizationCreationPolicy(getDeps(c))),
    )
    requireMatchingIfMatch(c.req.header('If-Match'), current.etag, 'Organization creation policy')
    const input = await readJson(c, replaceOrganizationCreationPolicyRequestSchema)
    return versionedResponse(
      c,
      organizationCreationPolicyResponseSchema.parse(await replaceOrganizationCreationPolicy(getDeps(c), input)),
    )
  })

  app.get('/realm/developer-console-access-policy', async (c) =>
    versionedResponse(
      c,
      developerConsoleAccessPolicyResponseSchema.parse(await getDeveloperConsoleAccessPolicy(getDeps(c))),
    ),
  )
  app.put('/realm/developer-console-access-policy', async (c) => {
    const current = await representationWithEtag(
      developerConsoleAccessPolicyResponseSchema.parse(await getDeveloperConsoleAccessPolicy(getDeps(c))),
    )
    requireMatchingIfMatch(c.req.header('If-Match'), current.etag, 'Developer Console access policy')
    const input = await readJson(c, replaceDeveloperConsoleAccessPolicyRequestSchema)
    return versionedResponse(
      c,
      developerConsoleAccessPolicyResponseSchema.parse(await replaceDeveloperConsoleAccessPolicy(getDeps(c), input)),
    )
  })

  app.get('/realm', async (c) =>
    versionedResponse(
      c,
      managementRealmResponseSchema.parse(await getManagementRealm(getDeps(c), configzOptions(c, securityPolicy))),
    ),
  )
  app.patch('/realm', async (c) => {
    const current = await representationWithEtag(
      managementRealmResponseSchema.parse(await getManagementRealm(getDeps(c), configzOptions(c, securityPolicy))),
    )
    requireMatchingIfMatch(c.req.header('If-Match'), current.etag, 'Realm')
    const input = await readJson(c, updateManagementRealmRequestSchema)
    return versionedResponse(
      c,
      managementRealmResponseSchema.parse(
        await updateManagementRealm(getDeps(c), configzOptions(c, securityPolicy), input),
      ),
    )
  })

  app.get('/realm/email-delivery-configuration', async (c) =>
    versionedResponse(
      c,
      emailDeliveryConfigurationResponseSchema.parse(
        await getEmailDeliveryConfiguration(getDeps(c), configzOptions(c, securityPolicy)),
      ),
    ),
  )
  app.put('/realm/email-delivery-configuration', async (c) => {
    const current = await representationWithEtag(
      emailDeliveryConfigurationResponseSchema.parse(
        await getEmailDeliveryConfiguration(getDeps(c), configzOptions(c, securityPolicy)),
      ),
    )
    requireMatchingIfMatch(c.req.header('If-Match'), current.etag, 'Email delivery configuration')
    const input = await readJson(c, replaceEmailDeliveryConfigurationRequestSchema)
    return versionedResponse(
      c,
      emailDeliveryConfigurationResponseSchema.parse(
        await replaceEmailDeliveryConfiguration(getDeps(c), configzOptions(c, securityPolicy), input),
      ),
    )
  })

  return app
}

async function versionedResponse<T>(c: Context, representation: T) {
  const current = await representationWithEtag(representation)
  c.header('Cache-Control', 'private, no-store, no-transform')
  c.header('ETag', current.etag)
  return c.json(current.representation)
}

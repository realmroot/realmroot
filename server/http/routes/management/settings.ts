import {
  getManagementAccountCenterSettings,
  getManagementBrandingSettings,
  getManagementDeveloperSettings,
  getManagementEmailSettings,
  getManagementGeneralSettings,
  getManagementSignInSettings,
  updateManagementAccountCenterSettings,
  updateManagementBrandingSettings,
  updateManagementDeveloperSettings,
  updateManagementEmailSettings,
  updateManagementGeneralSettings,
  updateManagementSignInSettings,
} from '@server/usecases/configz'
import {
  managementAccountCenterSettingsResponseSchema,
  managementBrandingSettingsResponseSchema,
  managementDeveloperSettingsResponseSchema,
  managementEmailSettingsResponseSchema,
  managementGeneralSettingsResponseSchema,
  managementSignInSettingsResponseSchema,
  updateManagementAccountCenterSettingsRequestSchema,
  updateManagementBrandingSettingsRequestSchema,
  updateManagementDeveloperSettingsRequestSchema,
  updateManagementEmailSettingsRequestSchema,
  updateManagementGeneralSettingsRequestSchema,
  updateManagementSignInSettingsRequestSchema,
} from '@shared/api/management'
import type { SecurityPolicy } from '@shared/api/security'
import { Hono } from 'hono'
import { configzOptions } from '../../app-config'
import { getDeps } from '../../middleware/deps'
import { readJson } from '../validation'

export function createManagementSettingsRoutes(securityPolicy?: SecurityPolicy) {
  const app = new Hono()

  app.get('/sign-in-settings', async (c) => {
    const response = await getManagementSignInSettings(getDeps(c), configzOptions(c, securityPolicy))
    return c.json(managementSignInSettingsResponseSchema.parse(response))
  })
  app.patch('/sign-in-settings', async (c) => {
    const input = await readJson(c, updateManagementSignInSettingsRequestSchema)
    const response = await updateManagementSignInSettings(getDeps(c), configzOptions(c, securityPolicy), input)
    return c.json(managementSignInSettingsResponseSchema.parse(response))
  })

  app.get('/branding-settings', async (c) => {
    const response = await getManagementBrandingSettings(getDeps(c), configzOptions(c, securityPolicy))
    return c.json(managementBrandingSettingsResponseSchema.parse(response))
  })
  app.patch('/branding-settings', async (c) => {
    const input = await readJson(c, updateManagementBrandingSettingsRequestSchema)
    const response = await updateManagementBrandingSettings(getDeps(c), configzOptions(c, securityPolicy), input)
    return c.json(managementBrandingSettingsResponseSchema.parse(response))
  })

  app.get('/account-center-settings', async (c) => {
    const response = await getManagementAccountCenterSettings(getDeps(c), configzOptions(c, securityPolicy))
    return c.json(managementAccountCenterSettingsResponseSchema.parse(response))
  })
  app.patch('/account-center-settings', async (c) => {
    const input = await readJson(c, updateManagementAccountCenterSettingsRequestSchema)
    const response = await updateManagementAccountCenterSettings(getDeps(c), configzOptions(c, securityPolicy), input)
    return c.json(managementAccountCenterSettingsResponseSchema.parse(response))
  })

  app.get('/developer-settings', async (c) =>
    c.json(managementDeveloperSettingsResponseSchema.parse(await getManagementDeveloperSettings(getDeps(c)))),
  )
  app.patch('/developer-settings', async (c) => {
    const input = await readJson(c, updateManagementDeveloperSettingsRequestSchema)
    return c.json(
      managementDeveloperSettingsResponseSchema.parse(await updateManagementDeveloperSettings(getDeps(c), input)),
    )
  })

  app.get('/general-settings', async (c) =>
    c.json(
      managementGeneralSettingsResponseSchema.parse(
        await getManagementGeneralSettings(getDeps(c), configzOptions(c, securityPolicy)),
      ),
    ),
  )
  app.patch('/general-settings', async (c) => {
    const input = await readJson(c, updateManagementGeneralSettingsRequestSchema)
    return c.json(
      managementGeneralSettingsResponseSchema.parse(
        await updateManagementGeneralSettings(getDeps(c), configzOptions(c, securityPolicy), input),
      ),
    )
  })

  app.get('/email-settings', async (c) =>
    c.json(
      managementEmailSettingsResponseSchema.parse(
        await getManagementEmailSettings(getDeps(c), configzOptions(c, securityPolicy)),
      ),
    ),
  )
  app.patch('/email-settings', async (c) => {
    const input = await readJson(c, updateManagementEmailSettingsRequestSchema)
    return c.json(
      managementEmailSettingsResponseSchema.parse(
        await updateManagementEmailSettings(getDeps(c), configzOptions(c, securityPolicy), input),
      ),
    )
  })

  return app
}

import {
  getManagementAccountCenterSettings,
  getManagementBrandingSettings,
  getManagementSignInSettings,
  updateManagementAccountCenterSettings,
  updateManagementBrandingSettings,
  updateManagementSignInSettings,
} from '@server/usecases/configz'
import {
  managementAccountCenterSettingsResponseSchema,
  managementBrandingSettingsResponseSchema,
  managementSignInSettingsResponseSchema,
  updateManagementAccountCenterSettingsRequestSchema,
  updateManagementBrandingSettingsRequestSchema,
  updateManagementSignInSettingsRequestSchema,
} from '@shared/api/management'
import type { SecurityPolicy } from '@shared/api/security'
import { Hono } from 'hono'
import { configzOptions } from '../../app-config'
import { requireAdmin } from '../../middleware/admin'
import { getDeps } from '../../middleware/deps'
import { readJson } from '../validation'

export function createManagementSettingsRoutes(securityPolicy?: SecurityPolicy) {
  const app = new Hono()

  app.use('/sign-in-settings', requireAdmin())
  app.get('/sign-in-settings', async (c) => {
    const response = await getManagementSignInSettings(getDeps(c), configzOptions(c, securityPolicy))
    return c.json(managementSignInSettingsResponseSchema.parse(response))
  })
  app.patch('/sign-in-settings', async (c) => {
    const input = await readJson(c, updateManagementSignInSettingsRequestSchema)
    const response = await updateManagementSignInSettings(getDeps(c), configzOptions(c, securityPolicy), input)
    return c.json(managementSignInSettingsResponseSchema.parse(response))
  })

  app.use('/branding-settings', requireAdmin())
  app.get('/branding-settings', async (c) => {
    const response = await getManagementBrandingSettings(getDeps(c), configzOptions(c, securityPolicy))
    return c.json(managementBrandingSettingsResponseSchema.parse(response))
  })
  app.patch('/branding-settings', async (c) => {
    const input = await readJson(c, updateManagementBrandingSettingsRequestSchema)
    const response = await updateManagementBrandingSettings(getDeps(c), configzOptions(c, securityPolicy), input)
    return c.json(managementBrandingSettingsResponseSchema.parse(response))
  })

  app.use('/account-center-settings', requireAdmin())
  app.get('/account-center-settings', async (c) => {
    const response = await getManagementAccountCenterSettings(getDeps(c), configzOptions(c, securityPolicy))
    return c.json(managementAccountCenterSettingsResponseSchema.parse(response))
  })
  app.patch('/account-center-settings', async (c) => {
    const input = await readJson(c, updateManagementAccountCenterSettingsRequestSchema)
    const response = await updateManagementAccountCenterSettings(getDeps(c), configzOptions(c, securityPolicy), input)
    return c.json(managementAccountCenterSettingsResponseSchema.parse(response))
  })

  return app
}

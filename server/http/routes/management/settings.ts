import { type ConfigzBindings, createConfigzService } from '@server/modules/configz/context'
import { defaultAccountCenterSettings } from '@server/usecases/configz'
import {
  type ManagementAccountCenterSettingsResponse,
  type ManagementBrandingSettingsResponse,
  type ManagementSignInSettingsResponse,
  managementAccountCenterSettingsResponseSchema,
  managementBrandingSettingsResponseSchema,
  managementSignInSettingsResponseSchema,
  type UpdateManagementAccountCenterSettingsRequest,
  type UpdateManagementBrandingSettingsRequest,
  type UpdateManagementSignInSettingsRequest,
  updateManagementAccountCenterSettingsRequestSchema,
  updateManagementBrandingSettingsRequestSchema,
  updateManagementSignInSettingsRequestSchema,
} from '@shared/api/management'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { requireAdmin } from '../../middleware/admin'
import { readJson } from '../validation'

interface ManagementConfigz {
  signIn: ManagementSignInSettingsResponse['signIn']
  links: ManagementSignInSettingsResponse['links']
  copy: ManagementSignInSettingsResponse['copy']
  branding: ManagementBrandingSettingsResponse['branding']
  accountCenter?: ManagementAccountCenterSettingsResponse['accountCenter']
  getManagementSignInSettings?: () => Promise<ManagementSignInSettingsResponse>
  updateManagementSignInSettings?: (
    input: UpdateManagementSignInSettingsRequest,
  ) => Promise<ManagementSignInSettingsResponse>
  getManagementBrandingSettings?: () => Promise<ManagementBrandingSettingsResponse>
  updateManagementBrandingSettings?: (
    input: UpdateManagementBrandingSettingsRequest,
  ) => Promise<ManagementBrandingSettingsResponse>
  getManagementAccountCenterSettings?: () => Promise<ManagementAccountCenterSettingsResponse>
  updateManagementAccountCenterSettings?: (
    input: UpdateManagementAccountCenterSettingsRequest,
  ) => Promise<ManagementAccountCenterSettingsResponse>
}

export type ManagementConfigzServiceFactory = (c: Context<{ Bindings: ConfigzBindings }>) => {
  getConfig: () => Promise<ManagementConfigz>
  getManagementSignInSettings?: () => Promise<ManagementSignInSettingsResponse>
  updateManagementSignInSettings?: (
    input: UpdateManagementSignInSettingsRequest,
  ) => Promise<ManagementSignInSettingsResponse>
  getManagementBrandingSettings?: () => Promise<ManagementBrandingSettingsResponse>
  updateManagementBrandingSettings?: (
    input: UpdateManagementBrandingSettingsRequest,
  ) => Promise<ManagementBrandingSettingsResponse>
  getManagementAccountCenterSettings?: () => Promise<ManagementAccountCenterSettingsResponse>
  updateManagementAccountCenterSettings?: (
    input: UpdateManagementAccountCenterSettingsRequest,
  ) => Promise<ManagementAccountCenterSettingsResponse>
}

export function createManagementSettingsRoutes(
  configzServiceFactory: ManagementConfigzServiceFactory = createConfigzService,
) {
  const app = new Hono<{ Bindings: ConfigzBindings }>()

  app.use('/sign-in-settings', requireAdmin())
  app.get('/sign-in-settings', async (c) => {
    const service = configzServiceFactory(c)
    const response = service.getManagementSignInSettings
      ? await service.getManagementSignInSettings()
      : await managementSignInSettingsFromConfig(await service.getConfig())
    return c.json(managementSignInSettingsResponseSchema.parse(response))
  })
  app.patch('/sign-in-settings', async (c) => {
    const input = await readJson(c, updateManagementSignInSettingsRequestSchema)
    const service = configzServiceFactory(c)
    const response = service.updateManagementSignInSettings
      ? await service.updateManagementSignInSettings(input)
      : await managementSignInSettingsFromConfig(await service.getConfig())
    return c.json(managementSignInSettingsResponseSchema.parse(response))
  })

  app.use('/branding-settings', requireAdmin())
  app.get('/branding-settings', async (c) => {
    const service = configzServiceFactory(c)
    const response = service.getManagementBrandingSettings
      ? await service.getManagementBrandingSettings()
      : await managementBrandingSettingsFromConfig(await service.getConfig())
    return c.json(managementBrandingSettingsResponseSchema.parse(response))
  })
  app.patch('/branding-settings', async (c) => {
    const input = await readJson(c, updateManagementBrandingSettingsRequestSchema)
    const service = configzServiceFactory(c)
    const response = service.updateManagementBrandingSettings
      ? await service.updateManagementBrandingSettings(input)
      : await managementBrandingSettingsFromConfig(await service.getConfig())
    return c.json(managementBrandingSettingsResponseSchema.parse(response))
  })

  app.use('/account-center-settings', requireAdmin())
  app.get('/account-center-settings', async (c) => {
    const service = configzServiceFactory(c)
    const response = service.getManagementAccountCenterSettings
      ? await service.getManagementAccountCenterSettings()
      : await managementAccountCenterSettingsFromConfig(await service.getConfig())
    return c.json(managementAccountCenterSettingsResponseSchema.parse(response))
  })
  app.patch('/account-center-settings', async (c) => {
    const input = await readJson(c, updateManagementAccountCenterSettingsRequestSchema)
    const service = configzServiceFactory(c)
    const response = service.updateManagementAccountCenterSettings
      ? await service.updateManagementAccountCenterSettings(input)
      : await managementAccountCenterSettingsFromConfig(await service.getConfig())
    return c.json(managementAccountCenterSettingsResponseSchema.parse(response))
  })

  return app
}

async function managementSignInSettingsFromConfig(
  config: Awaited<ReturnType<ReturnType<ManagementConfigzServiceFactory>['getConfig']>>,
): Promise<ManagementSignInSettingsResponse> {
  return {
    signIn: config.signIn,
    builtInProviders: {
      email: {
        enabled: config.signIn.emailOtpEnabled,
        otpLength: 6,
        expiresInSeconds: 300,
      },
      phone: {
        enabled: false,
        smsProvider: 'twilio',
        otpLength: 6,
        expiresInSeconds: 300,
        signUpOnVerification: false,
        requireVerification: true,
        twilioAccountSid: '',
        twilioAuthToken: '',
        twilioFromNumber: '',
        vonageApiKey: '',
        vonageApiSecret: '',
        vonageFrom: '',
        messageBirdAccessKey: '',
        messageBirdOriginator: '',
      },
      web3Wallet: {
        enabled: false,
        chains: [1],
        domain: '',
        emailDomainName: '',
        allowSignUp: true,
        ensLookupEnabled: false,
      },
      passkey: {
        allowSignUp: true,
      },
      oneTap: {
        enabled: false,
        clientId: '',
        autoSelect: false,
        cancelOnTapOutside: true,
        uxMode: 'popup',
        context: 'signin',
        promptBaseDelayMs: 1000,
        promptMaxAttempts: 5,
        disableSignUp: false,
      },
    },
    links: config.links,
    copy: config.copy,
  }
}

async function managementBrandingSettingsFromConfig(
  config: Awaited<ReturnType<ReturnType<ManagementConfigzServiceFactory>['getConfig']>>,
): Promise<ManagementBrandingSettingsResponse> {
  return {
    branding: config.branding,
    copy: config.copy,
  }
}

async function managementAccountCenterSettingsFromConfig(
  config: Awaited<ReturnType<ReturnType<ManagementConfigzServiceFactory>['getConfig']>>,
): Promise<ManagementAccountCenterSettingsResponse> {
  return {
    accountCenter: config.accountCenter ?? defaultAccountCenterSettings,
  }
}

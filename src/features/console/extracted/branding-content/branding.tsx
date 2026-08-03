import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { TextInput } from '@/components/product-form'
import { hasSettingsChanges, SettingsForm, SettingsFormField, SettingsFormSection } from '@/components/settings-form'
import { Field } from '@/components/ui/field'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  consoleQueryKeys,
  getBrandingSettings,
  getSecurityPolicy,
  getSignInSettings,
  updateBrandingSettings,
  updateSignInSettings,
} from '@/lib/api/management'
import { tt } from '@/lib/i18n'
import type { HostedAuthPreviewState } from '../../console-shared'
import { useConnectorPreviewProviders } from '../../helpers/helpers-dialogs'
import {
  HostedAuthPreview,
  SignInExperienceEditorLayout,
  SignInExperiencePreviewPanel,
} from '../../helpers/helpers-preview'
import { ResourcePage } from '../../helpers/helpers-resource'
import { customCssProperties, nullableString, useAdminMutation } from '../../helpers/helpers-utils'

export type ExperienceSection = 'theme' | 'assets' | 'legal'
type ThemeId = 'aqua' | 'sage' | 'indigo' | 'custom'
type ExperienceForm = {
  productName: string
  logoUrl: string
  faviconUrl: string
  primary: string
  background: string
  surface: string
  text: string
  border: string
  termsUrl: string
  privacyUrl: string
  supportUrl: string
}

const themes: Array<{
  id: Exclude<ThemeId, 'custom'>
  name: string
  primary: string
  background: string
  surface: string
  text: string
  border: string
  description: string
}> = [
  {
    id: 'aqua',
    name: 'Clear Aqua',
    description: 'Crisp, technical, and calm.',
    primary: '#007b83',
    background: '#f3f8f8',
    surface: '#ffffff',
    text: '#162427',
    border: '#dde5e5',
  },
  {
    id: 'sage',
    name: 'Sage',
    description: 'Natural, grounded, and quiet.',
    primary: '#4f7259',
    background: '#f5f8f4',
    surface: '#ffffff',
    text: '#1e2920',
    border: '#dde6dd',
  },
  {
    id: 'indigo',
    name: 'Indigo',
    description: 'Confident with a cooler edge.',
    primary: '#4f5fbf',
    background: '#f5f6fc',
    surface: '#ffffff',
    text: '#1c2340',
    border: '#dde0ef',
  },
]

function savedExperienceState(
  branding: Awaited<ReturnType<typeof getBrandingSettings>>,
  signIn: Awaited<ReturnType<typeof getSignInSettings>>,
): { form: ExperienceForm; theme: ThemeId } {
  const primary = branding.branding.primaryColor ?? '#007b83'
  const background = branding.branding.backgroundColor ?? '#f3f8f8'
  const customColors = customCssProperties(branding.branding.customCss ?? '') as Record<string, string>
  const surface = customColors['--auth-surface-color'] ?? '#ffffff'
  const text = customColors['--auth-text-color'] ?? '#162427'
  const border = customColors['--auth-border-color'] ?? '#dde5e5'
  const knownTheme = themes.find(
    (candidate) =>
      candidate.primary === primary &&
      candidate.background === background &&
      candidate.surface === surface &&
      candidate.text === text &&
      candidate.border === border,
  )

  return {
    theme: knownTheme?.id ?? 'custom',
    form: {
      productName: branding.copy.productName,
      logoUrl: branding.branding.logoUrl ?? '',
      faviconUrl: branding.branding.faviconUrl ?? '',
      primary,
      background,
      surface,
      text,
      border,
      termsUrl: signIn.links.termsUri ?? '',
      privacyUrl: signIn.links.privacyUri ?? '',
      supportUrl: signIn.links.supportUri ?? '',
    },
  }
}

export function ExperiencePage({ section = 'theme' }: { section?: ExperienceSection }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const branding = useQuery({ queryKey: consoleQueryKeys.branding, queryFn: getBrandingSettings })
  const signIn = useQuery({ queryKey: consoleQueryKeys.signIn, queryFn: getSignInSettings })
  const security = useQuery({ queryKey: consoleQueryKeys.security, queryFn: getSecurityPolicy })
  const connectors = useConnectorPreviewProviders()
  const [active, setActive] = useState<ExperienceSection>(section)
  const [theme, setTheme] = useState<ThemeId>('aqua')
  const [form, setForm] = useState<ExperienceForm>({
    productName: 'Realmroot',
    logoUrl: '',
    faviconUrl: '',
    primary: '#007b83',
    background: '#f3f8f8',
    surface: '#ffffff',
    text: '#162427',
    border: '#dde5e5',
    termsUrl: '',
    privacyUrl: '',
    supportUrl: '',
  })
  useEffect(() => setActive(section), [section])
  useEffect(() => {
    if (!branding.data || !signIn.data) return
    const saved = savedExperienceState(branding.data, signIn.data)
    setTheme(saved.theme)
    setForm(saved.form)
  }, [branding.data, signIn.data])
  const save = useAdminMutation({
    mutationFn: async ({ section: saveSection, values }: { section: ExperienceSection; values: ExperienceForm }) => {
      if (saveSection === 'theme') {
        await updateBrandingSettings({
          branding: {
            primaryColor: values.primary,
            backgroundColor: values.background,
            customCss: themeCustomCss(values),
          },
        })
        return
      }
      if (saveSection === 'assets') {
        await updateBrandingSettings({
          branding: {
            logoUrl: nullableString(values.logoUrl),
            faviconUrl: nullableString(values.faviconUrl),
          },
          copy: { productName: values.productName },
        })
        return
      }
      await updateSignInSettings({
        links: {
          termsUri: nullableString(values.termsUrl),
          privacyUri: nullableString(values.privacyUrl),
          supportUri: nullableString(values.supportUrl),
        },
      })
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: consoleQueryKeys.branding }),
        queryClient.invalidateQueries({ queryKey: consoleQueryKeys.signIn }),
      ]),
  })
  const discard = () => {
    if (!branding.data || !signIn.data) return
    const saved = savedExperienceState(branding.data, signIn.data)
    if (active === 'theme') setTheme(saved.theme)
    setForm((current) => ({ ...current, ...experienceTabValues(active, saved.form) }))
  }
  const persisted = branding.data && signIn.data ? savedExperienceState(branding.data, signIn.data) : null
  const dirty = persisted
    ? hasSettingsChanges(experienceTabValues(active, form), experienceTabValues(active, persisted.form))
    : false
  const preview: HostedAuthPreviewState = {
    productName: form.productName,
    headline: signIn.data?.copy.headline ?? 'Sign in to Realmroot',
    description: signIn.data?.copy.description ?? 'Use your account to continue securely.',
    logoUrl: form.logoUrl,
    primaryColor: form.primary,
    backgroundColor: form.background,
    customCss: themeCustomCss(form),
    passwordEnabled: signIn.data?.signIn.passwordEnabled,
    oneTapEnabled: signIn.data?.builtInProviders.oneTap.enabled,
    signupEnabled: signIn.data?.signIn.signupEnabled,
    socialLoginEnabled: signIn.data?.signIn.socialLoginEnabled,
    socialProviders: connectors.providers,
    passkeysEnabled: security.data?.policy.passkeys.enabled,
    emailOtpEnabled: signIn.data?.signIn.emailOtpEnabled,
    phoneEnabled: signIn.data?.builtInProviders.phone.enabled,
    web3WalletEnabled: signIn.data?.builtInProviders.web3Wallet.enabled,
    usernameEnabled: signIn.data?.signIn.usernameEnabled,
    identifierFirst: signIn.data?.signIn.identifierFirst,
    termsUri: form.termsUrl,
    privacyUri: form.privacyUrl,
    supportUri: form.supportUrl,
  }
  return (
    <ResourcePage
      title={tt('Experience')}
      description={tt('Shape the visual identity and trusted destinations shared by Realmroot-hosted pages.')}
      aside={
        <SignInExperiencePreviewPanel>
          <HostedAuthPreview preview={preview} />
        </SignInExperiencePreviewPanel>
      }
      error={branding.error ?? signIn.error ?? security.error ?? connectors.error}
      framed={false}
      loading={branding.isLoading || signIn.isLoading || security.isLoading}
      onRetry={() => {
        void branding.refetch()
        void signIn.refetch()
        void security.refetch()
        void connectors.refetch()
      }}
    >
      <Tabs
        onValueChange={(value) => {
          const next = value as ExperienceSection
          setActive(next)
          void navigate({ to: `/console/sign-in-experience/${next}` })
        }}
        value={active}
      >
        <TabsList className="w-full" variant="navigation">
          <TabsTrigger value="theme">{tt('Color scheme')}</TabsTrigger>
          <TabsTrigger value="assets">{tt('Brand assets')}</TabsTrigger>
          <TabsTrigger value="legal">{tt('Legal & support')}</TabsTrigger>
        </TabsList>
        <SignInExperienceEditorLayout
          settings={
            <SettingsForm
              dirty={dirty}
              error={save.errorMessage}
              onDiscard={discard}
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault()
                save.mutate({ section: active, values: form })
              }}
              pending={save.isPending}
              status="Changes update the hosted preview immediately."
            >
              <TabsContent className="mt-5" value="theme">
                <SettingsFormSection
                  description="Choose a tested scheme or create a custom theme."
                  title="Color scheme"
                >
                  <Field className="border-b border-border py-3.5">
                    <div className="themePickerGrid">
                      {themes.map((candidate) => (
                        <button
                          aria-pressed={theme === candidate.id}
                          className="themeChoice"
                          data-selected={theme === candidate.id}
                          key={candidate.id}
                          onClick={() => {
                            setTheme(candidate.id)
                            setForm((current) => ({
                              ...current,
                              primary: candidate.primary,
                              background: candidate.background,
                              surface: candidate.surface,
                              text: candidate.text,
                              border: candidate.border,
                            }))
                          }}
                          type="button"
                        >
                          <span className="themeSwatches">
                            <i style={{ background: candidate.primary }} />
                            <i style={{ background: candidate.background }} />
                            <i style={{ background: candidate.surface }} />
                            <i style={{ background: candidate.text }} />
                            <i style={{ background: candidate.border }} />
                          </span>
                          <span>
                            <strong>{candidate.name}</strong>
                            <small>{candidate.description}</small>
                          </span>
                          {theme === candidate.id ? <Check /> : null}
                        </button>
                      ))}
                      <button
                        aria-pressed={theme === 'custom'}
                        className="themeChoice"
                        data-selected={theme === 'custom'}
                        onClick={() => setTheme('custom')}
                        type="button"
                      >
                        <span className="themeSwatches">
                          <i style={{ background: form.primary }} />
                          <i style={{ background: form.background }} />
                          <i style={{ background: form.surface }} />
                          <i style={{ background: form.text }} />
                          <i style={{ background: form.border }} />
                        </span>
                        <span>
                          <strong>{tt('Custom')}</strong>
                          <small>{tt('Tune the core semantic colors.')}</small>
                        </span>
                        {theme === 'custom' ? <Check /> : null}
                      </button>
                    </div>
                  </Field>
                  {theme === 'custom' ? (
                    <>
                      <ColorField
                        description="Actions, links, and focus states."
                        label="Primary"
                        name="primaryColor"
                        onChange={(primary) => setForm((current) => ({ ...current, primary }))}
                        value={form.primary}
                      />
                      <ColorField
                        description="The canvas behind hosted content."
                        label="Page background"
                        name="backgroundColor"
                        onChange={(background) => setForm((current) => ({ ...current, background }))}
                        value={form.background}
                      />
                      <ColorField
                        description="Authentication and consent surfaces."
                        label="Surface"
                        name="surfaceColor"
                        onChange={(surface) => setForm((current) => ({ ...current, surface }))}
                        value={form.surface}
                      />
                      <ColorField
                        description="Primary content and headings."
                        label="Text"
                        name="textColor"
                        onChange={(text) => setForm((current) => ({ ...current, text }))}
                        value={form.text}
                      />
                      <ColorField
                        description="Fields, dividers, and boundaries."
                        label="Border"
                        name="borderColor"
                        onChange={(border) => setForm((current) => ({ ...current, border }))}
                        value={form.border}
                      />
                    </>
                  ) : null}
                </SettingsFormSection>
              </TabsContent>
              <TabsContent className="mt-5" value="assets">
                <SettingsFormSection
                  description="Identity shown across sign-in, consent, and Account Center."
                  title="Brand assets"
                >
                  <SettingsFormField label="Product name">
                    <TextInput
                      name="productName"
                      onChange={(event) => setForm((current) => ({ ...current, productName: event.target.value }))}
                      required
                      value={form.productName}
                    />
                  </SettingsFormField>
                  <SettingsFormField description="Square SVG or PNG over HTTPS." label="Logo URL">
                    <TextInput
                      name="logoUrl"
                      onChange={(event) => setForm((current) => ({ ...current, logoUrl: event.target.value }))}
                      type="url"
                      value={form.logoUrl}
                    />
                  </SettingsFormField>
                  <SettingsFormField label="Favicon URL">
                    <TextInput
                      name="faviconUrl"
                      onChange={(event) => setForm((current) => ({ ...current, faviconUrl: event.target.value }))}
                      type="url"
                      value={form.faviconUrl}
                    />
                  </SettingsFormField>
                </SettingsFormSection>
              </TabsContent>
              <TabsContent className="mt-5" value="legal">
                <SettingsFormSection
                  description="Set the footer destinations shared by Realmroot-hosted pages."
                  title="Legal & support"
                >
                  <SettingsFormField label="Terms URL">
                    <TextInput
                      name="termsUrl"
                      onChange={(event) => setForm((current) => ({ ...current, termsUrl: event.target.value }))}
                      type="url"
                      value={form.termsUrl}
                    />
                  </SettingsFormField>
                  <SettingsFormField label="Privacy URL">
                    <TextInput
                      name="privacyUrl"
                      onChange={(event) => setForm((current) => ({ ...current, privacyUrl: event.target.value }))}
                      type="url"
                      value={form.privacyUrl}
                    />
                  </SettingsFormField>
                  <SettingsFormField label="Support URL">
                    <TextInput
                      name="supportUrl"
                      onChange={(event) => setForm((current) => ({ ...current, supportUrl: event.target.value }))}
                      type="url"
                      value={form.supportUrl}
                    />
                  </SettingsFormField>
                </SettingsFormSection>
              </TabsContent>
            </SettingsForm>
          }
        />
      </Tabs>
    </ResourcePage>
  )
}

export function BrandingPage() {
  return <ExperiencePage section="theme" />
}

function ColorField({
  description,
  label,
  name,
  onChange,
  value,
}: {
  description: string
  label: string
  name: string
  onChange: (value: string) => void
  value: string
}) {
  return (
    <SettingsFormField description={description} label={label}>
      <TextInput
        name={name}
        onChange={(event) => onChange(event.target.value)}
        pattern="#[0-9a-fA-F]{6}"
        value={value}
      />
    </SettingsFormField>
  )
}

function experienceTabValues(section: ExperienceSection, form: ExperienceForm) {
  if (section === 'theme') {
    return {
      primary: form.primary,
      background: form.background,
      surface: form.surface,
      text: form.text,
      border: form.border,
    }
  }
  if (section === 'assets') {
    return { productName: form.productName, logoUrl: form.logoUrl, faviconUrl: form.faviconUrl }
  }
  return { termsUrl: form.termsUrl, privacyUrl: form.privacyUrl, supportUrl: form.supportUrl }
}

function themeCustomCss(form: ExperienceForm) {
  return `--auth-surface-color: ${form.surface}; --auth-text-color: ${form.text}; --auth-border-color: ${form.border}`
}

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { type FormEvent, useEffect, useId, useState } from 'react'
import { Field, TextInput } from '@/components/product-form'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  consoleQueryKeys,
  getBrandingSettings,
  getSecurityPolicy,
  getSignInSettings,
  updateBrandingSettings,
  updateSignInSettings,
  uploadBrandingFavicon,
  uploadBrandingLogo,
} from '@/lib/api/management'
import { tt } from '@/lib/i18n'
import type { HostedAuthPreviewState } from '../../console-shared'
import { useConnectorPreviewProviders } from '../../helpers/helpers-dialogs'
import { AssetUploadControl } from '../../helpers/helpers-forms'
import { HostedAuthPreview, SignInExperienceEditorLayout } from '../../helpers/helpers-preview'
import { ResourcePage } from '../../helpers/helpers-resource'
import { customCssProperties, nullableString, useAdminMutation } from '../../helpers/helpers-utils'

export type ExperienceSection = 'theme' | 'assets' | 'legal'
type ThemeId = 'aqua' | 'matcha' | 'cobalt' | 'custom'

const themes: Array<{
  id: Exclude<ThemeId, 'custom'>
  name: string
  primary: string
  background: string
  text: string
  border: string
}> = [
  { id: 'aqua', name: 'Clear Aqua', primary: '#007b83', background: '#f7fbfb', text: '#142022', border: '#dde5e5' },
  { id: 'matcha', name: 'Fresh Matcha', primary: '#668a6a', background: '#fafcf8', text: '#1c2a20', border: '#dce6d8' },
  { id: 'cobalt', name: 'Clean Cobalt', primary: '#2563eb', background: '#f8fbff', text: '#172033', border: '#dbe5f1' },
]

export function ExperiencePage({ section = 'theme' }: { section?: ExperienceSection }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const branding = useQuery({ queryKey: consoleQueryKeys.branding, queryFn: getBrandingSettings })
  const signIn = useQuery({ queryKey: consoleQueryKeys.signIn, queryFn: getSignInSettings })
  const security = useQuery({ queryKey: consoleQueryKeys.security, queryFn: getSecurityPolicy })
  const connectors = useConnectorPreviewProviders()
  const [active, setActive] = useState<ExperienceSection>(section)
  const [theme, setTheme] = useState<ThemeId>('aqua')
  const [form, setForm] = useState({
    productName: 'Realmroot',
    logoUrl: '',
    faviconUrl: '',
    primary: '#007b83',
    background: '#f7fbfb',
    text: '#142022',
    border: '#dde5e5',
    termsUrl: '',
    privacyUrl: '',
    supportEmail: '',
  })
  useEffect(() => setActive(section), [section])
  useEffect(() => {
    if (!branding.data || !signIn.data) return
    const primary = branding.data.branding.primaryColor ?? '#007b83'
    const background = branding.data.branding.backgroundColor ?? '#f7fbfb'
    const customColors = customCssProperties(branding.data.branding.customCss ?? '') as Record<string, string>
    const text = customColors['--auth-text-color'] ?? '#142022'
    const border = customColors['--auth-border-color'] ?? '#dde5e5'
    const known = themes.find(
      (candidate) =>
        candidate.primary === primary &&
        candidate.background === background &&
        candidate.text === text &&
        candidate.border === border,
    )
    setTheme(known?.id ?? 'custom')
    setForm((current) => ({
      ...current,
      productName: branding.data.copy.productName,
      logoUrl: branding.data.branding.logoUrl ?? '',
      faviconUrl: branding.data.branding.faviconUrl ?? '',
      primary,
      background,
      text,
      border,
      termsUrl: signIn.data.links.termsUri ?? '',
      privacyUrl: signIn.data.links.privacyUri ?? '',
      supportEmail: signIn.data.links.supportEmail ?? '',
    }))
  }, [branding.data, signIn.data])
  const save = useAdminMutation({
    mutationFn: async () => {
      await Promise.all([
        updateBrandingSettings({
          branding: {
            logoUrl: nullableString(form.logoUrl),
            faviconUrl: nullableString(form.faviconUrl),
            primaryColor: form.primary,
            backgroundColor: form.background,
            customCss: `--auth-text-color: ${form.text}; --auth-border-color: ${form.border}`,
          },
          copy: { productName: form.productName },
        }),
        updateSignInSettings({
          links: {
            termsUri: nullableString(form.termsUrl),
            privacyUri: nullableString(form.privacyUrl),
            supportEmail: nullableString(form.supportEmail),
          },
        }),
      ])
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: consoleQueryKeys.branding }),
        queryClient.invalidateQueries({ queryKey: consoleQueryKeys.signIn }),
      ]),
  })
  const logoUpload = useAdminMutation({
    mutationFn: uploadBrandingLogo,
    onSuccess: (result) => {
      setForm((current) => ({ ...current, logoUrl: result.asset.publicUrl }))
      return Promise.resolve()
    },
  })
  const faviconUpload = useAdminMutation({
    mutationFn: uploadBrandingFavicon,
    onSuccess: (result) => {
      setForm((current) => ({ ...current, faviconUrl: result.asset.publicUrl }))
      return Promise.resolve()
    },
  })
  const preview: HostedAuthPreviewState = {
    productName: form.productName,
    headline: signIn.data?.copy.headline ?? 'Sign in to Realmroot',
    description: signIn.data?.copy.description ?? 'Use your account to continue securely.',
    logoUrl: form.logoUrl,
    primaryColor: form.primary,
    backgroundColor: form.background,
    customCss: `--auth-text-color: ${form.text}; --auth-border-color: ${form.border}`,
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
    supportEmail: form.supportEmail,
  }
  return (
    <ResourcePage
      title={tt('Experience')}
      description={tt('Shape the visual identity and trusted destinations shared by Realmroot-hosted pages.')}
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
        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            save.mutate(undefined)
          }}
        >
          <SignInExperienceEditorLayout
            preview={<HostedAuthPreview preview={preview} />}
            settings={
              <>
                <TabsContent className="mt-5" value="theme">
                  <section className="detailSection">
                    <header>
                      <div>
                        <h2>{tt('Color scheme')}</h2>
                        <p>{tt('Choose a tested palette or create a custom scheme for hosted surfaces.')}</p>
                      </div>
                    </header>
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
                              text: candidate.text,
                              border: candidate.border,
                            }))
                          }}
                          type="button"
                        >
                          <span className="themeSwatches">
                            <i style={{ background: candidate.primary }} />
                            <i style={{ background: candidate.background }} />
                            <i style={{ background: candidate.text }} />
                            <i style={{ background: candidate.border }} />
                          </span>
                          <span>
                            <strong>{candidate.name}</strong>
                            <small>{candidate.primary}</small>
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
                          <i style={{ background: form.text }} />
                          <i style={{ background: form.border }} />
                        </span>
                        <span>
                          <strong>{tt('Custom')}</strong>
                          <small>{tt('Edit four theme colors')}</small>
                        </span>
                        {theme === 'custom' ? <Check /> : null}
                      </button>
                    </div>
                    {theme === 'custom' ? (
                      <div className="grid gap-4 pt-5 sm:grid-cols-2">
                        <ColorField
                          label="Primary"
                          name="primaryColor"
                          onChange={(primary) => setForm((current) => ({ ...current, primary }))}
                          value={form.primary}
                        />
                        <ColorField
                          label="Page background"
                          name="backgroundColor"
                          onChange={(background) => setForm((current) => ({ ...current, background }))}
                          value={form.background}
                        />
                        <ColorField
                          label="Text"
                          name="textColor"
                          onChange={(text) => setForm((current) => ({ ...current, text }))}
                          value={form.text}
                        />
                        <ColorField
                          label="Border"
                          name="borderColor"
                          onChange={(border) => setForm((current) => ({ ...current, border }))}
                          value={form.border}
                        />
                      </div>
                    ) : null}
                  </section>
                </TabsContent>
                <TabsContent className="mt-5" value="assets">
                  <section className="detailSection">
                    <header>
                      <div>
                        <h2>{tt('Brand assets')}</h2>
                        <p>{tt('Identity shown across sign-in, consent, and Account Center.')}</p>
                      </div>
                    </header>
                    <div className="grid gap-5 pt-5">
                      <Field label={tt('Product name')}>
                        <TextInput
                          name="productName"
                          onChange={(event) => setForm((current) => ({ ...current, productName: event.target.value }))}
                          required
                          value={form.productName}
                        />
                      </Field>
                      <Field label={tt('Logo URL')}>
                        <TextInput
                          name="logoUrl"
                          onChange={(event) => setForm((current) => ({ ...current, logoUrl: event.target.value }))}
                          type="url"
                          value={form.logoUrl}
                        />
                      </Field>
                      <AssetUploadControl
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        label={tt('Upload logo')}
                        onFile={(file) => logoUpload.mutate(file)}
                        previewUrl={form.logoUrl || null}
                      />
                      <Field label={tt('Favicon URL')}>
                        <TextInput
                          name="faviconUrl"
                          onChange={(event) => setForm((current) => ({ ...current, faviconUrl: event.target.value }))}
                          type="url"
                          value={form.faviconUrl}
                        />
                      </Field>
                      <AssetUploadControl
                        accept="image/png,image/webp,image/x-icon,image/vnd.microsoft.icon"
                        label={tt('Upload favicon')}
                        onFile={(file) => faviconUpload.mutate(file)}
                        previewUrl={form.faviconUrl || null}
                      />
                    </div>
                  </section>
                </TabsContent>
                <TabsContent className="mt-5" value="legal">
                  <section className="detailSection">
                    <header>
                      <div>
                        <h2>{tt('Legal & support')}</h2>
                        <p>{tt('Set the footer destinations shared by Realmroot-hosted pages.')}</p>
                      </div>
                    </header>
                    <div className="grid gap-5 pt-5">
                      <Field label={tt('Terms URL')}>
                        <TextInput
                          name="termsUrl"
                          onChange={(event) => setForm((current) => ({ ...current, termsUrl: event.target.value }))}
                          type="url"
                          value={form.termsUrl}
                        />
                      </Field>
                      <Field label={tt('Privacy URL')}>
                        <TextInput
                          name="privacyUrl"
                          onChange={(event) => setForm((current) => ({ ...current, privacyUrl: event.target.value }))}
                          type="url"
                          value={form.privacyUrl}
                        />
                      </Field>
                      <Field
                        help={tt('Used by the Support footer link until a dedicated support URL is configured.')}
                        label={tt('Support email')}
                      >
                        <TextInput
                          name="supportEmail"
                          onChange={(event) => setForm((current) => ({ ...current, supportEmail: event.target.value }))}
                          type="email"
                          value={form.supportEmail}
                        />
                      </Field>
                    </div>
                  </section>
                </TabsContent>
                <div className="stickyChangesBar">
                  <span>
                    {save.errorMessage ??
                      logoUpload.errorMessage ??
                      faviconUpload.errorMessage ??
                      tt('Changes update the hosted preview immediately.')}
                  </span>
                  <Button disabled={save.isPending || logoUpload.isPending || faviconUpload.isPending} type="submit">
                    {save.isPending ? tt('Saving…') : tt('Save changes')}
                  </Button>
                </div>
              </>
            }
          />
        </form>
      </Tabs>
    </ResourcePage>
  )
}

export function BrandingPage() {
  return <ExperiencePage section="theme" />
}

function ColorField({
  label,
  name,
  onChange,
  value,
}: {
  label: string
  name: string
  onChange: (value: string) => void
  value: string
}) {
  const valueId = useId()
  return (
    <div className="field">
      <label className="font-medium text-sm" htmlFor={valueId}>
        {tt(label)}
      </label>
      <div className="flex gap-2">
        <TextInput
          aria-label={tt('{{label}} color picker', { label })}
          className="w-12 p-1"
          name={`${name}Picker`}
          onChange={(event) => onChange(event.target.value)}
          type="color"
          value={value}
        />
        <TextInput
          id={valueId}
          name={name}
          onChange={(event) => onChange(event.target.value)}
          pattern="#[0-9a-fA-F]{6}"
          value={value}
        />
      </div>
    </div>
  )
}

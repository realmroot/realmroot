import type { ConfigzConfigResponse } from '@shared/api/configz'
import { ArrowLeft } from 'lucide-react'
import { type CSSProperties, createElement, type ReactNode, useEffect } from 'react'
import { RealmrootMark } from '@/components/realmroot-brand'
import { tt } from '@/lib/i18n'

type AuthLayoutProps = {
  children: ReactNode
  config: ConfigzConfigResponse | null
  backHref?: string
  backLabel?: string
  eyebrow?: string
  icon?: ReactNode
  layout?: 'split' | 'focused' | 'decision'
  variant?: 'form' | 'message'
  title: string
  description: string
}
export function AuthLayout({
  backHref,
  backLabel,
  children,
  config,
  eyebrow,
  icon,
  layout,
  title,
  description,
  variant = 'form',
}: AuthLayoutProps) {
  const style = brandingStyle(config)
  const resolvedLayout = layout ?? (variant === 'message' || icon ? 'focused' : 'split')
  useEffect(() => {
    if (!config?.branding.faviconUrl) return
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.createElement('link')
    link.rel = 'icon'
    link.href = config.branding.faviconUrl
    document.head.appendChild(link)
  }, [config?.branding.faviconUrl])
  return (
    <main
      className={`authShell authShell-${variant} authShell-${resolvedLayout}`}
      id="auth-content"
      style={style}
      tabIndex={-1}
      aria-label={tt('auth.hostedAuthentication')}
    >
      <a className="skipLink" href="#auth-content">
        {tt('Skip to content')}
      </a>
      {backHref ? (
        <a className="authBackLink" href={backHref}>
          <ArrowLeft aria-hidden="true" size={16} />
          {backLabel ?? tt('auth.back')}
        </a>
      ) : null}
      <AuthCardFrame
        brand={icon ? <div className="authMessageIcon">{icon}</div> : <BrandIdentity config={config} />}
        className={`authPanel authPanel-${resolvedLayout}`}
        description={description}
        eyebrow={eyebrow}
        headingLevel={1}
        legalLinks={authLegalLinks(config)}
        productName={config?.copy?.productName ?? 'Realmroot'}
        title={title}
        titleId="auth-title"
      >
        {children}
      </AuthCardFrame>
    </main>
  )
}
export function AuthCardFrame({
  ariaLabel,
  brand,
  children,
  className = 'authPanel',
  description,
  eyebrow,
  headingLevel = 1,
  legalLinks,
  productName,
  title,
  titleId,
}: {
  ariaLabel?: string
  brand: ReactNode
  children: ReactNode
  className?: string
  description: string
  eyebrow?: string
  headingLevel?: 1 | 2
  legalLinks: Array<[string, string]>
  productName: string
  title: string
  titleId: string
}) {
  void productName
  return (
    <div className="authFrame">
      <section aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : titleId} className={className}>
        <div className="authBrandPanel">
          {brand}
          {eyebrow ? <p className="eyebrow">{tt(eyebrow)}</p> : null}
          {createElement(
            `h${headingLevel}`,
            {
              id: titleId,
            },
            title,
          )}
          <p>{description}</p>
        </div>
        <div className="authContent">{children}</div>
      </section>
      <AuthPageFooter links={legalLinks} />
    </div>
  )
}
export function BrandIdentity({ config }: { config: ConfigzConfigResponse | null }) {
  const productName = config?.copy?.productName ?? 'Realmroot'
  return (
    <a className="brand brandLink" href="/">
      {config?.branding.logoUrl ? (
        <img className="brandLogo" src={config.branding.logoUrl} alt="" width="36" height="36" />
      ) : (
        <RealmrootMark className="brandMark" />
      )}
      <span>{productName}</span>
    </a>
  )
}
export function brandingStyle(config: ConfigzConfigResponse | null): CSSProperties {
  const branding = config?.branding
  return {
    '--brand-primary': branding?.primaryColor ?? '#007b83',
    '--brand-primary-active': branding?.primaryColor ?? '#005f66',
    '--brand-background': branding?.backgroundColor ?? '#ffffff',
    ...customProperties(branding?.customCss ?? null),
  } as CSSProperties
}
function customProperties(css: string | null): CSSProperties {
  if (!css) return {}
  return Object.fromEntries(
    css
      .split(';')
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const separator = declaration.indexOf(':')
        return [declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim()]
      }),
  ) as CSSProperties
}
export function authLegalLinks(config: ConfigzConfigResponse | null) {
  return [
    config?.links.privacyUri ? ['Privacy', config.links.privacyUri] : null,
    config?.links.termsUri ? ['Terms', config.links.termsUri] : null,
    config?.links.supportUri
      ? ['Support', config.links.supportUri]
      : config?.links.supportEmail
        ? ['Support', `mailto:${config.links.supportEmail}`]
        : null,
  ].filter((link): link is [string, string] => link !== null)
}
function AuthPageFooter({ links }: { links: Array<[string, string]> }) {
  return (
    <footer className="authPageFooter">
      {links.length > 0 ? (
        <nav className="authLegalLinks" aria-label={tt('auth.hostedLegalLinks')}>
          {links.map(([label, href]) => (
            <a href={href} key={label}>
              {tt(label)}
            </a>
          ))}
        </nav>
      ) : (
        <span />
      )}
      <p className="authPoweredBy">{tt('Secured by Realmroot')}</p>
    </footer>
  )
}

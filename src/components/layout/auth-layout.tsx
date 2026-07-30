import type { ConfigzConfigResponse } from '@shared/api/configz'
import { ArrowLeft } from 'lucide-react'
import { type CSSProperties, createElement, type ReactNode, useEffect } from 'react'
import { tt } from '@/lib/i18n'

type AuthLayoutProps = {
  children: ReactNode
  config: ConfigzConfigResponse | null
  backHref?: string
  backLabel?: string
  eyebrow?: string
  icon?: ReactNode
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
  title,
  description,
  variant = 'form',
}: AuthLayoutProps) {
  const style = brandingStyle(config)
  useEffect(() => {
    if (!config?.branding.faviconUrl) return
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.createElement('link')
    link.rel = 'icon'
    link.href = config.branding.faviconUrl
    document.head.appendChild(link)
  }, [config?.branding.faviconUrl])
  return (
    <main className={`authShell authShell-${variant}`} style={style} aria-label={tt('auth.hostedAuthentication')}>
      {backHref ? (
        <a className="authBackLink" href={backHref}>
          <ArrowLeft aria-hidden="true" size={16} />
          {backLabel ?? tt('auth.back')}
        </a>
      ) : null}
      <AuthCardFrame
        brand={icon ? <div className="authMessageIcon">{icon}</div> : <BrandIdentity config={config} />}
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
  return (
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
      <AuthLegalLinks links={legalLinks} />
      <p className="authPoweredBy">
        {tt('auth.poweredBy', {
          productName,
        })}
      </p>
    </section>
  )
}
export function BrandIdentity({ config }: { config: ConfigzConfigResponse | null }) {
  const productName = config?.copy?.productName ?? 'Realmroot'
  return (
    <a className="brand brandLink" href="/">
      {config?.branding.logoUrl ? (
        <img className="brandLogo" src={config.branding.logoUrl} alt="" width="36" height="36" />
      ) : (
        <span className="brandMark">{productName.slice(0, 1).toUpperCase()}</span>
      )}
      <span>{productName}</span>
    </a>
  )
}
export function brandingStyle(config: ConfigzConfigResponse | null): CSSProperties {
  const branding = config?.branding
  return {
    '--brand-primary': branding?.primaryColor ?? '#b42318',
    '--brand-background': branding?.backgroundColor ?? '#f7f3ee',
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
    config?.links.termsUri ? ['Terms', config.links.termsUri] : null,
    config?.links.privacyUri ? ['Privacy', config.links.privacyUri] : null,
    config?.links.supportEmail ? ['Support', `mailto:${config.links.supportEmail}`] : null,
  ].filter((link): link is [string, string] => link !== null)
}
function AuthLegalLinks({ links }: { links: Array<[string, string]> }) {
  if (links.length === 0) return null
  return (
    <nav className="authLegalLinks" aria-label={tt('auth.hostedLegalLinks')}>
      {links.map(([label, href]) => (
        <a href={href} key={label}>
          {tt(label)}
        </a>
      ))}
    </nav>
  )
}

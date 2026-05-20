import type { ConfigzConfigResponse } from '@shared/api/configz'
import { ArrowLeft } from 'lucide-react'
import { type CSSProperties, type ReactNode, useEffect } from 'react'

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
  backLabel = 'Back',
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
    <main className={`authShell authShell-${variant}`} style={style} aria-label="Hosted authentication">
      {backHref ? (
        <a className="authBackLink" href={backHref}>
          <ArrowLeft aria-hidden="true" size={16} />
          {backLabel}
        </a>
      ) : null}
      <section className="authPanel" aria-labelledby="auth-title">
        <div className="authBrandPanel">
          {icon ? <div className="authMessageIcon">{icon}</div> : <BrandIdentity config={config} />}
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h1 id="auth-title">{title}</h1>
          <p>{description}</p>
        </div>
        <div className="authContent">{children}</div>
        <AuthLegalLinks config={config} />
        <p className="authPoweredBy">Powered by {config?.copy?.productName ?? 'FlareAuth'}</p>
      </section>
    </main>
  )
}

export function BrandIdentity({ config }: { config: ConfigzConfigResponse | null }) {
  const productName = config?.copy?.productName ?? 'FlareAuth'
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

function AuthLegalLinks({ config }: { config: ConfigzConfigResponse | null }) {
  const links = [
    config?.links.termsUri ? ['Terms', config.links.termsUri] : null,
    config?.links.privacyUri ? ['Privacy', config.links.privacyUri] : null,
    config?.links.supportEmail ? ['Support', `mailto:${config.links.supportEmail}`] : null,
  ].filter((link): link is [string, string] => link !== null)

  if (links.length === 0) return null

  return (
    <nav className="authLegalLinks" aria-label="Hosted authentication legal links">
      {links.map(([label, href]) => (
        <a href={href} key={label}>
          {label}
        </a>
      ))}
    </nav>
  )
}

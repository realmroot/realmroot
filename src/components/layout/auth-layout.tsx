import type { ConfigzConfigResponse } from '@shared/api/configz'
import { type CSSProperties, type ReactNode, useEffect } from 'react'

type AuthLayoutProps = {
  children: ReactNode
  config: ConfigzConfigResponse | null
  eyebrow?: string
  title: string
  description: string
}

export function AuthLayout({ children, config, eyebrow, title, description }: AuthLayoutProps) {
  const style = brandingStyle(config)

  useEffect(() => {
    if (!config?.branding.faviconUrl) return

    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.createElement('link')
    link.rel = 'icon'
    link.href = config.branding.faviconUrl
    document.head.appendChild(link)
  }, [config?.branding.faviconUrl])

  return (
    <main className="authShell" style={style}>
      <section className="authBrandPanel">
        <BrandIdentity config={config} />
        <div>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </section>
      <section className="authPanel" aria-label={title}>
        {children}
      </section>
    </main>
  )
}

export function BrandIdentity({ config }: { config: ConfigzConfigResponse | null }) {
  const productName = config?.copy?.productName ?? 'FlareAuth'
  return (
    <a className="brand brandLink" href="/">
      {config?.branding.logoUrl ? (
        <img className="brandLogo" src={config.branding.logoUrl} alt="" />
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

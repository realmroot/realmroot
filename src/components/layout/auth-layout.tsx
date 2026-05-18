import type { ExperienceConfigResponse } from '@shared/api/experience'
import type { ReactNode } from 'react'

type AuthLayoutProps = {
  children: ReactNode
  config: ExperienceConfigResponse | null
  eyebrow?: string
  title: string
  description: string
}

export function AuthLayout({ children, config, eyebrow, title, description }: AuthLayoutProps) {
  const branding = config?.branding
  const style = {
    '--brand-primary': branding?.primaryColor ?? '#b42318',
    '--brand-background': branding?.backgroundColor ?? '#f7f3ee',
  } as React.CSSProperties

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

export function BrandIdentity({ config }: { config: ExperienceConfigResponse | null }) {
  const productName = config?.copy.productName ?? 'FlareAuth'
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

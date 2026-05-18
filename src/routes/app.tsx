import { KeyRound, ShieldCheck, UsersRound } from 'lucide-react'

const features = [
  {
    icon: ShieldCheck,
    title: 'Identity provider',
    description: 'Better Auth runs as the central issuer for every application that trusts this deployment.',
  },
  {
    icon: KeyRound,
    title: 'OIDC clients',
    description: 'Applications integrate through standard authorization code + PKCE instead of a custom SDK.',
  },
  {
    icon: UsersRound,
    title: 'Account center',
    description: 'The admin and account surfaces live here, while product apps stay focused on product code.',
  },
]

export function App() {
  return (
    <main className="shell">
      <nav className="topbar">
        <div className="brand">
          <span className="brandMark">F</span>
          <span>FlareAuth</span>
        </div>
        <div className="actions">
          <a href="/sign-in">Sign in</a>
          <a href="/sign-up">Sign up</a>
          <a className="primaryAction" href="/account">
            Account
          </a>
        </div>
      </nav>

      <section className="hero">
        <p className="eyebrow">Cloudflare-native identity</p>
        <h1>One auth service for every app on your edge.</h1>
        <p className="intro">
          FlareAuth is the shared login, account, and OIDC provider layer for projects deployed on Cloudflare.
        </p>
      </section>

      <section className="featureGrid" aria-label="Core responsibilities">
        {features.map((feature) => (
          <article className="feature" key={feature.title}>
            <feature.icon aria-hidden="true" size={22} />
            <h2>{feature.title}</h2>
            <p>{feature.description}</p>
          </article>
        ))}
      </section>
    </main>
  )
}

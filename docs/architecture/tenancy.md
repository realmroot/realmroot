# Tenancy Model

Status: accepted for FlareAuth v1.0

## Decision

FlareAuth v1.0 is a single user pool auth realm.

One FlareAuth deployment has:

- one Better Auth user pool
- one issuer
- one administrator surface
- one set of login, MFA, connector, email, and security policies
- one D1 database, R2 bucket, email queue, and secret set per environment

Multiple product applications can share a deployment by registering separate
OIDC applications. This is the expected path when products share the same user
accounts and operator model.

Products that need separate user pools must use separate FlareAuth deployments.
That means a separate Worker, D1 database, R2 bucket, queue, domain, and
`BETTER_AUTH_SECRET` for each product auth realm.

## Terms

- User pool: the set of users, credentials, sessions, linked accounts, passkeys,
  MFA factors, and consents stored by one deployment.
- Auth realm: the issuer and protocol boundary for one user pool.
- Application: an OIDC client registered inside a realm. It is not an isolation
  boundary for users or administrators.
- Organization: an authorization and membership object inside a realm. It is not
  a separate user pool.
- Product deployment: a complete Cloudflare resource set for one auth realm.

## Supported Sharing

A single deployment can serve multiple product applications when those products
intentionally share identity:

- Users sign in with the same account across products.
- Administrators manage all applications from the same Console.
- Login methods, connectors, MFA policy, email sender, and security policy are
  shared.
- OIDC clients, redirect URIs, branding, API resources, roles, and consents are
  managed per application where the data model supports it.

## Unsupported Sharing

Do not use one deployment for products that need independent identity
boundaries:

- same email allowed to register as different users per product
- separate administrator populations
- separate issuer or JWKS lifecycle
- separate OAuth or SSO provider configuration
- separate login, MFA, passkey, or password policies
- hard data isolation between product user pools
- independent incident response, backup, or deletion lifecycle

These are multi-realm requirements. Deploy another FlareAuth instance instead
of adding application-level exceptions to one shared database.

## Why

Better Auth's organization plugin supports organization membership, invitations,
teams, and organization-scoped access control inside one user pool. It does not
turn one Better Auth instance into multiple independent user pools with
tenant-scoped email uniqueness, separate issuer metadata, separate provider
configuration, and separate administrative realms.

Cloudflare D1 also does not provide row-level security. Implementing multiple
auth realms in one D1 database would make every query and every Better Auth
integration point tenant-sensitive. A missed predicate would become an identity
data leak. FlareAuth v1.0 avoids that risk by making the deployment the realm
boundary.

## Deployment Pattern

Use one production and one staging resource set per auth realm:

```text
product-a-auth Worker
product-a-auth-db
product-a-auth-db-staging
product-a-auth-assets
product-a-auth-assets-staging
product-a-auth-email
product-a-auth-email-staging
```

Each product deployment owns its own secrets:

```text
BETTER_AUTH_SECRET
BETTER_AUTH_URL
TRUSTED_ORIGINS
WEBAUTHN_RP_ID
EMAIL_FROM
EMAIL_FROM_NAME
```

Use one GitHub fork for each new product auth realm. The fork workflow checks
out canonical upstream source, provisions or reuses the realm's Cloudflare
resources, applies migrations, and deploys the Worker. Keep instance credentials
and resource overrides in the fork's GitHub Actions settings.

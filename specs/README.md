# Realmroot Behavior Specifications

The Feature files in this directory are the source of truth for observable
product behavior. They cover capabilities and journeys, not every HTTP
operation, database branch, component state, or implementation detail. The
runtime OpenAPI document owns the endpoint inventory; architecture documents
own technical boundaries.

## Capability coverage

| Product capability | Feature source |
| --- | --- |
| Deployment bootstrap, first administrator, route access, health | `platform-onboarding.feature` |
| Hosted sign-in, sign-up, recovery, OAuth/OIDC consent and callbacks | `hosted-auth.feature` |
| User profile, credentials, MFA, sessions, linked accounts, Organizations | `account-center.feature` |
| Connector-backed authentication methods and availability | `connectors-and-methods.feature` |
| Realm Console administration and operational settings | `admin-console.feature` |
| Unified Resource API, discovery, Toolbox and machine administration | `management-api.feature` |
| Stable Agent identity, Permissions, Resource access and token delegation | `agent-identity.feature` |

This map is complete for the current top-level product surfaces. A new surface
must either extend the owning Feature or add a Feature and update this map.

## Scenario contract

Every scenario declares:

- exactly one `@journey:<id>`, unique within its Feature file name;
- exactly one `@entrypoint:product-ui|agent-protocol|restish`;
- exactly one canonical `@proof:unit|integration|e2e`;
- `@e2e` if and only if its canonical proof is Playwright E2E.

The canonical test includes `[spec: <feature-stem>/<journey>]` in its name.
Additional tests may carry the same breadcrumb when another boundary deserves
representative proof. The canonical layer remains the cheapest layer that
completely proves the behavior:

- `unit`: domain rules, use-case orchestration, error handling, and browser
  component behavior with controlled dependencies;
- `integration`: behavior that requires the real router, middleware, workerd,
  D1, migration, serialization, or another application boundary;
- `e2e`: a small critical journey through the real browser and application.

Run `pnpm run spec:check` after changing a Feature or breadcrumb. The gate
rejects duplicate or missing scenario identities, unsupported or mismatched
proof layers, missing proofs, and test breadcrumbs with no declared scenario.

## Completeness rule

A product behavior is missing when a user, Agent, Application, operator, or
downstream Resource can observe an outcome that no scenario specifies. Pure
refactors, internal algorithms, schema helpers, and protocol mechanics already
owned by an external standard do not become scenarios unless Realmroot adds an
observable policy choice.

When adding or changing behavior:

1. Update the scenario first.
2. Choose its canonical proof layer.
3. Add or update the proving test with the stable breadcrumb.
4. Run the exact affected test, then `pnpm run spec:check`.

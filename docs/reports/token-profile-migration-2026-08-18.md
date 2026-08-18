# Token Profile Migration Report — 2026-08-18

## Outcome

Realmroot production now uses a single standards-oriented JWT access-token profile for normal OAuth grants, Agent flows, Application DPoP tokens, and RFC 8693 token exchange. ID Tokens and UserInfo remain identity-only. Existing top-level `roles` and `groups` claims remain supported.

The Application/Client model was intentionally not changed. Existing Application registrations remain valid, including legacy Management API clients that still send `oidcClaims`.

Production evidence is recorded in [evidence/token-profile-migration-2026-08-18.json](./evidence/token-profile-migration-2026-08-18.json).

## Issued Token Contract

- OAuth access tokens are signed JWTs with `typ=at+jwt` and `iss`, `sub`, `aud`, `iat`, `exp`, `jti`, `client_id`, and `scope`.
- User grants use the User as `sub`.
- Client-credentials and Application DPoP tokens use the Application as `sub`.
- Agent bootstrap tokens use the Agent as `sub` and `client_id=realmroot-cli`; bootstrap/host binding is isolated in `urn:realmroot:params:agent:binding`.
- Agent resource tokens use the owner as `sub`, the Agent as `act`, and `client_id=realmroot-cli`.
- RFC 8693 workload exchange preserves the exchanged workload as `sub`. Realmroot's workload profile does not accept `actor_token`, so these tokens do not emit `act`.
- Tenant context uses `urn:realmroot:params:oauth:tenant` and is constrained to the selected Organization and Resource owner membership.
- `roles` and `groups` remain top-level access-token claims. The duplicate nested `authorization` claim is no longer issued.
- New access tokens do not issue `azp`, `application_id`, or top-level `organization_id`.
- ID Tokens and UserInfo do not contain roles, groups, tenant, Application, or other authorization claims.
- Token-exchange access tokens and refreshed access tokens are JWTs. Refresh tokens remain opaque, rotating credentials.
- Legacy opaque `fatx_` access tokens remain introspectable until expiry or revocation.
- Legacy Agent token shapes remain accepted only for already-issued short-lived tokens.

The Better Auth patch may read legacy `azp` during introspection, but returns the normalized `client_id` claim.

## Compatibility Decisions

The fixed CLI identifier is `realmroot-cli`. A current CLI sends it explicitly. The server also accepts an omitted bootstrap `client_id` for the already-deployed CLI and always normalizes the issued claim to `realmroot-cli`; arbitrary identifiers are rejected. This is an explicit backward-compatibility contract, not a dated migration window. It can be removed only after deployed CLI adoption is observable.

Existing Management API callers may continue sending a valid legacy `oidcClaims` object on Application create/update. Realmroot ignores per-Application claim customization and returns the fixed platform profile:

```json
{
  "accessToken": { "roles": true, "groups": true },
  "idToken": {},
  "userInfo": {}
}
```

Machine Applications with token-exchange support were additively migrated to include `refresh_token` and `offline_access`. No Application ID, client ID, redirect URI, secret, consent, or ownership record was replaced.

## Production Deployment

The additive D1 migrations `20260818040000_enable_machine_exchange_refresh.sql` and `20260818050000_atomic_exchange_refresh_rotation.sql` were applied before the final Realmroot deployment. Refresh rotation now consumes the parent and stores the child refresh/access-token pair in one D1 transaction; concurrent reuse cannot mint two live children.

| Worker | Version |
| --- | --- |
| Realmroot | `f6ccefe7-c53e-4774-be82-08109a1fb405` |
| Realmroot Adapters | `51caa161-b21d-4aee-b394-798bd83dec44` |
| WakaToken | `93f27d22-8682-4074-b3b3-3cf3387705b1` |
| Agent Wallet | `72093319-34d3-4184-b2bb-b3595adb7e7e` |
| Agent Inbox | `1214d90d-30ee-447b-a3ca-4d9ff0c27ccd` |
| ZME | `1d1b1f56-7422-4768-9756-85f8a2f0127c` |
| ZPan | `035e60f8-16e1-4d42-8dda-c3a040a5db7e` |
| ZPan Staging | `8ecdc19e-0e3e-4577-a3b0-c94623f14dcc` |

WakaToken's obsolete `wkt.tftt.cc/*` Worker route was removed from deployment configuration. The hostname is a standalone HTTP 301 redirect to `wakatoken.com`; the final deployment updates only the canonical custom domain and completed without the earlier partial-route error.

## Application Acceptance

The registry contains 11 enabled Applications: 10 interactive clients and one machine client.

After the final deployment, every interactive client was checked through authorization initiation with its registered redirect URI, OIDC scopes, state, nonce, and S256 PKCE challenge. All 10 returned the Realmroot sign-in continuation without `invalid_client`, `invalid_redirect_uri`, PKCE, or scope errors. These checks establish registration and authorization-entry compatibility; they do not claim that ten separate end-user callbacks and client-side sessions were completed.

The machine client has no login surface. Its existing client ID and secret metadata remain intact, and its registered grants are `client_credentials`, RFC 8693 token exchange, and refresh token with `offline_access`. Real D1/JWS integration tests cover initial exchange, JWT refresh, atomic rotation, and legacy opaque introspection; a focused signer-failure test proves no token is persisted when signing fails.

## Resource Server Acceptance

All 13 enabled production/staging Resource Server registrations passed discovery-contract acceptance: RFC 9728 metadata returned an exact `resource` match and each advertised OpenAPI document was readable and used OpenAPI 3.x:

- Realmroot;
- GitHub, Linear, and Cloudflare adapters;
- ZPan production and staging;
- ZME;
- Agent Wallet and Agent Inbox;
- WakaToken;
- Echola AppBase;
- Sublyra;
- Vocnet Learning.

Affected validators were upgraded and deployed in WakaToken, Adapters, Wallet, Inbox, and ZME. ZPan, Vocnet, Echola, and Sublyra were source-audited and already validate the required issuer/audience/scope or actor boundaries without relying on removed claims; ZPan production and staging were also rebuilt, tested, and redeployed as acceptance baselines.

Four post-deployment Agent token paths were exercised end to end: Realmroot inventory, Cloudflare deployment operations, GitHub rate-limit access with an approved Context, and ZME downloader inventory. This is the live token-path acceptance set, distinct from the 13 discovery-contract checks. Wallet and Inbox were correctly stopped before Resource access because Jarvis does not have `wallet:read` or `mailbox:read`; authority was not silently expanded. Their token validators, plus WakaToken, Adapters, and ZPan, are covered by local executable tests and builds rather than an overclaimed live Resource call.

Linear's external provider grant was already stale. Restoring it requires controller/provider authorization and is separate from token parsing compatibility, so no reauthorization was performed silently.

The Adapters deployment preserved pre-existing user-owned Linear changes. The combined worktree passed its complete test, type, lint, documentation, and build gates before deployment.

## Quality Gates

- Realmroot: typecheck, 180-scenario spec trace, 200-file/1558-test suite, coverage gate, 10 browser E2E journeys, lint, architecture lint, build, and `git diff --check` all passed.
- WakaToken: 34 files/570 tests, typecheck, and production build passed.
- Adapters: 29 files/184 tests, typecheck, lint, documentation checks, and build passed.
- Wallet: 5 files/54 tests, typecheck, and build passed.
- Inbox: 3 files/13 tests and typecheck passed.
- ZME: 65 files/414 tests, typecheck, lint, and build passed.
- ZPan: 275 files/5546 tests, typecheck, and build passed.

Token boundary coverage includes signed ID Token and UserInfo payload exclusions, standard access-token claims, an HTTP Agent bootstrap flow with a real signed-and-verified JWS, Agent resource shapes, Application DPoP tokens, RFC 8693 workload-subject semantics, real D1/JWS exchange and refresh, atomic refresh rotation failure safety, and legacy opaque introspection.

## Consumer Migration Guidance

- Read `client_id`, not `azp` or `application_id`.
- Read the tenant from `urn:realmroot:params:oauth:tenant`, not top-level `organization_id`.
- Continue reading authorization from top-level access-token `roles`, `groups`, and `scope`; do not read nested `authorization`.
- Do not use ID Token or UserInfo as authorization inputs.
- Verify exchanged JWT access tokens by issuer, exact audience, signature, expiry, and scope. Do not assume new exchange access tokens start with `fatx_`.
- For Agent resource access, require `client_id=realmroot-cli` and an `act` object with a valid `sub` and issuer provenance; do not require the retired `act.sub_profile` claim.

## Rollback

There is no safe rollback target predating these fixes: earlier versions either issue the old profile or lack atomic refresh rotation. Both additive migrations remain in place. Recovery is roll-forward by redeploying the digest-bound final artifact (or the matching Cloudflare version) with the same token semantics. Do not move a Resource Server back to a validator that requires removed claims.

## Identity Use Audit

Agent identity `Jarvis` performed the final database migration, all final deployments, production inventory, Application/Resource Server checks, Cloudflare/GitHub/ZME/Realmroot live calls, and read-only D1 queries.

The evidence attachment records Jarvis's Realmroot Agent identity, host, Resource, action/result, and the audit-event IDs/timestamps corresponding to each final Cloudflare operation. It also records each Cloudflare deployment ID, timestamp, version, and digest-bearing deployment message, binding the deployed version to the reproducible source digest without storing credentials or tokens.

The user's identity was used for exactly two earlier operations:

1. The user's Cloudflare credentials executed one corrective Realmroot deployment after the preceding release temporarily prevented the old Agent CLI from acquiring its bootstrap token.
2. The user's existing Realmroot browser session opened the Account Center Connections page to inspect Linear state. No reauthorization was started, no permission was changed, and no credential or secret was read.

No final-review fix, migration, consumer deployment, or final acceptance operation used the user's identity.

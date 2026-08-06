# Native Resource Server Example

This Node 24 example is a standalone protected API that uses Realmroot as its
authorization server. It does not implement a second OAuth server, target
account connection, client registration, token exchange, or revocation
endpoint.

It implements only the native resource-server responsibilities:

- RFC 9728 protected resource metadata and scope discovery
- RFC 8631 OpenAPI discovery
- optional OpenAPI operation-to-scope mapping
- Realmroot issuer and JWKS validation
- audience and `at+jwt` validation
- RFC 9449 DPoP proof and `ath` validation

Run it against a local Realmroot deployment:

```bash
REALMROOT_ORIGIN=http://localhost:4189 pnpm run example:resource-native
```

The default protected resource is:

```text
http://127.0.0.1:4101/api
```

Create a native API Resource in Realmroot with:

```json
{
  "identifier": "native-projects",
  "name": "Native Projects API",
  "resourceUrl": "http://127.0.0.1:4101/api",
  "enabled": true
}
```

Realmroot discovers `projects:read` from the RFC 9728 metadata and its operation
mapping from `/openapi.json`. No external
authorization configuration or account connection is used.

See the
[resource server integration guide](../../docs/integrations/resource-servers.md)
for the production token and DPoP validation checklist.

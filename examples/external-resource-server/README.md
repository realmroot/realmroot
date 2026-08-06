# External Resource Server Example

This Node 24 example is a standalone target platform for Realmroot external API
authorization. It owns its users, OAuth authorization server, signing keys, and
access-token lifecycle. Realmroot is a standards-based OAuth client and never
proxies target API traffic.

The example implements:

- RFC 9728 protected resource metadata
- RFC 8414 authorization server metadata
- RFC 7591 dynamic client registration
- authorization code with S256 PKCE and refresh credentials
- RFC 7523 JWT bearer grant for an Agent actor token
- RFC 8693 subject/actor token exchange
- RFC 9449 DPoP-bound access tokens
- RFC 7009 token revocation
- RFC 8631 OpenAPI discovery

Run it independently:

```bash
pnpm run example:resource-external
```

The default protected resource is:

```text
http://127.0.0.1:4100/api
```

It advertises `/openapi.json` through a `service-desc` Link header. The demo
authorization endpoint selects `demo-user` automatically; a production target
uses its normal sign-in and consent experience.

Create a dynamic standard OIDC Connector for this server, then create an
external API Resource in Realmroot with the returned Connector ID:

```json
{
  "identifier": "external-projects",
  "name": "External Projects API",
  "resourceUrl": "http://127.0.0.1:4100/api",
  "connectorId": "idp_example"
}
```

Realmroot discovers `projects:read` from RFC 9728 protected-resource metadata;
the OpenAPI operation security requirement maps the operation to that scope.

See the
[resource server integration guide](../../docs/integrations/resource-servers.md)
for the production contract and validation checklist.

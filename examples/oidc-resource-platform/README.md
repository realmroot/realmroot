# OIDC resource platform example

This Node 24 example is the target-platform side of FlareAuth external API authorization. It intentionally runs as a separate process and receives target-issued tokens directly; FlareAuth never proxies API traffic.

It implements:

- RFC 9728 protected resource metadata
- RFC 8414 authorization server metadata
- RFC 7591 dynamic client registration
- OIDC authorization code with S256 PKCE and refresh credentials
- RFC 7523 JWT bearer grant for a target-issued Agent access token
- RFC 8693 subject/actor token exchange
- RFC 9449 DPoP-bound access tokens
- RFC 7009 token revocation

The integration uses only registered OAuth/OIDC fields and identifiers. The
platform validates the Agent assertion through the OAuth client's standard
`jwks_uri`, issues its own Actor access token, and accepts that access token in
RFC 8693. It does not configure FlareAuth as an identity provider and does not
implement a FlareAuth-specific grant, token type, metadata field, or claim.

Run it with `pnpm run example:resource-platform`. Its protected resource URL is `http://127.0.0.1:4100/api`. The demo authorization endpoint automatically selects `demo-user`; production platforms should use their normal login and consent experience.

In FlareAuth Console, create an external API Resource with audience `http://127.0.0.1:4100/api`, add the `projects:read` and `projects:write` scopes, then configure external authorization using the same resource URL and dynamic registration.

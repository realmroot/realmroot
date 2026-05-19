# FlareAuth Management API

Status: maintained contract for FlareAuth v1.0.

The Management API is mounted at:

```text
/api/management
```

The older `/api/admin/*` routes remain available for the operator UI and compatibility, but `/api/management/*` is the public v1.0 contract.

## Authentication And Authorization

Every Management API route requires an authenticated administrator session. Requests without a session return `401`; authenticated non-admin users return `403`.

Future machine-to-machine management tokens should preserve the same authorization boundary: callers need a management role or scope that is equivalent to administrator access for the requested resource.

## Error Shape

All Management API errors use the same JSON envelope:

```json
{
  "error": {
    "code": "bad_request",
    "message": "Invalid request.",
    "requestId": "request-id"
  }
}
```

`code` is one of `bad_request`, `unauthorized`, `forbidden`, `not_found`, or `internal_error`.

## Pagination

Collection endpoints accept:

- `limit`: integer, `1` to `100`.
- `offset`: integer, `0` or greater.

Collection responses include:

```json
{
  "pagination": {
    "limit": 20,
    "offset": 0,
    "total": 42,
    "hasMore": true,
    "nextOffset": 20
  }
}
```

`nextOffset` is `null` when there is no next page.

## Resource Groups

- Users: `/users`, `/users/{id}`, `/users/{id}/linked-accounts`, `/users/{id}/applications`, `/users/{id}/sessions`.
- User account actions: `POST /users/password-reset-requests`, `PUT /users/{id}/ban`, `DELETE /users/{id}/ban`.
- Applications: `/applications`, `/applications/{id}`, `/applications/{id}/redirect-uris`, `/applications/{id}/client-secrets`, `POST /applications/{id}/logo`.
- Connectors: `GET /connectors`, `POST /connectors`, `GET /connectors/{id}`, `PATCH /connectors/{id}`, `DELETE /connectors/{id}`.

Application resources are OIDC clients. `POST /applications` returns the created application; confidential clients include `clientSecret` in that creation response only. `GET /applications/{id}` returns client metadata, redirect URIs, allowed grant types, allowed scopes, token endpoint auth method, and discovery endpoint URLs. `PATCH /applications/{id}` updates metadata and lifecycle fields including `disabled`; lifecycle transitions do not use action endpoints. `DELETE /applications/{id}` deletes the application and its provider client.

Redirect URIs are replaced as a set with `PUT /applications/{id}/redirect-uris`:

```json
{
  "redirectUris": ["https://app.example.com/callback"]
}
```

Client secret endpoints are only for confidential clients. `GET /applications/{id}/client-secrets` returns secret metadata only. `POST /applications/{id}/client-secrets` rotates the active secret and returns the raw `clientSecret` exactly once in the response; list and detail responses never return raw secret material.

Connector responses use the same stable connector contract as the admin connector API: provider type/id, display name, enabled flag, OAuth endpoints, client id, secret binding reference, scopes, and provider metadata. Secret values are not returned; `clientSecretBinding` is a reference to deployment-managed secret material.

Connector `providerType` is restricted to `social` and `generic_oauth`, matching the values loaded into Better Auth. Connector creation requires `clientId` and `clientSecretBinding`; generic OAuth creation also requires either `issuer` or `authorizationEndpoint`, and requires `tokenEndpoint` when `issuer` is not provided. Updates can clear nullable configuration fields, but enabled connectors must remain loadable by Better Auth. `providerId` is globally unique because Better Auth uses it as the provider key.
- Sign-in settings: `/sign-in-settings`.
- Readiness: `/readiness`.
- Organizations: `/organizations`, `/organizations/{id}`, `POST /organizations/{id}/logo`, `/organizations/{id}/members`, `/organizations/{id}/invitations`.
- Branding assets: `POST /branding/logo`, `POST /branding/favicon`.
- Roles: `/roles`, `/roles/{id}`, `/roles/{id}/permissions`.
- Role assignments: `/user-role-assignments`, `/application-role-assignments`, `/member-role-assignments`.
- API resources and scopes: `/api-resources`, `/api-resources/{id}`, `/api-resources/{id}/scopes`, `/api-resources/{id}/permissions`.
- Security administration: `/security/policy`, `/security/users/{id}`, `/security/users/{id}/passkeys`, `/security/users/{id}/passkeys/{passkeyId}`, `/security/users/{id}/sessions`, `/security/users/{id}/sessions/{sessionId}`.

Security administrators can delete a user passkey with `DELETE /security/users/{id}/passkeys/{passkeyId}`, revoke all user sessions with `DELETE /security/users/{id}/sessions`, and revoke one user session with `DELETE /security/users/{id}/sessions/{sessionId}`.

## Asset Uploads

Asset uploads use `multipart/form-data` with a single `file` field. Application, organization, and branding uploads require an administrator session. Successful uploads return the asset metadata and assign the uploaded asset to the target resource.

Supported files:

- Application, organization, and branding logos: PNG, JPEG, or WebP up to 2 MB.
- Favicons: PNG, WebP, ICO, or Microsoft icon up to 512 KB.

Uploaded assets are returned with a same-origin public URL at `/api/assets/{assetId}`. The Worker serves that URL from the private R2 bucket with immutable cache headers.

## Readiness

`GET /readiness` returns protected Console setup state. The admin route guard uses this response to decide whether `/admin/*` should continue to the requested product route or redirect to `/admin/onboarding`.

```json
{
  "admin": {
    "setupRequired": true,
    "setupHref": "/admin/onboarding",
    "missing": ["oidc_application"]
  }
}
```

`missing` currently contains `oidc_application` when no OIDC client exists. Future readiness checks should add explicit enum values rather than overloading this field with display copy.

The maintained OpenAPI contract lives in [management.openapi.json](./management.openapi.json).

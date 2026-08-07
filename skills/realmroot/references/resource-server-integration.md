# Resource Server Integration

Use the live Realmroot and target contracts. Do not require repository access,
example code, private database access, or hard-coded deployment IDs.

## Provider Contract

Every protected API publishes:

1. RFC 9728 metadata at the well-known URL derived from its protected resource
   URL. It declares the exact `resource`, authorization server, and supported
   scopes.
2. A successful response from the protected resource URL with a standard
   `service-desc` Link to its OpenAPI document.
3. OpenAPI operations whose security requirements use only scopes advertised
   by RFC 9728.

The protected resource URL is the OAuth resource indicator and access-token
audience. Keep it stable.

A **native** Resource Server validates Realmroot-issued access tokens with the
published issuer and JWKS. It needs no Connector or account connection.

An **external** Resource Server owns its authorization server and tokens. Its
OAuth metadata must support the flows declared by the live Realmroot contract.
Configure a generic OAuth Connector before registering the Resource Server; a
controller connects an account before the Agent requests resource access.

## Obtain Integration Authority

Follow [management.md](management.md). Select the Realmroot Platform
Organization Resource when the task needs Connector mutations or an external
Resource Server mutation. Inspect the live OpenAPI operations, then request
their complete scope union in one `access` command. This produces one
controller approval and one platform Organization credential for the
integration task.

## Register A Native Resource Server

1. Read the live create-Resource-Server operation and schema.
2. Create an enabled Resource Server with its stable protected resource URL,
   explicit owner, visibility, and Agent availability. Do not set a Connector.
3. Read the created representation. Confirm `connectorId` is null and the
   scope registry was populated from RFC 9728 without an error.
4. Discover it through the Agent Resource Server collection and confirm its
   connection status is `not_required`.

## Register An External Resource Server

External Resource Servers are platform integrations. Do not register one for
an ordinary Organization or attempt to transfer one out of the built-in
Realmroot Platform Organization.

1. Read the live create-Connector schema. Create a generic OAuth Connector from
   the provider issuer and advertised registration mode. Keep it disabled only
   when intentionally saving an incomplete draft.
2. Read the Connector response and use its returned canonical ID.
3. Create the Resource Server with that Connector ID, its protected resource
   URL, the returned platform Organization owner, visibility, and Agent
   availability.
4. Read the created representation. Confirm external authorization is active
   and the scope registry matches RFC 9728.
5. Use the normal `connect` command from
   [restish-commands.md](restish-commands.md). Wait for the controller's OAuth
   account connection to complete, then rediscover Resources.

Never manually copy provider access or refresh tokens into Restish.

## Discover Commands And Prove Access

For either mode:

1. Connect Restish to the returned `serviceUrl` and inspect generated help.
2. Bind the target OpenAPI security scheme to `realmroot-target` as described
   in [restish-commands.md](restish-commands.md).
3. Set that credential binding's `satisfies` list to the scopes declared by the
   target operations being used. This is Restish's local operation-selection
   metadata; it is not authority and does not grant access.
4. List the Resource Server's Resources and select a returned canonical
   `links.self`.
5. Request the union of scopes needed by the acceptance operations in one
   `access` command.
6. Invoke a generated read operation. When the contract exposes a safe write
   operation, invoke it and read the result back.

Acceptance is complete only after a real target operation succeeds. A created
configuration, connected account, approved request, or ready credential is an
intermediate state.

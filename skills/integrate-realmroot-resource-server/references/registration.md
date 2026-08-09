# Realmroot Resource Server Registration

Use the live Realmroot and target contracts. Do not require repository access,
example code, private database access, or hard-coded deployment IDs.

## Obtain Integration Authority

Use `$realmroot`. Select the Realmroot Platform
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
5. Use the normal Resource Server `connect` command through `$realmroot`.
   Wait for the controller's OAuth account connection to complete, then
   rediscover Resources.

Never manually copy provider access or refresh tokens into Restish.

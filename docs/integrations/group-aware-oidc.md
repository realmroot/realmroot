# Group-aware OIDC integrations

Realmroot uses Organizations as strict tenant boundaries and Better Auth Teams
as external OIDC groups. An Application is an OAuth client and trust boundary;
it does not represent one Kubernetes cluster or one Argo CD instance.

## Claims

Private Applications admit only active members of the owner Organization. Their
ID tokens always contain:

```json
{
  "urn:realmroot:params:oauth:org": "organization-id"
}
```

When the request is granted the `groups` scope, the ID token also contains the
names of Teams that the user joined in that Organization:

```json
{
  "groups": ["platform-admins", "production-readers"]
}
```

Team names are lowercase kebab-case and are emitted verbatim. Rename a Team only
after updating every downstream RoleBinding or role mapping. Realmroot roles,
permission rules, and Resource scopes are not placed in ID tokens. Access
tokens use the same Organization and Team claims while retaining approved
Resource scopes and effective Resource roles.

Public Applications allow any Realmroot user to authenticate. They do not grant
an external user the owner Organization claim or its Team groups.

## Kubernetes

Create one private `public_native` Application for an Organization and enable
device login. All of the Organization's clusters can trust the same issuer and
client ID:

Configure the CLI or OIDC login helper to request
`openid profile email groups`. The API server flag below reads `groups`; it does
not request that scope on the client's behalf.

```text
--oidc-issuer-url=https://realmroot.example/api/auth
--oidc-client-id=YOUR_KUBERNETES_CLIENT_ID
--oidc-username-claim=email
--oidc-groups-claim=groups
```

Each cluster keeps its own authorization policy. For example:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: platform-admins
subjects:
  - kind: Group
    name: platform-admins
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: cluster-admin
  apiGroup: rbac.authorization.k8s.io
```

A Token can authenticate to every cluster sharing that Application. The local
RoleBindings and ClusterRoleBindings decide what it may do in each cluster.

## Argo CD

Use a separate private `confidential_web` Application because Argo CD has a
client-secret boundary. Register every instance's exact callback URI on that
Application, then configure each instance:

```yaml
data:
  oidc.config: |
    name: Realmroot
    issuer: https://realmroot.example/api/auth
    clientID: YOUR_ARGO_CD_CLIENT_ID
    clientSecret: $oidc.realmroot.clientSecret
    requestedScopes: ["openid", "profile", "email", "groups"]
```

Instances sharing the Application also share its client secret. If an instance
requires an independent secret or trust lifecycle, give it a separate
Application. Map Team names to Argo CD roles in each instance's own RBAC policy.

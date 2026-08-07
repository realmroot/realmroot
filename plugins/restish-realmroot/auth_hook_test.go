package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/rest-sh/restish/v2/plugin"
)

func TestAuthHookIgnoresUnmarkedProfiles(t *testing.T) {
	output, err := authenticateRequest(plugin.AuthHookInput{}, &memoryStateStore{}, roundTripFunc(nil), &promptRecorder{})
	if err != nil {
		t.Fatal(err)
	}
	if output.Request != nil {
		t.Fatalf("unexpected request update: %#v", output.Request)
	}
}

func TestProtocolCredentialRouteSelection(t *testing.T) {
	tests := []struct {
		method string
		path   string
		want   bool
	}{
		{http.MethodGet, "/api/agent/status", true},
		{http.MethodGet, "/api/resource-servers", true},
		{http.MethodGet, "/api/resource-servers/resource-1", true},
		{http.MethodGet, "/api/resource-servers/resource-1/resources", true},
		{http.MethodGet, "/api/resource-servers/resource-1/resources/service", true},
		{http.MethodPost, "/api/resource-servers/resource-1/connection-requests", true},
		{http.MethodGet, "/api/resource-servers/resource-1/connection-requests/request-1", true},
		{http.MethodPost, "/api/access/requests", true},
		{http.MethodGet, "/api/access/requests/request-1", true},
		{http.MethodPost, "/api/access/requests/request-1/credentials", true},
		{http.MethodGet, "/api/resource-servers/resource-1/contract", false},
		{http.MethodPut, "/api/resource-servers/resource-1/scope-registry", false},
		{http.MethodGet, "/api/resource-servers/resource-1/archival", false},
		{http.MethodGet, "/api/access/consents", false},
	}
	for _, test := range tests {
		t.Run(test.method+" "+test.path, func(t *testing.T) {
			got := usesProtocolCredential(test.method, "https://auth.example.com"+test.path)
			if got != test.want {
				t.Fatalf("usesProtocolCredential() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestAuthHookEnrollsOnceThenSignsOriginalRequest(t *testing.T) {
	t.Setenv("REALMROOT_AGENT_NAME", "Build Agent")
	requests := 0
	states := &memoryStateStore{}
	prompt := &promptRecorder{}
	client := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests++
		switch requests {
		case 1, 6:
			return jsonResponse(200, testAgentConfiguration()), nil
		case 2:
			return jsonResponse(200, map[string]any{
				"agent_id": "agent-123", "host_id": "host-123",
				"approval": map[string]any{
					"verification_uri_complete": "https://auth.example.com/agent/approve?code=abc",
					"expires_in":                600, "interval": 1,
				},
			}), nil
		case 3:
			return jsonResponse(200, map[string]any{"status": "active"}), nil
		case 4:
			if request.Method != http.MethodPost || request.URL.String() != "https://auth.example.com/api/auth/oauth2/token" {
				t.Fatalf("token request = %s %s", request.Method, request.URL)
			}
			if err := request.ParseForm(); err != nil {
				t.Fatal(err)
			}
			if request.Form.Get("grant_type") != "urn:ietf:params:oauth:grant-type:jwt-bearer" ||
				request.Form.Get("resource") != "https://auth.example.com/api" ||
				request.Form.Get("scope") != "agent:read resource-servers:read resources:read connection-requests:read connection-requests:write access-requests:read access-requests:write" ||
				request.Header.Get("DPoP") == "" {
				t.Fatalf("token request form = %#v", request.Form)
			}
			return jsonResponse(200, map[string]any{
				"access_token": "protocol-token", "token_type": "DPoP", "expires_in": 300,
			}), nil
		case 5:
			if request.Method != http.MethodGet || request.URL.String() != "https://auth.example.com/api/agent/status" {
				t.Fatalf("status request = %s %s", request.Method, request.URL)
			}
			return jsonResponse(201, map[string]any{"agent": map[string]any{
				"id": "agent-identity-1", "issuer": "https://auth.example.com/api/auth", "subject": "agt_123",
			}}), nil
		default:
			t.Fatalf("unexpected request: %s %s", request.Method, request.URL)
			return nil, nil
		}
	})
	input := plugin.AuthHookInput{
		API: "realmroot", Profile: "default", Params: map[string]string{"provider": authProvider},
		Request: plugin.HookRequest{Method: http.MethodGet, URI: "https://auth.example.com/api/agent-identities/current"},
	}

	output, err := authenticateRequest(input, states, client, prompt)
	if err != nil {
		t.Fatal(err)
	}
	if authorization, _ := output.Request.Headers["Authorization"].(string); authorization != "DPoP protocol-token" {
		t.Fatalf("missing OAuth DPoP token: %q", authorization)
	}
	if prompt.uri != "https://auth.example.com/agent/approve?code=abc" {
		t.Fatalf("approval URI = %q", prompt.uri)
	}
	if states.state.Identity == nil || states.state.Identity.Subject != "agt_123" {
		t.Fatalf("identity was not persisted: %#v", states.state.Identity)
	}
	if _, err := authenticateRequest(input, states, client, prompt); err != nil {
		t.Fatal(err)
	}
	if requests != 6 {
		t.Fatalf("second request repeated enrollment; requests = %d", requests)
	}
}

func TestAuthHookSignsTargetRequestWithCachedShortLivedCredential(t *testing.T) {
	t.Log("[spec: agent-identity/restish-resource-credential-lifecycle]")
	credential := testCredential(t, "access-token", time.Now().Add(time.Minute))
	states := newCredentialState(t, credential)
	input := targetHookInput()

	output, err := authenticateRequest(input, states, roundTripFunc(nil), &promptRecorder{})
	if err != nil {
		t.Fatal(err)
	}
	if output.Request.Headers["Authorization"] != "DPoP access-token" {
		t.Fatalf("authorization = %#v", output.Request.Headers["Authorization"])
	}
	claims := decodeJWTPayload(t, output.Request.Headers["DPoP"].(string))
	if claims["htm"] != http.MethodGet || claims["htu"] != "https://api.example.com/v1/projects" || claims["ath"] == "" {
		t.Fatalf("unexpected DPoP claims: %#v", claims)
	}
}

func TestAuthHookUsesConfiguredIssuerToSelectTargetIdentity(t *testing.T) {
	credential := testCredential(t, "access-token", time.Now().Add(time.Minute))
	states := newCredentialState(t, credential)
	input := targetHookInput()
	input.Params["issuer"] = "https://other.example.com/api/auth"

	_, err := authenticateRequest(input, states, roundTripFunc(nil), &promptRecorder{})
	if err == nil || !strings.Contains(err.Error(), "does not match the active Resource credential issuer") {
		t.Fatalf("issuer mismatch error = %v", err)
	}
}

func TestAuthHookExplainsMissingTargetCredential(t *testing.T) {
	states := newCredentialState(t, testCredential(t, "access-token", time.Now().Add(time.Minute)))
	states.state.DPoPCredentials = nil
	states.state.ActiveDPoPCredentials = nil

	_, err := authenticateRequest(targetHookInput(), states, roundTripFunc(nil), &promptRecorder{})
	if err == nil || !strings.Contains(err.Error(), "request Resource access") {
		t.Fatalf("missing credential error = %v", err)
	}
}

func TestAuthHookRejectsInvalidTargetIssuer(t *testing.T) {
	input := targetHookInput()
	input.Params["issuer"] = "not-a-url"
	_, err := authenticateRequest(input, newCredentialState(t, testCredential(t, "token", time.Now().Add(time.Minute))), roundTripFunc(nil), &promptRecorder{})
	if err == nil || !strings.Contains(err.Error(), "target issuer") {
		t.Fatalf("issuer validation error = %v", err)
	}
}

func TestAuthHookRenewsExpiredCredentialFromStoredOffer(t *testing.T) {
	t.Run("[spec: agent-identity/restish-resource-credential-lifecycle] [spec: agent-identity/restish-target-token-origin]", func(t *testing.T) {
		t.Log("[spec: agent-identity/restish-target-token-origin]")
		expired := time.Now().Add(-time.Minute)
		credential := testCredential(t, "expired-token", expired)
		states := newCredentialState(t, credential)
		client := roundTripFunc(func(request *http.Request) (*http.Response, error) {
			if request.Method != http.MethodPost || request.URL.String() != credential.CredentialEndpoint {
				t.Fatalf("credential request = %s %s", request.Method, request.URL)
			}
			if request.Header.Get("Authorization") != "DPoP protocol-token" {
				t.Fatal("missing Realmroot OAuth credential")
			}
			claims := decodeJWTPayload(t, request.Header.Get("DPoP"))
			if claims["htu"] != credential.CredentialEndpoint || claims["htm"] != http.MethodPost || claims["ath"] == "" {
				t.Fatalf("Realmroot request proof = %#v", claims)
			}
			var body struct {
				Proof struct {
					Value string `json:"value"`
				} `json:"proof"`
			}
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			targetClaims := decodeJWTPayload(t, body.Proof.Value)
			if targetClaims["htu"] != credential.ProofTarget || targetClaims["htm"] != http.MethodPost {
				t.Fatalf("target proof = %#v", targetClaims)
			}
			return jsonResponse(200, map[string]any{
				"accessToken": "renewed-token", "tokenType": "DPoP", "expiresAt": time.Now().Add(time.Minute),
				"resourceIndicator": credential.ResourceIndicator,
				"resource":          map[string]any{"href": credential.ResourceHref},
			}), nil
		})

		output, err := authenticateRequest(targetHookInput(), states, client, &promptRecorder{})
		if err != nil {
			t.Fatal(err)
		}
		if output.Request.Headers["Authorization"] != "DPoP renewed-token" {
			t.Fatalf("authorization = %#v", output.Request.Headers["Authorization"])
		}
		if states.state.DPoPCredentials[credential.ResourceHref].AccessToken != "renewed-token" {
			t.Fatal("renewed credential was not cached")
		}
	})
}

func TestAuthHookRemovesCredentialWhenIssuerRejectsRenewal(t *testing.T) {
	credential := testCredential(t, "expired-token", time.Now().Add(-time.Minute))
	states := newCredentialState(t, credential)
	client := roundTripFunc(func(*http.Request) (*http.Response, error) {
		return jsonResponse(http.StatusForbidden, map[string]any{"message": "authorization expired"}), nil
	})

	_, err := authenticateRequest(targetHookInput(), states, client, &promptRecorder{})
	if err == nil || !strings.Contains(err.Error(), "request current Resource access") {
		t.Fatalf("renewal error = %v", err)
	}
	if len(states.state.DPoPCredentials) != 0 || len(states.state.ActiveDPoPCredentials) != 0 {
		t.Fatalf("credential was not removed: %#v", states.state)
	}
}

func testCredential(t *testing.T, accessToken string, expiresAt time.Time) dpopCredential {
	t.Helper()
	privateKey, err := newDPoPPrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	return dpopCredential{
		ResourceHref:       "https://auth.example.com/api/resource-servers/zpan/resources/workspace-1",
		ResourceIndicator:  "https://api.example.com/v1",
		CredentialEndpoint: "https://auth.example.com/api/access-requests/request-1/credentials",
		ProofTarget:        "https://api.example.com/oauth/token",
		PrivateKey:         privateKey, AccessToken: accessToken, ExpiresAt: &expiresAt,
	}
}

func newCredentialState(t *testing.T, credential dpopCredential) *memoryStateStore {
	t.Helper()
	agentPublic, agentPrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	_ = agentPublic
	_, hostPrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	protocolExpiresAt := time.Now().Add(time.Minute)
	protocolKey, err := newDPoPPrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	return &memoryStateStore{exists: true, state: agentState{
		Version: agentStateVersion, Origin: "https://auth.example.com", Issuer: "https://auth.example.com/api/auth",
		Runtime: defaultAgentRuntime, AgentID: "agent-123", HostID: "host-123", AgentKeyID: "agent-key", HostKeyID: "host-key",
		AgentPrivateKey: encodePrivateKey(agentPrivate), HostPrivateKey: encodePrivateKey(hostPrivate),
		Identity:              &stableIdentity{ID: "identity-1", Issuer: "https://auth.example.com/api/auth", Subject: "agt_123"},
		DPoPCredentials:       map[string]dpopCredential{credential.ResourceHref: credential},
		ActiveDPoPCredentials: map[string]string{credentialSelectionKey(credential.ResourceIndicator): credential.ResourceHref},
		ProtocolCredential: &dpopCredential{
			ResourceHref: "https://auth.example.com/api", ResourceIndicator: "https://auth.example.com/api",
			CredentialEndpoint: "https://auth.example.com/api/auth/oauth2/token",
			ProofTarget:        "https://auth.example.com/api/auth/oauth2/token", PrivateKey: protocolKey,
			AccessToken: "protocol-token", ExpiresAt: &protocolExpiresAt,
		},
	}}
}

func targetHookInput() plugin.AuthHookInput {
	return plugin.AuthHookInput{API: "projects", Profile: "default", Params: map[string]string{
		"provider": targetAuthProvider,
		"issuer":   "https://auth.example.com/api/auth",
	}, Request: plugin.HookRequest{
		Method: http.MethodGet, URI: "https://api.example.com/v1/projects?limit=20",
	}}
}

func testAgentConfiguration() map[string]any {
	return map[string]any{
		"version": "1.0-draft", "issuer": "https://auth.example.com/api/auth", "algorithms": []string{"Ed25519"},
		"agent_identity_issuer":     "https://auth.example.com/api/auth",
		"agent_enrollment_endpoint": "https://auth.example.com/api/agent/enrollments",
		"agent_endpoint":            "https://auth.example.com/api/agent/status",
		"agent_token_endpoint":      "https://auth.example.com/api/auth/oauth2/token",
		"agent_bootstrap_scopes_supported": []string{
			"agent:read",
			"resource-servers:read",
			"resources:read",
			"connection-requests:read",
			"connection-requests:write",
			"access-requests:read",
			"access-requests:write",
		},
		"endpoints": map[string]any{
			"register": "https://auth.example.com/api/auth/agent/register",
			"status":   "https://auth.example.com/api/auth/agent/status",
		},
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) Do(request *http.Request) (*http.Response, error) { return fn(request) }

type promptRecorder struct{ uri string }

func (p *promptRecorder) Show(uri string) error { p.uri = uri; return nil }

func jsonResponse(status int, body any) *http.Response {
	encoded, _ := json.Marshal(body)
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(string(encoded))), Header: make(http.Header)}
}

type memoryStateStore struct {
	state  agentState
	exists bool
}

func (s *memoryStateStore) Create(_ agentTarget, state agentState) (string, error) {
	s.state, s.exists = state, true
	return "/private/agent.json", nil
}
func (s *memoryStateStore) Load(_ agentTarget) (agentState, error) {
	if !s.exists {
		return agentState{}, os.ErrNotExist
	}
	return s.state, nil
}
func (s *memoryStateStore) Update(_ agentTarget, state agentState) error {
	s.state, s.exists = state, true
	return nil
}
func (s *memoryStateStore) FindByOriginAndAgentID(origin, agentID string) (agentState, error) {
	if !s.exists || s.state.Origin != origin || s.state.AgentID != agentID {
		return agentState{}, os.ErrNotExist
	}
	return s.state, nil
}
func (s *memoryStateStore) FindByOriginAndIdentityID(origin, identityID string) (agentState, error) {
	if !s.exists || s.state.Origin != origin || s.state.Identity == nil || s.state.Identity.ID != identityID {
		return agentState{}, os.ErrNotExist
	}
	return s.state, nil
}
func (s *memoryStateStore) FindReferenceByOriginIdentityRuntime(origin, identityID, runtime string) (agentStateReference, error) {
	state, err := s.FindByOriginAndIdentityID(origin, identityID)
	if err != nil {
		return agentStateReference{}, os.ErrNotExist
	}
	_ = runtime
	return agentStateReference{path: "memory", state: state}, nil
}
func (s *memoryStateStore) UpdateStateReference(reference agentStateReference) error {
	s.state = reference.state
	return nil
}
func (s *memoryStateStore) FindByResourceURL(resourceURL, _ string, issuer string) (resourceCredentialReference, error) {
	if issuer != "" && strings.TrimSuffix(s.state.Issuer, "/") != issuer {
		return resourceCredentialReference{}, os.ErrNotExist
	}
	for _, href := range s.state.ActiveDPoPCredentials {
		credential, ok := s.state.DPoPCredentials[href]
		if ok && resourceURLMatches(credential.ResourceIndicator, resourceURL) {
			return resourceCredentialReference{state: s.state, credential: credential}, nil
		}
	}
	return resourceCredentialReference{}, os.ErrNotExist
}
func (s *memoryStateStore) UpdateCredential(_ resourceCredentialReference, credential dpopCredential) error {
	s.state.DPoPCredentials[credential.ResourceHref] = credential
	return nil
}
func (s *memoryStateStore) DeleteCredential(reference resourceCredentialReference) error {
	delete(s.state.DPoPCredentials, reference.credential.ResourceHref)
	for key, href := range s.state.ActiveDPoPCredentials {
		if href == reference.credential.ResourceHref {
			delete(s.state.ActiveDPoPCredentials, key)
		}
	}
	return nil
}

func decodeJWTPayload(t *testing.T, token string) map[string]any {
	t.Helper()
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("invalid JWT: %q", token)
	}
	decoded, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	var claims map[string]any
	if err := json.Unmarshal(decoded, &claims); err != nil {
		t.Fatal(err)
	}
	return claims
}

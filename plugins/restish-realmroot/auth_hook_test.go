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

func TestAuthHookEnrollsOnceThenSignsOriginalRequest(t *testing.T) {
	t.Setenv("REALMROOT_AGENT_NAME", "Build Agent")
	requests := 0
	states := &memoryStateStore{}
	prompt := &promptRecorder{}
	client := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests++
		switch requests {
		case 1, 6:
			return jsonResponse(http.StatusOK, testAgentConfiguration()), nil
		case 2:
			return jsonResponse(http.StatusOK, map[string]any{
				"agent_id": "agent-123", "host_id": "host-123",
				"approval": map[string]any{
					"verification_uri_complete": "https://auth.example.com/agent/approve?code=abc",
					"expires_in":                600, "interval": 1,
				},
			}), nil
		case 3:
			return jsonResponse(http.StatusOK, map[string]any{"status": "active"}), nil
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
			return jsonResponse(http.StatusOK, map[string]any{
				"access_token": "protocol-token", "token_type": "DPoP", "expires_in": 300,
			}), nil
		case 5:
			if request.Method != http.MethodGet || request.URL.String() != "https://auth.example.com/api/agent/status" {
				t.Fatalf("status request = %s %s", request.Method, request.URL)
			}
			return jsonResponse(http.StatusCreated, map[string]any{"agent": map[string]any{
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

func testCredential(_ *testing.T, _ string, _ time.Time) dpopCredential {
	return dpopCredential{
		ResourceHref:       "https://auth.example.com/api/resource-servers/zpan/resources/workspace-1",
		ResourceIndicator:  "https://api.example.com/v1",
		CredentialEndpoint: "https://auth.example.com/api/access-requests/request-1/credentials",
		ProofTarget:        "https://api.example.com/oauth/token",
		Scopes:             []string{"files:read"},
	}
}

func newCredentialState(t *testing.T, credential dpopCredential) *memoryStateStore {
	t.Helper()
	t.Setenv("AGENT", defaultAgentRuntime)
	_, agentPrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
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
		Identity:             &stableIdentity{ID: "identity-1", Issuer: "https://auth.example.com/api/auth", Subject: "agt_123"},
		DPoPCredentialOffers: map[string][]dpopCredential{credential.ResourceHref: {credential}},
		ProtocolCredential: &dpopCredential{
			ResourceHref: "https://auth.example.com/api", ResourceIndicator: "https://auth.example.com/api",
			CredentialEndpoint: "https://auth.example.com/api/auth/oauth2/token",
			ProofTarget:        "https://auth.example.com/api/auth/oauth2/token", PrivateKey: protocolKey,
			AccessToken: "protocol-token", ExpiresAt: &protocolExpiresAt,
		},
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
			"agent:read", "resource-servers:read", "resources:read", "connection-requests:read",
			"connection-requests:write", "access-requests:read", "access-requests:write",
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
	if err != nil || state.Runtime != runtime {
		return agentStateReference{}, os.ErrNotExist
	}
	return agentStateReference{path: "memory", state: state}, nil
}

func (s *memoryStateStore) UpdateStateReference(reference agentStateReference) error {
	s.state = reference.state
	return nil
}

func (s *memoryStateStore) FindCredentialOffer(reference, runtime string, scopes []string) (resourceCredentialReference, error) {
	offers := s.state.DPoPCredentialOffers[reference]
	if !s.exists || s.state.Runtime != runtime {
		return resourceCredentialReference{}, os.ErrNotExist
	}
	for _, credential := range offers {
		if scopesContain(credential.Scopes, scopes) {
			return resourceCredentialReference{path: "memory", state: s.state, credential: credential}, nil
		}
	}
	return resourceCredentialReference{}, os.ErrNotExist
}

func (s *memoryStateStore) FindCredentialState(reference, runtime string) (agentStateReference, error) {
	if !s.exists || s.state.Runtime != runtime || !sameOrigin(reference, s.state.Origin) {
		return agentStateReference{}, os.ErrNotExist
	}
	return agentStateReference{path: "memory", state: s.state}, nil
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

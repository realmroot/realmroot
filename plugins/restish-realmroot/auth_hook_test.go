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
	requests := 0
	states := &memoryStateStore{}
	prompt := &promptRecorder{}
	client := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests++
		switch requests {
		case 1:
			return jsonResponse(200, testAgentConfiguration()), nil
		case 2:
			return jsonResponse(200, map[string]any{
				"agent_id": "agent-123",
				"host_id":  "host-123",
				"approval": map[string]any{
					"verification_uri_complete": "https://auth.example.com/agent/approve?code=abc",
					"expires_in":                600,
					"interval":                  1,
				},
			}), nil
		case 3:
			return jsonResponse(200, map[string]any{"status": "active"}), nil
		case 4:
			return jsonResponse(201, map[string]any{
				"agent": map[string]any{
					"id": "agent-identity-1", "issuer": "https://auth.example.com/api/auth", "subject": "agt_123",
				},
			}), nil
		case 5:
			return jsonResponse(200, testAgentConfiguration()), nil
		default:
			t.Fatalf("unexpected request: %s %s", request.Method, request.URL)
			return nil, nil
		}
	})
	input := plugin.AuthHookInput{
		API:     "realmroot",
		Profile: "default",
		Params:  map[string]string{"provider": authProvider},
		Request: plugin.HookRequest{Method: "GET", URI: "https://auth.example.com/api/agent"},
	}

	output, err := authenticateRequest(input, states, client, prompt)
	if err != nil {
		t.Fatal(err)
	}
	authorization := output.Request.Headers["Authorization"].(string)
	if !strings.HasPrefix(authorization, "Bearer ") {
		t.Fatalf("missing AgentAuth proof: %q", authorization)
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
	if requests != 5 {
		t.Fatalf("second request repeated enrollment; requests = %d", requests)
	}
}

func TestAuthHookSignsTargetAPIRequestWithCachedDPoPToken(t *testing.T) {
	_, agentPrivateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	_, hostPrivateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	dpopPrivateKey, err := newDPoPPrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	expiresAt := time.Now().Add(time.Minute)
	states := &memoryStateStore{
		exists: true,
		state: agentState{
			Version:         1,
			Origin:          "https://auth.example.com",
			AgentID:         "agent-123",
			HostID:          "host-123",
			AgentKeyID:      "agent-key",
			HostKeyID:       "host-key",
			AgentPrivateKey: encodePrivateKey(agentPrivateKey),
			HostPrivateKey:  encodePrivateKey(hostPrivateKey),
			DPoPCredentials: map[string]dpopCredential{
				"grant-1": {
					GrantID:           "grant-1",
					ResourceID:        "resource-1",
					ResourceURL:       "https://api.example.com/v1",
					AuthorizationMode: "native",
					PrivateKey:        dpopPrivateKey,
					AccessToken:       "access-token",
					ExpiresAt:         &expiresAt,
				},
			},
		},
	}
	input := plugin.AuthHookInput{
		API:     "projects",
		Profile: "default",
		Request: plugin.HookRequest{Method: http.MethodGet, URI: "https://api.example.com/v1/projects?limit=20"},
	}

	output, err := authenticateRequest(input, states, roundTripFunc(nil), &promptRecorder{})
	if err != nil {
		t.Fatal(err)
	}
	if output.Request.Headers["Authorization"] != "DPoP access-token" {
		t.Fatalf("authorization = %#v", output.Request.Headers["Authorization"])
	}
	proof, _ := output.Request.Headers["DPoP"].(string)
	if proof == "" {
		t.Fatal("missing DPoP proof")
	}
	claims := decodeJWTPayload(t, proof)
	if claims["htm"] != http.MethodGet || claims["htu"] != input.Request.URI || claims["ath"] == "" {
		t.Fatalf("unexpected DPoP claims: %#v", claims)
	}
}

func testAgentConfiguration() map[string]any {
	return map[string]any{
		"version":                   "1.0-draft",
		"issuer":                    "https://auth.example.com/api/auth",
		"algorithms":                []string{"Ed25519"},
		"agent_identity_issuer":     "https://auth.example.com/api/auth",
		"agent_enrollment_endpoint": "https://auth.example.com/api/agent/enrollments",
		"agent_endpoint":            "https://auth.example.com/api/agent",
		"endpoints": map[string]any{
			"register": "https://auth.example.com/api/auth/agent/register",
			"status":   "https://auth.example.com/api/auth/agent/status",
		},
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) Do(request *http.Request) (*http.Response, error) {
	return fn(request)
}

type promptRecorder struct {
	uri string
}

func (p *promptRecorder) Show(uri string) error {
	p.uri = uri
	return nil
}

func jsonResponse(status int, body any) *http.Response {
	encoded, _ := json.Marshal(body)
	return &http.Response{
		StatusCode: status,
		Body:       io.NopCloser(strings.NewReader(string(encoded))),
		Header:     make(http.Header),
	}
}

type memoryStateStore struct {
	state  agentState
	exists bool
}

func (s *memoryStateStore) Create(_ agentTarget, state agentState) (string, error) {
	s.state = state
	s.exists = true
	return "/private/agent.json", nil
}

func (s *memoryStateStore) Load(_ agentTarget) (agentState, error) {
	if !s.exists {
		return agentState{}, os.ErrNotExist
	}
	return s.state, nil
}

func (s *memoryStateStore) Update(_ agentTarget, state agentState) error {
	s.state = state
	s.exists = true
	return nil
}

func (s *memoryStateStore) FindByResourceURL(resourceURL string) (resourceCredentialReference, error) {
	for _, credential := range s.state.DPoPCredentials {
		if resourceURLMatches(credential.ResourceURL, resourceURL) {
			return resourceCredentialReference{state: s.state, credential: credential}, nil
		}
	}
	return resourceCredentialReference{}, os.ErrNotExist
}

func (s *memoryStateStore) UpdateCredential(_ resourceCredentialReference, credential dpopCredential) error {
	s.state.DPoPCredentials[credential.GrantID] = credential
	return nil
}

func (s *memoryStateStore) StoreTargetToken(_ string, grantID string, token targetTokenResponse) error {
	credential := s.state.DPoPCredentials[grantID]
	credential.AccessToken = token.AccessToken
	credential.ExpiresAt = &token.ExpiresAt
	s.state.DPoPCredentials[grantID] = credential
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

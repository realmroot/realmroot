package main

import (
	"context"
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

const testCredentialSourceReference = "rrcs_MDEyMzQ1Njc4OWFiY2RlZg"

func fixedCredentialSourceReference() (string, error) {
	return testCredentialSourceReference, nil
}

func TestAuthHookIgnoresUnmarkedProfiles(t *testing.T) {
	output, err := authenticateRequest(plugin.AuthHookInput{}, nil, &memoryStateStore{}, roundTripFunc(nil), &promptRecorder{})
	if err != nil {
		t.Fatal(err)
	}
	if output.Request != nil {
		t.Fatalf("unexpected request update: %#v", output.Request)
	}
}

func TestEnrollmentAuthRegistersAgentThenWhoamiUsesTheEnrolledIdentity(t *testing.T) {
	t.Setenv("REALMROOT_AGENT_NAME", "Build Agent")
	expectedHostName, err := hostDisplayName()
	if err != nil {
		t.Fatal(err)
	}
	requests := 0
	states := &memoryStateStore{}
	prompt := &promptRecorder{}
	client := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests++
		switch requests {
		case 1:
			return jsonResponse(http.StatusOK, testAgentConfiguration()), nil
		case 2:
			var registration struct {
				Name     string `json:"name"`
				HostName string `json:"host_name"`
			}
			if err := json.NewDecoder(request.Body).Decode(&registration); err != nil {
				t.Fatal(err)
			}
			if registration.Name != "Build Agent" || registration.HostName != expectedHostName {
				t.Fatalf("registration names = %#v", registration)
			}
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
				request.Form.Get("scope") != "agent:read" ||
				request.Header.Get("DPoP") == "" {
				t.Fatalf("token request form = %#v", request.Form)
			}
			return jsonResponse(http.StatusOK, map[string]any{
				"access_token": "protocol-token", "token_type": "DPoP", "expires_in": 300,
			}), nil
		case 5:
			if request.Method != http.MethodGet || request.URL.String() != "https://auth.example.com/api/agent" {
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
	enrollment := authHookEnvelope{
		API: "realmroot", Profile: "default",
		Requirements: []authRequirement{{ID: agentAssertionSchemeID, Kind: "http-bearer"}},
		Request:      plugin.HookRequest{Method: http.MethodPost, URI: "https://auth.example.com/api/agent/enrollments"},
	}
	output, err := authenticateHookRequest(enrollment, states, client, prompt)
	if err != nil {
		t.Fatal(err)
	}
	if authorization, _ := output.Request.Headers["Authorization"].(string); !strings.HasPrefix(authorization, "Bearer ") {
		t.Fatalf("missing AgentAuth assertion: %q", authorization)
	}
	if output.Request.Headers["Idempotency-Key"] == "" {
		t.Fatal("enrollment request has no durable idempotency key")
	}
	if states.state.Identity != nil {
		t.Fatalf("enrollment authentication persisted an identity before the Resource operation: %#v", states.state.Identity)
	}
	_, err = handleProfiledResponse(plugin.ResponseMiddlewareInput{
		Request: plugin.HookRequest{Method: http.MethodPost, URI: "https://auth.example.com/api/agent/enrollments"},
		Response: plugin.HookResponse{
			Status:  http.StatusCreated,
			Headers: map[string][]string{"Link": {"<" + agentEnrollmentProfile + ">; rel=\"profile\""}},
			Body:    map[string]any{"kind": "new_identity", "status": "approved"},
		},
	}, &browserRecorder{}, states, client, fixedCredentialSourceReference)
	if err != nil {
		t.Fatal(err)
	}
	if states.state.Identity == nil || states.state.Identity.Subject != "agt_123" {
		t.Fatalf("enrollment response did not persist identity: %#v", states.state.Identity)
	}

	whoami := authHookEnvelope{
		API: "realmroot", Profile: "default",
		Requirements: []authRequirement{{ID: oauth2SchemeID, Kind: "oauth2-dpop", Needs: []string{"agent:read"}}},
		Request:      plugin.HookRequest{Method: http.MethodGet, URI: "https://auth.example.com/api/agent"},
	}
	output, err = authenticateHookRequest(whoami, states, client, prompt)
	if err != nil {
		t.Fatal(err)
	}
	if authorization, _ := output.Request.Headers["Authorization"].(string); authorization != "DPoP protocol-token" {
		t.Fatalf("missing OAuth DPoP token: %q", authorization)
	}
	if prompt.uri != "https://auth.example.com/agent/approve?code=abc" {
		t.Fatalf("approval URI = %q", prompt.uri)
	}
	if _, err := authenticateHookRequest(whoami, states, client, prompt); err != nil {
		t.Fatal(err)
	}
	if requests != 5 {
		t.Fatalf("second request repeated enrollment; requests = %d", requests)
	}
}

func TestWhoamiWithoutLocalRegistrationRequiresExplicitEnrollment(t *testing.T) {
	t.Run("[spec: agent-identity/agent-whoami-requires-enrollment]", testWhoamiWithoutLocalRegistrationRequiresExplicitEnrollment)
}

func testWhoamiWithoutLocalRegistrationRequiresExplicitEnrollment(t *testing.T) {
	clientRequests := 0
	client := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		clientRequests++
		return jsonResponse(http.StatusOK, testAgentConfiguration()), nil
	})
	prompt := &promptRecorder{}
	_, err := authenticateHookRequest(authHookEnvelope{
		API: "realmroot", Profile: "default",
		Requirements: []authRequirement{{ID: oauth2SchemeID, Kind: "oauth2-dpop", Needs: []string{"agent:read"}}},
		Request:      plugin.HookRequest{Method: http.MethodGet, URI: "https://auth.example.com/api/agent"},
	}, &memoryStateStore{}, client, prompt)
	if err == nil || !strings.Contains(err.Error(), "restish realmroot agent enroll") {
		t.Fatalf("error = %v", err)
	}
	if prompt.uri != "" {
		t.Fatalf("whoami opened approval URI %q", prompt.uri)
	}
	if clientRequests != 1 {
		t.Fatalf("whoami made %d requests, want one cached discovery request", clientRequests)
	}
}

func TestRegisterAgentSharesHostAcrossRuntimes(t *testing.T) {
	states := &memoryStateStore{}
	target := agentTarget{
		Runtime: "codex", Origin: "https://auth.example.com", Issuer: "https://auth.example.com/api/auth",
	}
	configuration := agentConfiguration{
		Issuer: target.Issuer, Endpoints: map[string]string{"register": target.Issuer + "/agent/register"},
	}
	var hostKeyIDs []string
	var hostIssuers []string
	var hostPublicKeys []string
	var agentPublicKeys []string
	client := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		token := strings.TrimPrefix(request.Header.Get("Authorization"), "Bearer ")
		parts := strings.Split(token, ".")
		if len(parts) != 3 {
			t.Fatalf("registration JWT has %d segments", len(parts))
		}
		var header map[string]any
		var claims map[string]any
		decodeJWTPart(t, parts[0], &header)
		decodeJWTPart(t, parts[1], &claims)
		hostKeyIDs = append(hostKeyIDs, header["kid"].(string))
		hostIssuers = append(hostIssuers, claims["iss"].(string))
		hostPublicKeys = append(hostPublicKeys, claims["host_public_key"].(map[string]any)["x"].(string))
		agentPublicKeys = append(agentPublicKeys, claims["agent_public_key"].(map[string]any)["x"].(string))
		return jsonResponse(http.StatusOK, map[string]any{
			"agent_id": "agent-" + target.Runtime, "host_id": "host-123",
			"approval": map[string]any{
				"verification_uri_complete": "https://auth.example.com/agent/approve?code=" + target.Runtime,
				"expires_in":                600, "interval": 1,
			},
		}), nil
	})

	if _, err := registerAgent(context.Background(), states, client, target, "Codex", false, configuration); err != nil {
		t.Fatal(err)
	}
	target.Runtime = "claude"
	if _, err := registerAgent(context.Background(), states, client, target, "Claude", false, configuration); err != nil {
		t.Fatal(err)
	}

	if hostKeyIDs[0] != hostKeyIDs[1] || hostPublicKeys[0] != hostPublicKeys[1] {
		t.Fatal("runtimes did not share the Host key")
	}
	if hostIssuers[0] == "host-123" || hostIssuers[1] != "host-123" {
		t.Fatalf("registration Host issuers = %#v", hostIssuers)
	}
	if agentPublicKeys[0] == agentPublicKeys[1] {
		t.Fatal("runtimes shared an Agent key")
	}
}

func testCredential(_ *testing.T, _ string, _ time.Time) dpopCredential {
	return dpopCredential{
		ResourceIndicator:    "https://api.example.com/v1",
		AuthorizationDetails: []map[string]any{{"type": "workspace", "identifier": "workspace-1"}},
		CredentialEndpoint:   "https://auth.example.com/api/access-requests/request-1/credentials",
		ProofTarget:          "https://api.example.com/oauth/token",
		Scopes:               []string{"files:read"},
	}
}

func newCredentialState(t *testing.T, credential dpopCredential) *memoryStateStore {
	t.Helper()
	t.Setenv("AGENT", defaultAgentRuntime)
	_, agentPrivate, err := ed25519.GenerateKey(rand.Reader)
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
		Runtime: defaultAgentRuntime, AgentID: "agent-123", HostID: "host-123", AgentKeyID: "agent-key",
		AgentPrivateKey:          encodePrivateKey(agentPrivate),
		EnrollmentIdempotencyKey: "enroll_test",
		Identity:                 &stableIdentity{ID: "identity-1", Issuer: "https://auth.example.com/api/auth", Subject: "agt_123"},
		CredentialSources: map[string]credentialSource{
			testCredentialSourceReference: {
				ResourceIndicator: credential.ResourceIndicator, AuthorizationDetails: credential.AuthorizationDetails,
				Offers: []dpopCredential{credential},
			},
		},
		ProtocolCredential: &dpopCredential{
			ResourceIndicator:  "https://auth.example.com/api",
			CredentialEndpoint: "https://auth.example.com/api/auth/oauth2/token",
			ProofTarget:        "https://auth.example.com/api/auth/oauth2/token", PrivateKey: protocolKey,
			AccessToken: "protocol-token", ExpiresAt: &protocolExpiresAt,
			Scopes: []string{"agent:read", "access-requests:read", "access-requests:write"},
		},
	}}
}

func testAgentConfiguration() map[string]any {
	return map[string]any{
		"version": "1.0-draft", "issuer": "https://auth.example.com/api/auth", "algorithms": []string{"Ed25519"},
		"agent_identity_issuer":     "https://auth.example.com/api/auth",
		"agent_enrollment_endpoint": "https://auth.example.com/api/agent/enrollments",
		"agent_endpoint":            "https://auth.example.com/api/agent",
		"agent_token_endpoint":      "https://auth.example.com/api/auth/oauth2/token",
		"agent_bootstrap_scopes_supported": []string{
			"agent:read", "resource-servers:read", "authorization-details:read", "connection-requests:read",
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
	state         agentState
	exists        bool
	host          hostState
	hostExists    bool
	configuration *cachedAgentConfiguration
}

func (s *memoryStateStore) LoadAgentConfiguration(origin string) (cachedAgentConfiguration, error) {
	if s.configuration == nil || s.configuration.Origin != origin {
		return cachedAgentConfiguration{}, os.ErrNotExist
	}
	return *s.configuration, nil
}

func (s *memoryStateStore) StoreAgentConfiguration(
	origin string,
	configuration agentConfiguration,
	expiresAt time.Time,
) error {
	s.configuration = &cachedAgentConfiguration{
		Version: 1, Origin: origin, ExpiresAt: expiresAt, Configuration: configuration,
	}
	return nil
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

func (s *memoryStateStore) CreateHost(_ agentTarget, state hostState) (string, error) {
	s.host, s.hostExists = state, true
	return "/private/host.json", nil
}

func (s *memoryStateStore) LoadHost(_ agentTarget) (hostState, error) {
	if !s.hostExists {
		return hostState{}, os.ErrNotExist
	}
	return s.host, nil
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
	if !s.exists || s.state.Runtime != runtime {
		return resourceCredentialReference{}, os.ErrNotExist
	}
	source, ok := s.state.CredentialSources[reference]
	if ok {
		for _, credential := range source.Offers {
			if scopesContain(credential.Scopes, scopes) {
				return resourceCredentialReference{
					path: "memory", state: s.state, reference: reference, credential: credential,
				}, nil
			}
		}
	}
	return resourceCredentialReference{}, os.ErrNotExist
}

func (s *memoryStateStore) FindCredentialSource(reference, runtime string) (credentialSourceStateReference, error) {
	if !s.exists || s.state.Runtime != runtime {
		return credentialSourceStateReference{}, os.ErrNotExist
	}
	source, ok := s.state.CredentialSources[reference]
	if !ok {
		return credentialSourceStateReference{}, os.ErrNotExist
	}
	return credentialSourceStateReference{
		path: "memory", state: s.state, reference: reference, source: source,
	}, nil
}

func (s *memoryStateStore) UpdateCredentialSourceState(reference credentialSourceStateReference) error {
	s.state = reference.state
	return nil
}

func (s *memoryStateStore) RemoveCredentialOffer(reference resourceCredentialReference) error {
	source, ok := s.state.CredentialSources[reference.reference]
	if !ok {
		return os.ErrNotExist
	}
	remaining := make([]dpopCredential, 0, len(source.Offers))
	removed := false
	for _, offer := range source.Offers {
		if !removed && sameCredentialOffer(offer, reference.credential) {
			removed = true
			continue
		}
		remaining = append(remaining, offer)
	}
	if !removed {
		return os.ErrNotExist
	}
	source.Offers = remaining
	s.state.CredentialSources[reference.reference] = source
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

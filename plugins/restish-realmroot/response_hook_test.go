package main

import (
	"net/http"
	"testing"
	"time"

	"github.com/rest-sh/restish/v2/plugin"
)

type browserRecorder struct {
	uri string
}

func (b *browserRecorder) Open(uri string) error {
	b.uri = uri
	return nil
}

type capabilityStateRecorder struct {
	state agentState
}

func (s capabilityStateRecorder) FindByOriginAndAgentID(origin string, agentID string) (agentState, error) {
	if origin != s.state.Origin || agentID != s.state.AgentID {
		return agentState{}, http.ErrMissingFile
	}
	return s.state, nil
}

type resourceStateRecorder struct {
	capabilityStateRecorder
}

func (s resourceStateRecorder) FindByOriginAndIdentityID(origin string, identityID string) (agentState, error) {
	if origin != s.state.Origin || s.state.Identity == nil || identityID != s.state.Identity.ID {
		return agentState{}, http.ErrMissingFile
	}
	return s.state, nil
}

type targetTokenStateRecorder struct {
	origin  string
	runtime string
	grantID string
	token   targetTokenResponse
}

func (s *targetTokenStateRecorder) FindByOriginAndAgentID(string, string) (agentState, error) {
	return agentState{}, http.ErrMissingFile
}

func (s *targetTokenStateRecorder) StoreTargetToken(
	origin string,
	runtime string,
	grantID string,
	token targetTokenResponse,
) error {
	s.origin = origin
	s.runtime = runtime
	s.grantID = grantID
	s.token = token
	return nil
}

func TestTargetTokenResponseStoresAndRedactsAccessToken(t *testing.T) {
	states := &targetTokenStateRecorder{}
	output, err := handleCapabilityApprovalResponse(
		plugin.ResponseMiddlewareInput{
			Request: plugin.HookRequest{
				Method: "POST",
				URI:    "https://auth.example.com/api/agent/access-grants/grant-1/tokens",
			},
			Response: plugin.HookResponse{
				Status: 200,
				Body: map[string]any{
					"accessToken": "secret-token",
					"tokenType":   "DPoP",
					"expiresAt":   "2026-07-30T00:00:00Z",
					"resourceUrl": "https://api.example.com",
					"scopes":      []any{"projects:read"},
				},
			},
		},
		&browserRecorder{},
		states,
		roundTripFunc(nil),
	)

	if err != nil {
		t.Fatal(err)
	}
	if states.origin != "https://auth.example.com" || states.runtime == "" || states.grantID != "grant-1" {
		t.Fatalf("stored target = %q %q %q", states.origin, states.runtime, states.grantID)
	}
	if states.token.AccessToken != "secret-token" {
		t.Fatalf("stored token = %#v", states.token)
	}
	body := output.Response.Body.(map[string]any)
	if _, ok := body["accessToken"]; ok {
		t.Fatalf("response exposed access token: %#v", body)
	}
	if body["tokenType"] != "DPoP" || body["resourceUrl"] != "https://api.example.com" {
		t.Fatalf("redacted response = %#v", body)
	}
}

func TestCapabilityApprovalResponseOpensAndWaitsForHostedApproval(t *testing.T) {
	browser := &browserRecorder{}
	state := capabilityTestState(t)
	requests := 0
	client := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests++
		if requests == 1 {
			return jsonResponse(200, testAgentConfiguration()), nil
		}
		if request.URL.String() != "https://auth.example.com/api/auth/agent/status" {
			t.Fatalf("status URL = %q", request.URL)
		}
		return jsonResponse(200, map[string]any{
			"status": "active",
			"agent_capability_grants": []map[string]any{
				{"capability": "applications:read", "status": "active"},
			},
		}), nil
	})

	output, err := handleCapabilityApprovalResponse(capabilityHookInput(
		"https://auth.example.com/agent/approve?code=ABCD",
	), browser, capabilityStateRecorder{state: state}, client)

	if err != nil {
		t.Fatal(err)
	}
	if browser.uri != "https://auth.example.com/agent/approve?code=ABCD" {
		t.Fatalf("opened %q", browser.uri)
	}
	body := output.Response.Body.(map[string]any)
	if body["status"] != "active" {
		t.Fatalf("response body = %#v", body)
	}
}

func TestResourceApprovalResponseOpensAndWaitsForHostedApproval(t *testing.T) {
	browser := &browserRecorder{}
	state := capabilityTestState(t)
	requests := 0
	client := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests++
		if requests == 1 {
			return jsonResponse(200, testAgentConfiguration()), nil
		}
		if request.URL.String() != "https://auth.example.com/api/agent/access-requests/request-1" {
			t.Fatalf("status URL = %q", request.URL)
		}
		return jsonResponse(200, map[string]any{
			"id":        "request-1",
			"agentId":   state.Identity.ID,
			"status":    "approved",
			"approval":  nil,
			"grantId":   "grant-1",
			"expiresAt": time.Now().Add(time.Minute).Format(time.RFC3339),
		}), nil
	})
	approvalURL := "https://auth.example.com/agent/resource-access/approve#token=secret"
	input := plugin.ResponseMiddlewareInput{
		Request: plugin.HookRequest{
			Method: "POST",
			URI:    "https://auth.example.com/api/agent/access-requests",
		},
		Response: plugin.HookResponse{
			Status: 201,
			Body: map[string]any{
				"id":        "request-1",
				"agentId":   state.Identity.ID,
				"status":    "pending",
				"approval":  map[string]any{"url": approvalURL},
				"expiresAt": time.Now().Add(time.Minute).Format(time.RFC3339),
			},
		},
	}

	output, err := handleCapabilityApprovalResponse(
		input,
		browser,
		resourceStateRecorder{capabilityStateRecorder{state: state}},
		client,
	)
	if err != nil {
		t.Fatal(err)
	}
	if browser.uri != approvalURL {
		t.Fatalf("opened %q", browser.uri)
	}
	if output.Response.Body.(map[string]any)["status"] != "approved" {
		t.Fatalf("response body = %#v", output.Response.Body)
	}
	if output.Response.Body.(map[string]any)["grantId"] != "grant-1" {
		t.Fatalf("response body = %#v", output.Response.Body)
	}
}

func TestCapabilityApprovalResponseIgnoresOtherResponses(t *testing.T) {
	browser := &browserRecorder{}
	output, err := handleCapabilityApprovalResponse(plugin.ResponseMiddlewareInput{
		Request: plugin.HookRequest{
			Method: "GET",
			URI:    "https://auth.example.com/api/applications",
		},
		Response: plugin.HookResponse{
			Status: 200,
			Body:   map[string]any{"applications": []any{}},
		},
	}, browser, capabilityStateRecorder{}, roundTripFunc(nil))

	if err != nil {
		t.Fatal(err)
	}
	if browser.uri != "" || output.Response != nil {
		t.Fatalf("unexpected response hook result: %#v %#v", browser, output)
	}
}

func TestTargetUnauthorizedResponseRemovesCachedCredential(t *testing.T) {
	t.Run("[spec: agent-identity/restish-resource-credential-lifecycle]", func(t *testing.T) {
		state := authenticatedTestState(t)
		expiresAt := time.Now().Add(time.Minute)
		state.DPoPCredentials = map[string]dpopCredential{
			"resource-1": targetCredential(t, "grant-1", "persistent", "rejected-token", &expiresAt),
		}
		states := &memoryStateStore{state: state, exists: true}

		output, err := handleCapabilityApprovalResponse(
			plugin.ResponseMiddlewareInput{
				Request: plugin.HookRequest{
					Method: http.MethodPost,
					URI:    "https://api.example.com/v1/projects",
				},
				Response: plugin.HookResponse{
					Status:  http.StatusUnauthorized,
					Headers: map[string][]string{"WWW-Authenticate": {`DPoP error="invalid_token"`}},
				},
			},
			&browserRecorder{},
			states,
			roundTripFunc(nil),
		)

		if err != nil {
			t.Fatal(err)
		}
		if len(states.state.DPoPCredentials) != 0 {
			t.Fatalf("rejected target credential was retained: %#v", states.state.DPoPCredentials)
		}
		if output.Response != nil || output.Follow != nil || output.Drop {
			t.Fatalf("target response was changed: %#v", output)
		}
	})
}

func TestNonTargetUnauthorizedResponseDoesNotChangeCredentials(t *testing.T) {
	state := authenticatedTestState(t)
	expiresAt := time.Now().Add(time.Minute)
	state.DPoPCredentials = map[string]dpopCredential{
		"resource-1": targetCredential(t, "grant-1", "persistent", "access-token", &expiresAt),
	}
	states := &memoryStateStore{state: state, exists: true}

	_, err := handleCapabilityApprovalResponse(
		plugin.ResponseMiddlewareInput{
			Request:  plugin.HookRequest{Method: http.MethodGet, URI: "https://other.example.com/private"},
			Response: plugin.HookResponse{Status: http.StatusUnauthorized},
		},
		&browserRecorder{},
		states,
		roundTripFunc(nil),
	)

	if err != nil {
		t.Fatal(err)
	}
	if len(states.state.DPoPCredentials) != 1 {
		t.Fatalf("unrelated credential was removed: %#v", states.state.DPoPCredentials)
	}
}

func TestCapabilityApprovalResponseRejectsCrossOriginApprovalURL(t *testing.T) {
	browser := &browserRecorder{}
	_, err := handleCapabilityApprovalResponse(
		capabilityHookInput("https://attacker.example/agent/approve?code=ABCD"),
		browser,
		capabilityStateRecorder{},
		roundTripFunc(func(_ *http.Request) (*http.Response, error) {
			return jsonResponse(200, testAgentConfiguration()), nil
		}),
	)

	if err == nil {
		t.Fatal("expected cross-origin approval URL to fail")
	}
	if browser.uri != "" {
		t.Fatalf("unexpected browser open %q", browser.uri)
	}
}

func TestCapabilityApprovalWaitStopsOnDenial(t *testing.T) {
	state := capabilityTestState(t)
	client := roundTripFunc(func(_ *http.Request) (*http.Response, error) {
		return jsonResponse(200, map[string]any{
			"status": "active",
			"agent_capability_grants": []map[string]any{
				{"capability": "applications:read", "status": "denied"},
			},
		}), nil
	})

	_, err := waitForCapabilityDecision(
		t.Context(),
		client,
		state,
		agentConfiguration{
			Issuer: "https://auth.example.com/api/auth",
			Endpoints: map[string]string{
				"status": "https://auth.example.com/api/auth/agent/status",
			},
		},
		[]string{"applications:read"},
		time.Now().Add(time.Minute),
		time.Millisecond,
	)
	if err == nil || err.Error() != "controller denied the requested Agent capabilities" {
		t.Fatalf("denial error = %v", err)
	}
}

func capabilityHookInput(approvalURL string) plugin.ResponseMiddlewareInput {
	return plugin.ResponseMiddlewareInput{
		Request: plugin.HookRequest{
			Method: "POST",
			URI:    "https://auth.example.com/api/agent/capability-requests",
		},
		Response: plugin.HookResponse{
			Status: 200,
			Body: map[string]any{
				"agent_id": "agent-123",
				"status":   "pending",
				"agent_capability_grants": []any{
					map[string]any{"capability": "applications:read", "status": "pending"},
				},
				"approval": map[string]any{
					"verification_uri_complete": approvalURL,
					"expires_in":                300,
					"interval":                  5,
				},
			},
		},
	}
}

func capabilityTestState(t *testing.T) agentState {
	t.Helper()
	_, privateKey, keyID, err := newSigningKey("agent")
	if err != nil {
		t.Fatal(err)
	}
	return agentState{
		Origin:          "https://auth.example.com",
		AgentID:         "agent-123",
		HostID:          "host-123",
		AgentKeyID:      keyID,
		AgentPrivateKey: encodePrivateKey(privateKey),
		Identity:        &stableIdentity{ID: "agent-identity-1", Issuer: "https://auth.example.com/api/auth", Subject: "agt_123"},
	}
}

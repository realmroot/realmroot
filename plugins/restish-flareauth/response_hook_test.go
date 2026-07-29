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

func TestCapabilityApprovalResponseOpensAndWaitsForHostedApproval(t *testing.T) {
	browser := &browserRecorder{}
	state := capabilityTestState(t)
	client := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.String() != "https://auth.example.com/api/auth/agent/status" {
			t.Fatalf("status URL = %q", request.URL)
		}
		return jsonResponse(200, map[string]any{
			"status": "active",
			"agent_capability_grants": []map[string]any{
				{"capability": "management:read", "status": "active"},
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

func TestCapabilityApprovalResponseRejectsCrossOriginApprovalURL(t *testing.T) {
	browser := &browserRecorder{}
	_, err := handleCapabilityApprovalResponse(
		capabilityHookInput("https://attacker.example/agent/approve?code=ABCD"),
		browser,
		capabilityStateRecorder{},
		roundTripFunc(nil),
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
				{"capability": "management:read", "status": "denied"},
			},
		}), nil
	})

	_, err := waitForCapabilityDecision(
		t.Context(),
		client,
		state,
		[]string{"management:read"},
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
			URI:    "https://auth.example.com/api/capability-requests",
		},
		Response: plugin.HookResponse{
			Status: 200,
			Body: map[string]any{
				"agent_id": "agent-123",
				"status":   "pending",
				"agent_capability_grants": []any{
					map[string]any{"capability": "management:read", "status": "pending"},
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
	}
}

package main

import (
	"net/http"
	"testing"

	"github.com/rest-sh/restish/v2/plugin"
)

func TestSupportedProtocolAlternativeSeparatesEnrollmentFromResourceOAuth(t *testing.T) {
	tests := []struct {
		name         string
		requirements []authRequirement
		want         bool
	}{
		{
			name:         "obsolete Agent protocol Resource scheme",
			requirements: []authRequirement{{ID: "agentAuth", Kind: "http-dpop", Needs: []string{"agent:read"}}},
			want:         false,
		},
		{
			name:         "Resource OAuth scheme with an Agent bootstrap scope",
			requirements: []authRequirement{{ID: "oauth2", Kind: "oauth2-dpop", Needs: []string{"resource-servers:read"}}},
			want:         true,
		},
		{
			name:         "Agent enrollment assertion",
			requirements: []authRequirement{{ID: "agentAssertion", Kind: "http-bearer"}},
			want:         true,
		},
		{
			name:         "Legacy shared DPoP scheme",
			requirements: []authRequirement{{ID: "dpop", Kind: "http-dpop", Needs: []string{"agent:read"}}},
			want:         false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := supportedProtocolAlternative(test.requirements); got != test.want {
				t.Fatalf("supportedProtocolAlternative() = %t, want %t", got, test.want)
			}
		})
	}
}

func TestAgentEnrollmentRequestBoundary(t *testing.T) {
	endpoint := "https://auth.example.com/api/agent/enrollments"
	tests := []struct {
		request plugin.HookRequest
		want    bool
	}{
		{request: plugin.HookRequest{Method: http.MethodPost, URI: endpoint}, want: true},
		{request: plugin.HookRequest{Method: http.MethodGet, URI: endpoint + "/agenr_1"}, want: true},
		{request: plugin.HookRequest{Method: http.MethodGet, URI: endpoint}, want: false},
		{request: plugin.HookRequest{Method: http.MethodPost, URI: endpoint + "/agenr_1"}, want: false},
		{request: plugin.HookRequest{Method: http.MethodGet, URI: endpoint + "/agenr_1/decision"}, want: false},
		{request: plugin.HookRequest{Method: http.MethodGet, URI: "https://evil.example/api/agent/enrollments/agenr_1"}, want: false},
	}
	for _, test := range tests {
		if got := isAgentEnrollmentRequest(test.request, endpoint); got != test.want {
			t.Errorf("isAgentEnrollmentRequest(%s %s) = %t, want %t", test.request.Method, test.request.URI, got, test.want)
		}
	}
}

func TestAutomaticAgentCredentialClaimsOnlyPublishedBootstrapScopes(t *testing.T) {
	t.Log("[spec: management-api/management-restish-agent-auth]")
	configuration := agentConfiguration{AgentBootstrapScopes: []string{"agent:read", "resource-servers:read"}}
	if !automaticAgentCredentialSupports(configuration, []string{"agent:read"}) {
		t.Fatal("automatic Agent credential did not claim a published bootstrap scope")
	}
	if automaticAgentCredentialSupports(configuration, []string{"applications:read"}) {
		t.Fatal("automatic Agent credential claimed a configured authorization scope")
	}
	if automaticAgentCredentialSupports(configuration, nil) {
		t.Fatal("automatic Agent credential claimed an empty OAuth requirement")
	}
}

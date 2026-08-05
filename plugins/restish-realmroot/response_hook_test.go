package main

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/rest-sh/restish/v2/plugin"
)

type browserRecorder struct{ uri string }

func (b *browserRecorder) Open(uri string) error { b.uri = uri; return nil }

func TestProfiledResponseIgnoresEndpointNamesAndUnprofiledBodies(t *testing.T) {
	input := plugin.ResponseMiddlewareInput{
		Request:  plugin.HookRequest{Method: http.MethodPost, URI: "https://auth.example.com/api/access-requests"},
		Response: plugin.HookResponse{Status: http.StatusCreated, Body: pendingInteraction("https://auth.example.com")},
	}
	output, err := handleProfiledResponse(input, &browserRecorder{}, &memoryStateStore{}, roundTripFunc(nil))
	if err != nil {
		t.Fatal(err)
	}
	if output.Response != nil {
		t.Fatalf("unprofiled response was handled: %#v", output)
	}
}

func TestProfiledResponseOpensAndPollsAnyInteractiveResource(t *testing.T) {
	t.Run("[spec: agent-identity/restish-generic-interactive-resource]", func(t *testing.T) {
		t.Log("[spec: agent-identity/restish-generic-interactive-resource]")
		states := newCredentialState(t, testCredential(t, "cached", time.Now().Add(time.Minute)))
		states.state.DPoPCredentials = nil
		states.state.ActiveDPoPCredentials = nil
		browser := &browserRecorder{}
		client := roundTripFunc(func(request *http.Request) (*http.Response, error) {
			if request.Method != http.MethodGet || request.URL.String() != "https://auth.example.com/api/connection-requests/request-1" {
				t.Fatalf("poll request = %s %s", request.Method, request.URL)
			}
			return jsonResponse(200, completedInteraction()), nil
		})
		input := profiledInput("https://auth.example.com/api/agent/resource-servers/zpan/connection-requests", pendingInteraction("https://auth.example.com"))

		output, err := handleProfiledResponse(input, browser, states, client)
		if err != nil {
			t.Fatal(err)
		}
		if browser.uri != "https://auth.example.com/agent/resource-connection/approve#token=secret" {
			t.Fatalf("opened %q", browser.uri)
		}
		resource, ok := output.Response.Body.(map[string]any)
		interaction, interactionOK := resource["interaction"].(map[string]any)
		if !ok || !interactionOK || interaction["status"] != "completed" {
			t.Fatalf("response body = %#v", output.Response.Body)
		}
		if resource["resourceServerId"] != "zpan" {
			t.Fatalf("provider representation was not preserved: %#v", resource)
		}
		if _, exists := resource["credentialOffer"]; exists {
			t.Fatalf("plugin invented a credential offer field: %#v", resource)
		}
	})
}

func TestProfiledResponseAcceptsCredentialOfferWithoutGrantKnowledge(t *testing.T) {
	t.Run("[spec: agent-identity/restish-generic-resource-credential-offer]", func(t *testing.T) {
		t.Log("[spec: agent-identity/restish-generic-resource-credential-offer]")
		credential := testCredential(t, "old", time.Now().Add(-time.Minute))
		states := newCredentialState(t, credential)
		states.state.DPoPCredentials = nil
		states.state.ActiveDPoPCredentials = nil
		browser := &browserRecorder{}
		client := roundTripFunc(func(request *http.Request) (*http.Response, error) {
			switch request.URL.String() {
			case "https://auth.example.com/api/access-requests/request-1":
				return jsonResponse(200, completedInteractionWithOffer(credential)), nil
			case credential.CredentialEndpoint:
				if request.Header.Get("Authorization") != "DPoP platform-token" || request.Header.Get("DPoP") == "" {
					t.Fatal("credential request omitted Realmroot OAuth or target DPoP proof")
				}
				return jsonResponse(200, map[string]any{
					"accessToken": "short-lived-token", "tokenType": "DPoP", "expiresAt": time.Now().Add(time.Minute),
					"resourceIndicator": credential.ResourceIndicator,
					"resource":          map[string]any{"href": credential.ResourceHref},
				}), nil
			default:
				t.Fatalf("unexpected request %s", request.URL)
				return nil, nil
			}
		})
		input := profiledInput("https://auth.example.com/api/access-requests", pendingAccessInteraction("https://auth.example.com"))

		output, err := handleProfiledResponse(input, browser, states, client)
		if err != nil {
			t.Fatal(err)
		}
		body := output.Response.Body.(map[string]any)
		if body["status"] != "ready" || body["tokenExpiresAt"] == nil {
			t.Fatalf("safe result = %#v", body)
		}
		stored := states.state.DPoPCredentials[credential.ResourceHref]
		if stored.AccessToken != "short-lived-token" || stored.PrivateKey == "" {
			t.Fatalf("credential was not stored: %#v", stored)
		}
	})
}

func TestProfiledResponseRejectsCrossOriginInteractionLinks(t *testing.T) {
	states := newCredentialState(t, testCredential(t, "cached", time.Now().Add(time.Minute)))
	body := pendingInteraction("https://auth.example.com")
	body["links"] = map[string]any{"self": "https://attacker.example/request-1"}
	browser := &browserRecorder{}

	_, err := handleProfiledResponse(
		profiledInput("https://auth.example.com/api/access-requests", body),
		browser,
		states,
		roundTripFunc(nil),
	)
	if err == nil || !strings.Contains(err.Error(), "self link") {
		t.Fatalf("cross-origin error = %v", err)
	}
	if browser.uri != "" {
		t.Fatalf("opened unsafe URL %q", browser.uri)
	}
}

func TestTargetUnauthorizedResponseRemovesCachedCredential(t *testing.T) {
	credential := testCredential(t, "cached", time.Now().Add(time.Minute))
	states := newCredentialState(t, credential)
	_, err := handleProfiledResponse(plugin.ResponseMiddlewareInput{
		Request: plugin.HookRequest{
			Method: http.MethodGet,
			URI:    "https://api.example.com/v1/files",
			Headers: map[string][]string{
				"Authorization": {"DPoP cached"},
				"DPoP":          {"proof"},
			},
		},
		Response: plugin.HookResponse{Status: http.StatusUnauthorized},
	}, &browserRecorder{}, states, roundTripFunc(nil))
	if err == nil || !strings.Contains(err.Error(), "credential was removed") {
		t.Fatalf("unauthorized error = %v", err)
	}
	if len(states.state.DPoPCredentials) != 0 {
		t.Fatal("rejected credential remains cached")
	}
}

func TestTargetUnauthorizedResponsePreservesCredentialWhenDPoPWasNotSent(t *testing.T) {
	credential := testCredential(t, "cached", time.Now().Add(time.Minute))
	states := newCredentialState(t, credential)
	_, err := handleProfiledResponse(plugin.ResponseMiddlewareInput{
		Request: plugin.HookRequest{
			Method:  http.MethodGet,
			URI:     "https://api.example.com/v1/files",
			Headers: map[string][]string{"Authorization": {"DPoP"}},
		},
		Response: plugin.HookResponse{Status: http.StatusUnauthorized},
	}, &browserRecorder{}, states, roundTripFunc(nil))
	if err != nil {
		t.Fatal(err)
	}
	if len(states.state.DPoPCredentials) != 1 {
		t.Fatal("credential was removed even though no DPoP proof was sent")
	}
}

func profiledInput(uri string, body any) plugin.ResponseMiddlewareInput {
	return plugin.ResponseMiddlewareInput{
		Request: plugin.HookRequest{Method: http.MethodPost, URI: uri},
		Response: plugin.HookResponse{
			Status: http.StatusCreated,
			Headers: map[string][]string{
				"Link":        {"<" + interactiveResourceProfile + ">; rel=\"profile\""},
				"Retry-After": {"1"},
			},
			Body: body,
		},
	}
}

func pendingInteraction(origin string) map[string]any {
	return map[string]any{
		"id": "request-1", "agentId": "identity-1", "status": "pending", "scopes": []string{"files:read"},
		"interaction": map[string]any{
			"type": "user-approval", "status": "pending",
			"url":       origin + "/agent/resource-connection/approve#token=secret",
			"expiresAt": time.Now().Add(time.Minute),
		},
		"links": map[string]any{"self": origin + "/api/connection-requests/request-1"},
	}
}

func pendingAccessInteraction(origin string) map[string]any {
	body := pendingInteraction(origin)
	body["links"] = map[string]any{"self": origin + "/api/access-requests/request-1"}
	body["interaction"].(map[string]any)["url"] = origin + "/agent/resource-access/approve#token=secret"
	return body
}

func completedInteraction() map[string]any {
	return map[string]any{
		"id": "request-1", "agentId": "identity-1", "status": "connected", "scopes": []string{"files:read"},
		"resourceServerId": "zpan", "resources": []map[string]any{{"href": "https://auth.example.com/resources/workspace-1"}},
		"interaction": map[string]any{"type": "user-approval", "status": "completed", "url": nil, "expiresAt": nil},
		"links":       map[string]any{"self": "https://auth.example.com/api/connection-requests/request-1"},
	}
}

func completedInteractionWithOffer(credential dpopCredential) map[string]any {
	body := completedInteraction()
	body["links"] = map[string]any{"self": "https://auth.example.com/api/access-requests/request-1"}
	body["credentialOffer"] = map[string]any{
		"type": "dpop", "resource": map[string]any{"href": credential.ResourceHref},
		"resourceIndicator": credential.ResourceIndicator, "endpoint": credential.CredentialEndpoint,
		"proof": map[string]any{"algorithm": "ES256", "method": "POST", "uri": credential.ProofTarget},
	}
	return body
}

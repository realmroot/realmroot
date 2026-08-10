package main

import (
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/rest-sh/restish/v2/plugin"
)

func TestCredentialSourceReferenceIsOpaqueAndLocallyGenerated(t *testing.T) {
	reference, err := newCredentialSourceReference()
	if err != nil {
		t.Fatal(err)
	}
	if !isCredentialSourceReference(reference) {
		t.Fatalf("reference = %q", reference)
	}
}

func TestCredentialSourceReferenceRejectsResourceURL(t *testing.T) {
	if isCredentialSourceReference("https://auth.example.com/api/resource-servers/zpan/resources/workspace-1") {
		t.Fatal("Resource URL was accepted as a credential source reference")
	}
}

type browserRecorder struct{ uri string }

func (b *browserRecorder) Open(uri string) error { b.uri = uri; return nil }

func TestProfiledResponseIgnoresEndpointNamesAndUnprofiledBodies(t *testing.T) {
	input := plugin.ResponseMiddlewareInput{
		Request:  plugin.HookRequest{Method: http.MethodPost, URI: "https://auth.example.com/api/access-requests"},
		Response: plugin.HookResponse{Status: http.StatusCreated, Body: pendingInteraction("https://auth.example.com")},
	}
	output, err := handleProfiledResponse(
		input, &browserRecorder{}, &memoryStateStore{}, roundTripFunc(nil), fixedCredentialSourceReference,
	)
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
		states.state.CredentialSources = nil
		browser := &browserRecorder{}
		client := roundTripFunc(func(request *http.Request) (*http.Response, error) {
			if request.Method != http.MethodGet || request.URL.String() != "https://auth.example.com/api/connection-requests/request-1" {
				t.Fatalf("poll request = %s %s", request.Method, request.URL)
			}
			return jsonResponse(200, completedInteraction()), nil
		})
		input := profiledInput("https://auth.example.com/api/resource-servers/zpan/connection-requests", pendingInteraction("https://auth.example.com"))

		output, err := handleProfiledResponse(input, browser, states, client, fixedCredentialSourceReference)
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
		credential.AuthorizationDetails = nil
		states := newCredentialState(t, credential)
		states.state.CredentialSources = nil
		browser := &browserRecorder{}
		client := roundTripFunc(func(request *http.Request) (*http.Response, error) {
			if request.URL.String() != "https://auth.example.com/api/access-requests/request-1" {
				t.Fatalf("unexpected request %s", request.URL)
				return nil, nil
			}
			return jsonResponse(http.StatusOK, completedInteractionWithOffer(credential)), nil
		})
		input := profiledInput("https://auth.example.com/api/access-requests", pendingAccessInteraction("https://auth.example.com"))

		output, err := handleProfiledResponse(input, browser, states, client, fixedCredentialSourceReference)
		if err != nil {
			t.Fatal(err)
		}
		body := output.Response.Body.(map[string]any)
		if body["status"] != "ready" {
			t.Fatalf("safe result = %#v", body)
		}
		authorizationDetails, ok := body["authorizationDetails"].([]map[string]any)
		if !ok || len(authorizationDetails) != 0 {
			t.Fatalf("authorization details = %#v", body["authorizationDetails"])
		}
		source, ok := body["credentialSource"].(map[string]any)
		if !ok || source["name"] != "realmroot" || source["reference"] != testCredentialSourceReference {
			t.Fatalf("credential source receipt = %#v", body)
		}
		stored := states.state.CredentialSources[testCredentialSourceReference].Offers[0]
		if stored.AccessToken != "" || stored.PrivateKey != "" || stored.ExpiresAt != nil {
			t.Fatalf("plugin retained target credential material: %#v", stored)
		}
	})
}

func TestCredentialOfferReusesResourceReferenceAndPreservesOtherScopes(t *testing.T) {
	t.Log("[spec: agent-identity/restish-resource-credential-lifecycle]")
	readOffer := testCredential(t, "", time.Time{})
	states := newCredentialState(t, readOffer)
	writeOffer := readOffer
	writeOffer.Scopes = []string{"files:write"}
	writeOffer.CredentialEndpoint = "https://auth.example.com/api/access-requests/request-write/credentials"
	representation := completedInteractionWithOffer(writeOffer)
	representation["scopes"] = writeOffer.Scopes
	resource, err := decodeHookBody[interactiveResponse](representation)
	if err != nil {
		t.Fatal(err)
	}

	output, err := acceptCredentialOffer(resource, *resource.CredentialOffer, "https://auth.example.com", states, func() (string, error) {
		return "", errors.New("reference generator must not run for an existing Resource")
	})
	if err != nil {
		t.Fatal(err)
	}
	body := output.Response.Body.(map[string]any)
	sourceReceipt := body["credentialSource"].(map[string]any)
	if sourceReceipt["reference"] != testCredentialSourceReference {
		t.Fatalf("credential source receipt = %#v", sourceReceipt)
	}
	source := states.state.CredentialSources[testCredentialSourceReference]
	if len(source.Offers) != 2 {
		t.Fatalf("offers = %#v", source.Offers)
	}
	if source.Offers[0].CredentialEndpoint != readOffer.CredentialEndpoint ||
		source.Offers[1].CredentialEndpoint != writeOffer.CredentialEndpoint {
		t.Fatalf("offers = %#v", source.Offers)
	}

	renewedReadOffer := readOffer
	renewedReadOffer.CredentialEndpoint = "https://auth.example.com/api/access-requests/request-read-renewed/credentials"
	representation = completedInteractionWithOffer(renewedReadOffer)
	resource, err = decodeHookBody[interactiveResponse](representation)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := acceptCredentialOffer(resource, *resource.CredentialOffer, "https://auth.example.com", states, func() (string, error) {
		return "", errors.New("reference generator must not run for an existing Resource")
	}); err != nil {
		t.Fatal(err)
	}
	source = states.state.CredentialSources[testCredentialSourceReference]
	if len(source.Offers) != 2 || source.Offers[0].CredentialEndpoint != renewedReadOffer.CredentialEndpoint ||
		source.Offers[1].CredentialEndpoint != writeOffer.CredentialEndpoint {
		t.Fatalf("offers after same-scope replacement = %#v", source.Offers)
	}
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
		fixedCredentialSourceReference,
	)
	if err == nil || !strings.Contains(err.Error(), "self link") {
		t.Fatalf("cross-origin error = %v", err)
	}
	if browser.uri != "" {
		t.Fatalf("opened unsafe URL %q", browser.uri)
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
		"resourceServerId": "zpan", "authorizationDetails": []map[string]any{{"type": "workspace", "identifier": "workspace-1"}},
		"interaction": map[string]any{"type": "user-approval", "status": "completed", "url": nil, "expiresAt": nil},
		"links":       map[string]any{"self": "https://auth.example.com/api/connection-requests/request-1"},
	}
}

func completedInteractionWithOffer(credential dpopCredential) map[string]any {
	body := completedInteraction()
	body["links"] = map[string]any{"self": "https://auth.example.com/api/access-requests/request-1"}
	body["credentialOffer"] = map[string]any{
		"type": "dpop", "resourceIndicator": credential.ResourceIndicator,
		"authorizationDetails": credential.AuthorizationDetails, "endpoint": credential.CredentialEndpoint,
		"proof": map[string]any{"algorithm": "ES256", "method": "POST", "uri": credential.ProofTarget},
	}
	return body
}

package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestCredentialSourceDescribesAgentBootstrapCredentialForRealmrootResource(t *testing.T) {
	t.Log("[spec: agent-identity/agent-identity-enrollment]")
	offer := testCredential(t, "", time.Time{})
	offer.ResourceIndicator = "https://auth.example.com/api"
	offer.Scopes = []string{"resource-servers:read"}
	states := newCredentialState(t, offer)
	client := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.String() != "https://auth.example.com/.well-known/agent-configuration" {
			t.Fatalf("request = %s %s", request.Method, request.URL)
		}
		return jsonResponse(http.StatusOK, testAgentConfiguration()), nil
	})

	output, err := handleCredentialSource(context.Background(), credentialSourceInput{
		Action: "describe", Reference: testCredentialSourceReference, Scopes: []string{"agent:read"},
	}, states, client)
	if err != nil {
		t.Fatal(err)
	}
	if output.Description == nil || output.Description.ProofURI != "https://auth.example.com/api/auth/oauth2/token" ||
		output.Description.Resource != "https://auth.example.com/api" ||
		!sameStringSet(output.Description.Scopes, []string{"agent:read"}) {
		t.Fatalf("description = %#v", output.Description)
	}
}

func TestCredentialSourceIssuesAgentBootstrapCredentialWithRestishProof(t *testing.T) {
	offer := testCredential(t, "", time.Time{})
	offer.ResourceIndicator = "https://auth.example.com/api"
	offer.Scopes = []string{"resource-servers:read"}
	states := newCredentialState(t, offer)
	states.state.ProtocolCredential = nil
	tokenRequests := 0
	client := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		switch request.URL.String() {
		case "https://auth.example.com/.well-known/agent-configuration":
			return jsonResponse(http.StatusOK, testAgentConfiguration()), nil
		case "https://auth.example.com/api/auth/oauth2/token":
			tokenRequests++
			encoded, err := io.ReadAll(request.Body)
			if err != nil {
				t.Fatal(err)
			}
			body, err := url.ParseQuery(string(encoded))
			if err != nil {
				t.Fatal(err)
			}
			if body.Get("resource") != "https://auth.example.com/api" || body.Get("scope") != "agent:read" ||
				body.Get("assertion") == "" {
				t.Fatalf("token form = %#v", body)
			}
			if tokenRequests == 2 && request.Header.Get("DPoP") != "restish-owned-proof" {
				t.Fatalf("Restish DPoP = %q", request.Header.Get("DPoP"))
			}
			return jsonResponse(http.StatusOK, map[string]any{
				"access_token": "bootstrap-token", "token_type": "DPoP", "expires_in": 300, "scope": "agent:read",
			}), nil
		default:
			t.Fatalf("request = %s %s", request.Method, request.URL)
			return nil, nil
		}
	})

	output, err := handleCredentialSource(context.Background(), credentialSourceInput{
		Action: "issue", Reference: testCredentialSourceReference, Scopes: []string{"agent:read"}, Proof: "restish-owned-proof",
	}, states, client)
	if err != nil {
		t.Fatal(err)
	}
	if output.Credential == nil || output.Credential.AccessToken != "bootstrap-token" ||
		output.Credential.Resource != "https://auth.example.com/api" ||
		!sameStringSet(output.Credential.Scopes, []string{"agent:read"}) {
		t.Fatalf("credential = %#v", output.Credential)
	}
	if tokenRequests != 2 || states.state.ProtocolCredential == nil {
		t.Fatalf("token requests = %d, protocol credential = %#v", tokenRequests, states.state.ProtocolCredential)
	}
}

func TestCredentialSourceDescribesStoredOfferWithoutCredentialMaterial(t *testing.T) {
	offer := testCredential(t, "", time.Time{})
	states := newCredentialState(t, offer)

	output, err := handleCredentialSource(context.Background(), credentialSourceInput{
		Action:    "describe",
		Reference: testCredentialSourceReference,
		Scopes:    offer.Scopes,
	}, states, roundTripFunc(nil))
	if err != nil {
		t.Fatal(err)
	}
	if output.Description == nil || output.Description.ProofMethod != http.MethodPost ||
		output.Description.ProofURI != offer.ProofTarget || output.Description.Resource != offer.ResourceIndicator {
		t.Fatalf("description = %#v", output.Description)
	}
	if output.Credential != nil {
		t.Fatalf("describe returned credential material: %#v", output.Credential)
	}
}

func TestCredentialSourceRequiresExplicitAccessForMissingOperationScopes(t *testing.T) {
	t.Log("[spec: agent-identity/restish-explicit-resource-access]")
	writeOffer := testCredential(t, "", time.Time{})
	writeOffer.Scopes = []string{"files:write"}
	readOffer := testCredential(t, "", time.Time{})
	readOffer.CredentialEndpoint = "https://auth.example.com/api/access-requests/request-read/credentials"
	states := newCredentialState(t, writeOffer)
	requests := 0
	client := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests++
		return jsonResponse(http.StatusCreated, completedInteractionWithOffer(readOffer)), nil
	})
	_, err := handleCredentialSource(context.Background(), credentialSourceInput{
		Action: "describe", Reference: testCredentialSourceReference, Scopes: readOffer.Scopes,
	}, states, client)
	if err == nil || !strings.Contains(err.Error(), "request exact Resource access before retrying") ||
		!strings.Contains(err.Error(), testCredentialSourceReference) || !strings.Contains(err.Error(), "files:read") {
		t.Fatalf("error = %v, want explicit Resource access guidance", err)
	}
	if requests != 0 {
		t.Fatalf("credential describe created %d access requests", requests)
	}
}

func TestCredentialSourceIssuesTokenForRestishOwnedProof(t *testing.T) {
	t.Log("[spec: agent-identity/restish-generic-resource-credential-offer]")
	t.Log("[spec: agent-identity/restish-resource-credential-lifecycle]")
	t.Log("[spec: agent-identity/restish-target-token-origin]")
	offer := testCredential(t, "", time.Time{})
	states := newCredentialState(t, offer)
	targetProof := "restish-owned-dpop-proof"
	expiresAt := time.Now().Add(time.Minute)
	client := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.Method != http.MethodPost || request.URL.String() != offer.CredentialEndpoint {
			t.Fatalf("credential request = %s %s", request.Method, request.URL)
		}
		if request.Header.Get("Authorization") != "DPoP protocol-token" || request.Header.Get("DPoP") == "" {
			t.Fatal("credential request omitted Realmroot protocol authentication")
		}
		var body struct {
			Proof struct {
				Type  string `json:"type"`
				Value string `json:"value"`
			} `json:"proof"`
		}
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Proof.Type != "dpop+jwt" || body.Proof.Value != targetProof {
			t.Fatalf("proof = %#v", body.Proof)
		}
		return jsonResponse(http.StatusOK, map[string]any{
			"accessToken":          "target-token",
			"tokenType":            "DPoP",
			"expiresAt":            expiresAt,
			"resourceIndicator":    offer.ResourceIndicator,
			"authorizationDetails": offer.AuthorizationDetails,
			"scopes":               offer.Scopes,
		}), nil
	})

	output, err := handleCredentialSource(context.Background(), credentialSourceInput{
		Action:    "issue",
		Reference: testCredentialSourceReference,
		Scopes:    offer.Scopes,
		Proof:     targetProof,
	}, states, client)
	if err != nil {
		t.Fatal(err)
	}
	if output.Credential == nil || output.Credential.AccessToken != "target-token" || output.Credential.TokenType != "DPoP" {
		t.Fatalf("credential = %#v", output.Credential)
	}
	stored := states.state.CredentialSources[testCredentialSourceReference].Offers[0]
	if stored.PrivateKey != "" || stored.AccessToken != "" || stored.ExpiresAt != nil {
		t.Fatalf("plugin retained target credential material: %#v", stored)
	}
}

func TestCredentialSourceCreatesInternalProtocolCredentialForExternalOffer(t *testing.T) {
	offer := testCredential(t, "", time.Time{})
	states := newCredentialState(t, offer)
	states.state.ProtocolCredential = nil
	expiresAt := time.Now().Add(time.Minute)
	client := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		switch request.URL.String() {
		case "https://auth.example.com/.well-known/agent-configuration":
			return jsonResponse(http.StatusOK, testAgentConfiguration()), nil
		case "https://auth.example.com/api/auth/oauth2/token":
			encoded, err := io.ReadAll(request.Body)
			if err != nil {
				t.Fatal(err)
			}
			body, err := url.ParseQuery(string(encoded))
			if err != nil {
				t.Fatal(err)
			}
			if body.Get("resource") != "https://auth.example.com/api" ||
				body.Get("scope") != "access-requests:read access-requests:write" {
				t.Fatalf("protocol token form = %#v", body)
			}
			return jsonResponse(http.StatusOK, map[string]any{
				"access_token": "protocol-token", "token_type": "DPoP", "expires_in": 300,
			}), nil
		case offer.CredentialEndpoint:
			return jsonResponse(http.StatusOK, map[string]any{
				"accessToken": "target-token", "tokenType": "DPoP", "expiresAt": expiresAt,
				"resourceIndicator": offer.ResourceIndicator, "authorizationDetails": offer.AuthorizationDetails,
				"scopes": offer.Scopes,
			}), nil
		default:
			t.Fatalf("request = %s %s", request.Method, request.URL)
			return nil, nil
		}
	})

	output, err := handleCredentialSource(context.Background(), credentialSourceInput{
		Action: "issue", Reference: testCredentialSourceReference, Scopes: offer.Scopes, Proof: "target-proof",
	}, states, client)
	if err != nil {
		t.Fatal(err)
	}
	if output.Credential == nil || output.Credential.AccessToken != "target-token" ||
		states.state.ProtocolCredential == nil ||
		states.state.ProtocolCredential.ResourceIndicator != "https://auth.example.com/api" {
		t.Fatalf("credential = %#v, protocol = %#v", output.Credential, states.state.ProtocolCredential)
	}
}

func TestCredentialSourceReturnsStructuredDPoPNonceChallenge(t *testing.T) {
	offer := testCredential(t, "", time.Time{})
	states := newCredentialState(t, offer)
	client := roundTripFunc(func(*http.Request) (*http.Response, error) {
		response := jsonResponse(http.StatusBadRequest, map[string]any{
			"error":             "use_dpop_nonce",
			"error_description": "Authorization server requires nonce in DPoP proof",
		})
		response.Header.Set("DPoP-Nonce", "challenge-nonce")
		return response, nil
	})

	output, err := handleCredentialSource(context.Background(), credentialSourceInput{
		Action: "issue", Reference: testCredentialSourceReference, Scopes: offer.Scopes, Proof: "first-proof",
	}, states, client)
	if err != nil {
		t.Fatal(err)
	}
	if output.Challenge == nil || output.Challenge.Type != "dpop-nonce" || output.Challenge.Nonce != "challenge-nonce" {
		t.Fatalf("challenge = %#v", output.Challenge)
	}
	if output.Credential != nil || output.Description != nil {
		t.Fatalf("challenge response contains another result: %#v", output)
	}
}

func TestCredentialSourceReturnsNextDPoPNonceWithIssuedCredential(t *testing.T) {
	offer := testCredential(t, "", time.Time{})
	states := newCredentialState(t, offer)
	expiresAt := time.Now().Add(time.Minute)
	client := roundTripFunc(func(*http.Request) (*http.Response, error) {
		response := jsonResponse(http.StatusCreated, map[string]any{
			"accessToken":          "target-token",
			"tokenType":            "DPoP",
			"expiresAt":            expiresAt,
			"resourceIndicator":    offer.ResourceIndicator,
			"authorizationDetails": offer.AuthorizationDetails,
			"scopes":               offer.Scopes,
		})
		response.Header.Set("DPoP-Nonce", "next-nonce")
		return response, nil
	})

	output, err := handleCredentialSource(context.Background(), credentialSourceInput{
		Action: "issue", Reference: testCredentialSourceReference, Scopes: offer.Scopes, Proof: "nonce-proof",
	}, states, client)
	if err != nil {
		t.Fatal(err)
	}
	if output.Credential == nil || output.Credential.Nonce != "next-nonce" {
		t.Fatalf("credential = %#v", output.Credential)
	}
}

func TestCredentialSourceRemovesOnlyTerminallyRejectedOffer(t *testing.T) {
	readOffer := testCredential(t, "", time.Time{})
	writeOffer := readOffer
	writeOffer.CredentialEndpoint = "https://auth.example.com/api/agent/access-requests/write/credentials"
	writeOffer.Scopes = []string{"files:write"}
	states := newCredentialState(t, readOffer)
	source := states.state.CredentialSources[testCredentialSourceReference]
	source.Offers = append(source.Offers, writeOffer)
	states.state.CredentialSources[testCredentialSourceReference] = source
	client := roundTripFunc(func(*http.Request) (*http.Response, error) {
		return jsonResponse(http.StatusForbidden, map[string]any{"error": "insufficient_scope"}), nil
	})

	_, err := handleCredentialSource(context.Background(), credentialSourceInput{
		Action: "issue", Reference: testCredentialSourceReference, Scopes: readOffer.Scopes, Proof: "proof",
	}, states, client)
	if err == nil {
		t.Fatal("issue unexpectedly succeeded")
	}
	remaining := states.state.CredentialSources[testCredentialSourceReference].Offers
	if len(remaining) != 1 || !sameCredentialOffer(remaining[0], writeOffer) {
		t.Fatalf("remaining offers = %#v", remaining)
	}
}

func TestCredentialSourceRetainsBindingAfterLastOfferIsRejected(t *testing.T) {
	offer := testCredential(t, "", time.Time{})
	states := newCredentialState(t, offer)
	client := roundTripFunc(func(*http.Request) (*http.Response, error) {
		return jsonResponse(http.StatusNotFound, map[string]any{"error": "not_found"}), nil
	})

	_, err := handleCredentialSource(context.Background(), credentialSourceInput{
		Action: "issue", Reference: testCredentialSourceReference, Scopes: offer.Scopes, Proof: "proof",
	}, states, client)
	if err == nil {
		t.Fatal("issue unexpectedly succeeded")
	}
	source, ok := states.state.CredentialSources[testCredentialSourceReference]
	if !ok {
		t.Fatal("terminal rejection removed the credential source binding")
	}
	if len(source.Offers) != 0 || source.ResourceIndicator != offer.ResourceIndicator ||
		!sameAuthorizationDetails(source.AuthorizationDetails, offer.AuthorizationDetails) {
		t.Fatalf("retained credential source = %#v", source)
	}

	_, err = handleCredentialSource(context.Background(), credentialSourceInput{
		Action: "describe", Reference: testCredentialSourceReference, Scopes: offer.Scopes,
	}, states, client)
	if err == nil || !strings.Contains(err.Error(), "request exact Resource access") {
		t.Fatalf("describe error = %v", err)
	}
}

func TestCredentialSourceRetainsOfferAfterRetryableFailure(t *testing.T) {
	offer := testCredential(t, "", time.Time{})
	states := newCredentialState(t, offer)
	client := roundTripFunc(func(*http.Request) (*http.Response, error) {
		return jsonResponse(http.StatusServiceUnavailable, map[string]any{"error": "temporarily_unavailable"}), nil
	})

	_, err := handleCredentialSource(context.Background(), credentialSourceInput{
		Action: "issue", Reference: testCredentialSourceReference, Scopes: offer.Scopes, Proof: "proof",
	}, states, client)
	if err == nil {
		t.Fatal("issue unexpectedly succeeded")
	}
	if len(states.state.CredentialSources[testCredentialSourceReference].Offers) != 1 {
		t.Fatal("retryable failure removed the stored offer")
	}
}

func TestCredentialSourceRetainsOfferAfterInvalidSuccessfulResponse(t *testing.T) {
	offer := testCredential(t, "", time.Time{})
	states := newCredentialState(t, offer)
	client := roundTripFunc(func(*http.Request) (*http.Response, error) {
		return jsonResponse(http.StatusCreated, map[string]any{
			"accessToken": "token", "tokenType": "Bearer", "expiresAt": time.Now().Add(time.Minute),
			"resourceIndicator": offer.ResourceIndicator, "authorizationDetails": offer.AuthorizationDetails,
			"scopes": offer.Scopes,
		}), nil
	})

	_, err := handleCredentialSource(context.Background(), credentialSourceInput{
		Action: "issue", Reference: testCredentialSourceReference, Scopes: offer.Scopes, Proof: "proof",
	}, states, client)
	if err == nil || !strings.Contains(err.Error(), "invalid target API access token") {
		t.Fatalf("issue error = %v", err)
	}
	if len(states.state.CredentialSources[testCredentialSourceReference].Offers) != 1 {
		t.Fatal("invalid successful response removed the stored offer")
	}
}

func TestCredentialSourceRetainsOfferWhenInternalProtocolAuthenticationFails(t *testing.T) {
	offer := testCredential(t, "", time.Time{})
	states := newCredentialState(t, offer)
	states.state.ProtocolCredential = nil
	client := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.String() == "https://auth.example.com/.well-known/agent-configuration" {
			return jsonResponse(http.StatusOK, testAgentConfiguration()), nil
		}
		return jsonResponse(http.StatusForbidden, map[string]any{"error": "insufficient_scope"}), nil
	})

	_, err := handleCredentialSource(context.Background(), credentialSourceInput{
		Action: "issue", Reference: testCredentialSourceReference, Scopes: offer.Scopes, Proof: "proof",
	}, states, client)
	if err == nil {
		t.Fatal("issue unexpectedly succeeded")
	}
	if len(states.state.CredentialSources[testCredentialSourceReference].Offers) != 1 {
		t.Fatal("internal protocol authentication failure removed the stored offer")
	}
}

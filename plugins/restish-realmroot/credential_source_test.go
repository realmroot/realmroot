package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

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

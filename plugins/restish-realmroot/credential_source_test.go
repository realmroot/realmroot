package main

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

func TestCredentialSourceDescribesStoredOfferWithoutCredentialMaterial(t *testing.T) {
	offer := testCredential(t, "", time.Time{})
	states := newCredentialState(t, offer)

	output, err := handleCredentialSource(context.Background(), credentialSourceInput{
		Action:    "describe",
		Reference: offer.ResourceHref,
		Scopes:    offer.Scopes,
	}, states, roundTripFunc(nil), &browserRecorder{})
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

func TestCredentialSourceAcquiresAndRetainsAnOfferForTheOperationScopes(t *testing.T) {
	writeOffer := testCredential(t, "", time.Time{})
	writeOffer.Scopes = []string{"files:write"}
	readOffer := testCredential(t, "", time.Time{})
	readOffer.CredentialEndpoint = "https://auth.example.com/api/access-requests/request-read/credentials"
	states := newCredentialState(t, writeOffer)
	client := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.Method != http.MethodPost || request.URL.String() != "https://auth.example.com/api/access/requests" {
			t.Fatalf("access request = %s %s", request.Method, request.URL)
		}
		var body struct {
			Resource struct {
				Href string `json:"href"`
			} `json:"resource"`
			Scopes []string `json:"scopes"`
		}
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Resource.Href != readOffer.ResourceHref || !sameStringSet(body.Scopes, readOffer.Scopes) {
			t.Fatalf("access request body = %#v", body)
		}
		return jsonResponse(http.StatusCreated, completedInteractionWithOffer(readOffer)), nil
	})

	output, err := handleCredentialSource(context.Background(), credentialSourceInput{
		Action: "describe", Reference: readOffer.ResourceHref, Scopes: readOffer.Scopes,
	}, states, client, &browserRecorder{})
	if err != nil {
		t.Fatal(err)
	}
	if output.Description == nil || !sameStringSet(output.Description.Scopes, readOffer.Scopes) {
		t.Fatalf("description = %#v", output.Description)
	}
	offers := states.state.DPoPCredentialOffers[readOffer.ResourceHref]
	if len(offers) != 2 {
		t.Fatalf("stored offers = %#v, want read and write offers", offers)
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
			"accessToken":       "target-token",
			"tokenType":         "DPoP",
			"expiresAt":         expiresAt,
			"resourceIndicator": offer.ResourceIndicator,
			"scopes":            offer.Scopes,
			"resource":          map[string]any{"href": offer.ResourceHref},
		}), nil
	})

	output, err := handleCredentialSource(context.Background(), credentialSourceInput{
		Action:    "issue",
		Reference: offer.ResourceHref,
		Scopes:    offer.Scopes,
		Proof:     targetProof,
	}, states, client, &browserRecorder{})
	if err != nil {
		t.Fatal(err)
	}
	if output.Credential == nil || output.Credential.AccessToken != "target-token" || output.Credential.TokenType != "DPoP" {
		t.Fatalf("credential = %#v", output.Credential)
	}
	stored := states.state.DPoPCredentialOffers[offer.ResourceHref][0]
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
		Action: "issue", Reference: offer.ResourceHref, Scopes: offer.Scopes, Proof: "first-proof",
	}, states, client, &browserRecorder{})
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
			"accessToken":       "target-token",
			"tokenType":         "DPoP",
			"expiresAt":         expiresAt,
			"resourceIndicator": offer.ResourceIndicator,
			"scopes":            offer.Scopes,
			"resource":          map[string]any{"href": offer.ResourceHref},
		})
		response.Header.Set("DPoP-Nonce", "next-nonce")
		return response, nil
	})

	output, err := handleCredentialSource(context.Background(), credentialSourceInput{
		Action: "issue", Reference: offer.ResourceHref, Scopes: offer.Scopes, Proof: "nonce-proof",
	}, states, client, &browserRecorder{})
	if err != nil {
		t.Fatal(err)
	}
	if output.Credential == nil || output.Credential.Nonce != "next-nonce" {
		t.Fatalf("credential = %#v", output.Credential)
	}
}

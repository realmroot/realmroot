package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

type credentialSourceInput struct {
	Action    string   `cbor:"action" json:"action"`
	Reference string   `cbor:"reference" json:"reference"`
	Scopes    []string `cbor:"scopes,omitempty" json:"scopes,omitempty"`
	Proof     string   `cbor:"proof,omitempty" json:"proof,omitempty"`
}

type credentialSourceDescription struct {
	ProofMethod string   `cbor:"proof_method" json:"proofMethod"`
	ProofURI    string   `cbor:"proof_uri" json:"proofUri"`
	Resource    string   `cbor:"resource" json:"resource"`
	Scopes      []string `cbor:"scopes,omitempty" json:"scopes,omitempty"`
}

type credentialSourceCredential struct {
	AccessToken string    `cbor:"access_token" json:"accessToken"`
	TokenType   string    `cbor:"token_type" json:"tokenType"`
	ExpiresAt   time.Time `cbor:"expires_at" json:"expiresAt"`
	Resource    string    `cbor:"resource" json:"resource"`
	Scopes      []string  `cbor:"scopes,omitempty" json:"scopes,omitempty"`
	Nonce       string    `cbor:"nonce,omitempty" json:"nonce,omitempty"`
}

type credentialSourceChallenge struct {
	Type  string `cbor:"type" json:"type"`
	Nonce string `cbor:"nonce" json:"nonce"`
}

type credentialSourceOutput struct {
	Description *credentialSourceDescription `cbor:"description,omitempty" json:"description,omitempty"`
	Credential  *credentialSourceCredential  `cbor:"credential,omitempty" json:"credential,omitempty"`
	Challenge   *credentialSourceChallenge   `cbor:"challenge,omitempty" json:"challenge,omitempty"`
}

type dpopNonceChallenge struct{ nonce string }

func (e *dpopNonceChallenge) Error() string {
	return "Realmroot requires a nonce in the target DPoP proof"
}

func handleCredentialSource(
	ctx context.Context,
	input credentialSourceInput,
	states credentialOfferStore,
	client httpDoer,
	opener browserOpener,
) (credentialSourceOutput, error) {
	if input.Reference == "" {
		return credentialSourceOutput{}, errors.New("Realmroot credential source reference is required")
	}
	runtime, err := agentRuntime()
	if err != nil {
		return credentialSourceOutput{}, err
	}
	switch input.Action {
	case "describe":
		if input.Proof != "" {
			return credentialSourceOutput{}, errors.New("Realmroot credential describe must not include a proof")
		}
		reference, err := ensureCredentialOffer(ctx, states, client, opener, input.Reference, runtime, input.Scopes)
		if err != nil {
			return credentialSourceOutput{}, err
		}
		offer := reference.credential
		return credentialSourceOutput{Description: &credentialSourceDescription{
			ProofMethod: http.MethodPost,
			ProofURI:    offer.ProofTarget,
			Resource:    offer.ResourceIndicator,
			Scopes:      append([]string(nil), offer.Scopes...),
		}}, nil
	case "issue":
		if strings.TrimSpace(input.Proof) == "" {
			return credentialSourceOutput{}, errors.New("Realmroot credential issue requires a DPoP proof")
		}
		reference, err := states.FindCredentialOffer(input.Reference, runtime, input.Scopes)
		if err != nil {
			return credentialSourceOutput{}, err
		}
		offer := reference.credential
		token, err := issueTargetCredential(ctx, client, reference.state, offer, input.Proof)
		if err != nil {
			var challenge *dpopNonceChallenge
			if errors.As(err, &challenge) {
				return credentialSourceOutput{Challenge: &credentialSourceChallenge{
					Type: "dpop-nonce", Nonce: challenge.nonce,
				}}, nil
			}
			return credentialSourceOutput{}, err
		}
		return credentialSourceOutput{Credential: &credentialSourceCredential{
			AccessToken: token.AccessToken,
			TokenType:   token.TokenType,
			ExpiresAt:   token.ExpiresAt,
			Resource:    token.ResourceIndicator,
			Scopes:      append([]string(nil), token.Scopes...),
			Nonce:       token.DPoPNonce,
		}}, nil
	default:
		return credentialSourceOutput{}, fmt.Errorf("unsupported Realmroot credential source action %q", input.Action)
	}
}

func ensureCredentialOffer(
	ctx context.Context,
	states credentialOfferStore,
	client httpDoer,
	opener browserOpener,
	reference string,
	runtime string,
	scopes []string,
) (resourceCredentialReference, error) {
	stored, err := states.FindCredentialOffer(reference, runtime, scopes)
	if err == nil {
		return stored, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return resourceCredentialReference{}, err
	}
	stateReference, err := states.FindCredentialState(reference, runtime)
	if err != nil {
		return resourceCredentialReference{}, err
	}
	protocol, err := usableProtocolCredential(ctx, client, stateReference.state)
	if err != nil {
		return resourceCredentialReference{}, err
	}
	endpoint := stateReference.state.Origin + "/api/access/requests"
	proof, err := signDPoPProof(protocol.PrivateKey, http.MethodPost, endpoint, protocol.AccessToken, time.Now())
	if err != nil {
		return resourceCredentialReference{}, err
	}
	var representation map[string]any
	if err := requestJSONHeaders(
		ctx,
		client,
		http.MethodPost,
		endpoint,
		map[string]string{"Authorization": "DPoP " + protocol.AccessToken, "DPoP": proof},
		map[string]any{
			"resource": map[string]string{"href": reference},
			"scopes":   append([]string(nil), scopes...),
			"reason":   "Use the configured Resource credential for the requested operation",
		},
		&representation,
	); err != nil {
		return resourceCredentialReference{}, fmt.Errorf("request Resource credential offer: %w", err)
	}
	resource, err := decodeHookBody[interactiveResponse](representation)
	if err != nil {
		return resourceCredentialReference{}, fmt.Errorf("decode Resource credential offer: %w", err)
	}
	if _, err := handleInteractiveResource(
		ctx,
		resource,
		representation,
		2*time.Second,
		stateReference.state.Origin,
		opener,
		states,
		client,
	); err != nil {
		return resourceCredentialReference{}, err
	}
	return states.FindCredentialOffer(reference, runtime, scopes)
}

func issueTargetCredential(
	ctx context.Context,
	client httpDoer,
	state agentState,
	offer dpopCredential,
	targetProof string,
) (targetTokenResponse, error) {
	if offer.CredentialEndpoint == "" || offer.ProofTarget == "" {
		return targetTokenResponse{}, errors.New("stored Resource credential offer is incomplete")
	}
	if !sameOrigin(offer.CredentialEndpoint, state.Origin) {
		return targetTokenResponse{}, errors.New("stored Resource credential endpoint does not belong to its issuer")
	}
	protocol, err := usableProtocolCredential(ctx, client, state)
	if err != nil {
		return targetTokenResponse{}, err
	}
	requestProof, err := signDPoPProof(
		protocol.PrivateKey,
		http.MethodPost,
		offer.CredentialEndpoint,
		protocol.AccessToken,
		time.Now(),
	)
	if err != nil {
		return targetTokenResponse{}, err
	}
	var token targetTokenResponse
	responseHeaders, err := requestJSONHeadersResponse(
		ctx,
		client,
		http.MethodPost,
		offer.CredentialEndpoint,
		map[string]string{
			"Authorization": "DPoP " + protocol.AccessToken,
			"DPoP":          requestProof,
		},
		map[string]any{"proof": map[string]any{"type": "dpop+jwt", "value": targetProof}},
		&token,
	)
	if err != nil {
		if challenge, ok := realmrootDPoPNonceChallenge(err); ok {
			return targetTokenResponse{}, challenge
		}
		return targetTokenResponse{}, fmt.Errorf("issue target API access token: %w", err)
	}
	nonce, err := responseDPoPNonce(responseHeaders)
	if err != nil {
		return targetTokenResponse{}, fmt.Errorf("issue target API access token: %w", err)
	}
	token.DPoPNonce = nonce
	if token.TokenType != "DPoP" || token.AccessToken == "" || token.ResourceIndicator != offer.ResourceIndicator ||
		token.Resource.Href != offer.ResourceHref || !token.ExpiresAt.After(time.Now()) ||
		!sameStringSet(token.Scopes, offer.Scopes) {
		return targetTokenResponse{}, errors.New("Realmroot returned an invalid target API access token")
	}
	return token, nil
}

func realmrootDPoPNonceChallenge(err error) (*dpopNonceChallenge, bool) {
	var responseErr *httpResponseError
	if !errors.As(err, &responseErr) || responseErr.StatusCode != http.StatusBadRequest {
		return nil, false
	}
	var body struct {
		Error string `json:"error"`
	}
	if json.Unmarshal([]byte(responseErr.Body), &body) != nil || body.Error != "use_dpop_nonce" {
		return nil, false
	}
	nonce, nonceErr := responseDPoPNonce(responseErr.Header)
	if nonceErr != nil || nonce == "" {
		return nil, false
	}
	return &dpopNonceChallenge{nonce: nonce}, true
}

func responseDPoPNonce(headers http.Header) (string, error) {
	values := headers.Values("DPoP-Nonce")
	if len(values) == 0 {
		return "", nil
	}
	if len(values) != 1 || !validDPoPNonce(values[0]) {
		return "", errors.New("Realmroot returned an invalid DPoP nonce")
	}
	return values[0], nil
}

func validDPoPNonce(value string) bool {
	if value == "" || len(value) > 4096 {
		return false
	}
	for _, char := range []byte(value) {
		if char != 0x21 && (char < 0x23 || char > 0x5b) && (char < 0x5d || char > 0x7e) {
			return false
		}
	}
	return true
}

func sameStringSet(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	values := make(map[string]int, len(left))
	for _, value := range left {
		values[value]++
	}
	for _, value := range right {
		values[value]--
		if values[value] < 0 {
			return false
		}
	}
	return true
}

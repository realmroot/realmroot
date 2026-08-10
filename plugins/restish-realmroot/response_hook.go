package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/rest-sh/restish/v2/plugin"
)

const (
	interactiveResourceProfile = "https://realmroot.dev/profiles/interactive-resource"
)

type interactiveResponse struct {
	ID          string   `json:"id"`
	AgentID     string   `json:"agentId"`
	Status      string   `json:"status"`
	Scopes      []string `json:"scopes"`
	Interaction struct {
		Type      string     `json:"type"`
		Status    string     `json:"status"`
		URL       string     `json:"url"`
		ExpiresAt *time.Time `json:"expiresAt"`
	} `json:"interaction"`
	Links struct {
		Self string `json:"self"`
	} `json:"links"`
	CredentialOffer *credentialOffer `json:"credentialOffer"`
}

type credentialOffer struct {
	Type                 string           `json:"type"`
	ResourceIndicator    string           `json:"resourceIndicator"`
	AuthorizationDetails []map[string]any `json:"authorizationDetails"`
	Endpoint             string           `json:"endpoint"`
	Proof                struct {
		Algorithm string `json:"algorithm"`
		Method    string `json:"method"`
		URI       string `json:"uri"`
	} `json:"proof"`
}

func handleProfiledResponse(
	input plugin.ResponseMiddlewareInput,
	opener browserOpener,
	states agentStateFinder,
	client httpDoer,
	references credentialSourceReferenceGenerator,
) (plugin.ResponseMiddlewareOutput, error) {
	if input.Response.Status < 200 || input.Response.Status >= 300 || !hasProfile(input.Response.Headers, interactiveResourceProfile) {
		return plugin.ResponseMiddlewareOutput{}, nil
	}
	representation, err := decodeHookBody[map[string]any](input.Response.Body)
	if err != nil {
		return plugin.ResponseMiddlewareOutput{}, fmt.Errorf("decode interactive Resource representation: %w", err)
	}
	body, err := decodeHookBody[interactiveResponse](representation)
	if err != nil {
		return plugin.ResponseMiddlewareOutput{}, fmt.Errorf("decode interactive Resource response: %w", err)
	}
	requestURL, err := url.Parse(input.Request.URI)
	if err != nil || requestURL.Scheme == "" || requestURL.Host == "" {
		return plugin.ResponseMiddlewareOutput{}, errors.New("interactive Resource request URL is invalid")
	}
	origin := requestURL.Scheme + "://" + requestURL.Host
	return handleInteractiveResource(
		context.Background(),
		body,
		representation,
		retryAfter(input.Response.Headers),
		origin,
		opener,
		states,
		client,
		references,
	)
}

func handleInteractiveResource(
	ctx context.Context,
	resource interactiveResponse,
	representation map[string]any,
	interval time.Duration,
	origin string,
	opener browserOpener,
	states agentStateFinder,
	client httpDoer,
	references credentialSourceReferenceGenerator,
) (plugin.ResponseMiddlewareOutput, error) {
	if resource.AgentID == "" || resource.Links.Self == "" || resource.Interaction.Type != "user-approval" {
		return plugin.ResponseMiddlewareOutput{}, errors.New("interactive Resource is missing its Agent, self link, or interaction type")
	}
	if !sameOrigin(resource.Links.Self, origin) {
		return plugin.ResponseMiddlewareOutput{}, errors.New("interactive Resource self link must use the discovered issuer origin")
	}
	state, err := stateForInteractiveResource(states, origin, resource.AgentID)
	if err != nil {
		return plugin.ResponseMiddlewareOutput{}, err
	}
	for {
		switch resource.Interaction.Status {
		case "completed":
			if resource.CredentialOffer != nil {
				return acceptCredentialOffer(resource, *resource.CredentialOffer, origin, states, references)
			}
			return plugin.ResponseMiddlewareOutput{Response: &plugin.HookResponseUpdate{Body: representation}}, nil
		case "denied", "expired", "failed":
			return plugin.ResponseMiddlewareOutput{}, fmt.Errorf("controller interaction %s", resource.Interaction.Status)
		case "pending":
		default:
			return plugin.ResponseMiddlewareOutput{}, fmt.Errorf("interactive Resource returned unsupported status %q", resource.Interaction.Status)
		}
		if resource.Interaction.URL == "" || resource.Interaction.ExpiresAt == nil {
			return plugin.ResponseMiddlewareOutput{}, errors.New("pending interactive Resource is missing approval URL or expiry")
		}
		if !sameOrigin(resource.Interaction.URL, origin) {
			return plugin.ResponseMiddlewareOutput{}, errors.New("interactive Resource approval URL must use the discovered issuer origin")
		}
		if err := opener.Open(resource.Interaction.URL); err != nil {
			return plugin.ResponseMiddlewareOutput{}, fmt.Errorf("open controller interaction: %w", err)
		}
		for time.Now().Before(*resource.Interaction.ExpiresAt) {
			timer := time.NewTimer(interval)
			select {
			case <-ctx.Done():
				timer.Stop()
				return plugin.ResponseMiddlewareOutput{}, ctx.Err()
			case <-timer.C:
			}
			var polledRepresentation map[string]any
			protocol, err := usableProtocolCredential(ctx, client, state)
			if err != nil {
				return plugin.ResponseMiddlewareOutput{}, err
			}
			proof, err := signDPoPProof(protocol.PrivateKey, http.MethodGet, resource.Links.Self, protocol.AccessToken, time.Now())
			if err != nil {
				return plugin.ResponseMiddlewareOutput{}, err
			}
			if err := requestJSONHeaders(
				ctx,
				client,
				http.MethodGet,
				resource.Links.Self,
				map[string]string{
					"Authorization": "DPoP " + protocol.AccessToken,
					"DPoP":          proof,
				},
				nil,
				&polledRepresentation,
			); err != nil {
				return plugin.ResponseMiddlewareOutput{}, err
			}
			polledResource, err := decodeHookBody[interactiveResponse](polledRepresentation)
			if err != nil {
				return plugin.ResponseMiddlewareOutput{}, fmt.Errorf("decode polled interactive Resource: %w", err)
			}
			resource = polledResource
			representation = polledRepresentation
			if resource.Interaction.Status != "pending" {
				break
			}
		}
		if resource.Interaction.Status == "pending" {
			return plugin.ResponseMiddlewareOutput{}, errors.New("controller interaction expired; invoke the request again")
		}
	}
}

func acceptCredentialOffer(
	resource interactiveResponse,
	offer credentialOffer,
	origin string,
	states agentStateFinder,
	references credentialSourceReferenceGenerator,
) (plugin.ResponseMiddlewareOutput, error) {
	if offer.Type != "dpop" || offer.Proof.Algorithm != "ES256" || offer.Proof.Method != http.MethodPost ||
		offer.ResourceIndicator == "" || offer.Endpoint == "" || offer.Proof.URI == "" {
		return plugin.ResponseMiddlewareOutput{}, errors.New("Resource credential offer is invalid")
	}
	if !sameOrigin(offer.Endpoint, origin) {
		return plugin.ResponseMiddlewareOutput{}, errors.New("Resource credential endpoint must use the discovered issuer origin")
	}
	store, ok := states.(resourceAccessStateStore)
	if !ok {
		return plugin.ResponseMiddlewareOutput{}, errors.New("Agent state store cannot persist Resource credentials")
	}
	runtime, err := agentRuntime()
	if err != nil {
		return plugin.ResponseMiddlewareOutput{}, err
	}
	reference, err := store.FindReferenceByOriginIdentityRuntime(origin, resource.AgentID, runtime)
	if err != nil {
		return plugin.ResponseMiddlewareOutput{}, err
	}
	authorizationDetails := append([]map[string]any{}, offer.AuthorizationDetails...)
	credential := dpopCredential{
		ResourceIndicator:    offer.ResourceIndicator,
		AuthorizationDetails: authorizationDetails,
		CredentialEndpoint:   offer.Endpoint,
		ProofTarget:          offer.Proof.URI,
		Scopes:               append([]string(nil), resource.Scopes...),
	}
	if reference.state.CredentialSources == nil {
		reference.state.CredentialSources = make(map[string]credentialSource)
	}
	credentialSourceReference := ""
	for candidateReference, source := range reference.state.CredentialSources {
		if source.ResourceIndicator == credential.ResourceIndicator &&
			sameAuthorizationDetails(source.AuthorizationDetails, credential.AuthorizationDetails) {
			if credentialSourceReference != "" {
				return plugin.ResponseMiddlewareOutput{}, errors.New("multiple credential sources exist for the same Resource")
			}
			credentialSourceReference = candidateReference
		}
	}
	if credentialSourceReference == "" {
		credentialSourceReference, err = references()
		if err != nil {
			return plugin.ResponseMiddlewareOutput{}, err
		}
		if !isCredentialSourceReference(credentialSourceReference) {
			return plugin.ResponseMiddlewareOutput{}, errors.New("generated credential source reference is invalid")
		}
		if _, exists := reference.state.CredentialSources[credentialSourceReference]; exists {
			return plugin.ResponseMiddlewareOutput{}, errors.New("generated credential source reference already exists")
		}
		reference.state.CredentialSources[credentialSourceReference] = credentialSource{
			ResourceIndicator:    credential.ResourceIndicator,
			AuthorizationDetails: append([]map[string]any{}, credential.AuthorizationDetails...),
			Offers:               []dpopCredential{credential},
		}
	} else {
		source := reference.state.CredentialSources[credentialSourceReference]
		replaced := false
		for index := range source.Offers {
			if sameStringSet(source.Offers[index].Scopes, credential.Scopes) {
				source.Offers[index] = credential
				replaced = true
				break
			}
		}
		if !replaced {
			source.Offers = append(source.Offers, credential)
		}
		reference.state.CredentialSources[credentialSourceReference] = source
	}
	if err := store.UpdateStateReference(reference); err != nil {
		return plugin.ResponseMiddlewareOutput{}, err
	}
	return plugin.ResponseMiddlewareOutput{Response: &plugin.HookResponseUpdate{Body: map[string]any{
		"status":               "ready",
		"resourceIndicator":    credential.ResourceIndicator,
		"authorizationDetails": credential.AuthorizationDetails,
		"scopes":               resource.Scopes,
		"credentialSource": map[string]any{
			"name":      "realmroot",
			"reference": credentialSourceReference,
		},
	}}}, nil
}

func stateForInteractiveResource(states agentStateFinder, origin string, agentID string) (agentState, error) {
	if finder, ok := states.(resourceStateFinder); ok {
		state, err := finder.FindByOriginAndIdentityID(origin, agentID)
		if err == nil {
			return state, nil
		}
	}
	return states.FindByOriginAndAgentID(origin, agentID)
}

func hasProfile(headers map[string][]string, expected string) bool {
	for name, values := range headers {
		if !strings.EqualFold(name, "Link") {
			continue
		}
		for _, value := range values {
			if strings.Contains(value, "<"+expected+">") && strings.Contains(value, `rel="profile"`) {
				return true
			}
		}
	}
	return false
}

func retryAfter(headers map[string][]string) time.Duration {
	for name, values := range headers {
		if strings.EqualFold(name, "Retry-After") && len(values) > 0 {
			seconds, err := strconv.Atoi(values[0])
			if err == nil && seconds > 0 && seconds <= 60 {
				return time.Duration(seconds) * time.Second
			}
		}
	}
	return 2 * time.Second
}

func decodeHookBody[T any](body any) (T, error) {
	var output T
	encoded, err := json.Marshal(body)
	if err != nil {
		return output, err
	}
	if err := json.Unmarshal(encoded, &output); err != nil {
		return output, err
	}
	return output, nil
}

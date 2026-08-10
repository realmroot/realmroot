package main

import (
	"context"
	"net/url"
	"strings"

	"github.com/rest-sh/restish/v2/plugin"
)

const (
	oauth2SchemeID         = "oauth2"
	agentAssertionSchemeID = "agentAssertion"
)

type authRequirement struct {
	ID    string   `cbor:"id" json:"id"`
	Kind  string   `cbor:"kind" json:"kind"`
	Needs []string `cbor:"needs,omitempty" json:"needs,omitempty"`
}

type authResolverInput struct {
	Type         string             `cbor:"type" json:"type"`
	API          string             `cbor:"api" json:"api"`
	Profile      string             `cbor:"profile" json:"profile"`
	Requirements []authRequirement  `cbor:"requirements" json:"requirements"`
	Request      plugin.HookRequest `cbor:"request" json:"request"`
}

type authResolverOutput struct {
	Handled bool `cbor:"handled" json:"handled"`
}

type authHookEnvelope struct {
	Type         string             `cbor:"type" json:"type"`
	API          string             `cbor:"api" json:"api"`
	Profile      string             `cbor:"profile" json:"profile"`
	Params       map[string]string  `cbor:"params" json:"params"`
	Requirements []authRequirement  `cbor:"requirements,omitempty" json:"requirements,omitempty"`
	Request      plugin.HookRequest `cbor:"request" json:"request"`
}

func resolveProtocolAuthentication(
	input authResolverInput,
	cache agentConfigurationCache,
	client httpDoer,
) (authResolverOutput, error) {
	if !supportedProtocolAlternative(input.Requirements) {
		return authResolverOutput{}, nil
	}
	return authResolverOutput{
		Handled: protocolAuthenticationSupports(input.Request, input.Requirements, cache, client),
	}, nil
}

func protocolAuthenticationSupports(
	request plugin.HookRequest,
	requirements []authRequirement,
	cache agentConfigurationCache,
	client httpDoer,
) bool {
	origin, err := realmrootOrigin(request.URI)
	if err != nil {
		return false
	}
	configuration, err := resolveAgentConfiguration(context.Background(), client, cache, origin)
	if err != nil {
		return false
	}
	switch requirements[0].ID {
	case oauth2SchemeID:
		return automaticAgentCredentialSupports(configuration, requirements[0].Needs)
	case agentAssertionSchemeID:
		return isAgentEnrollmentRequest(request, configuration.AgentEnrollmentEndpoint)
	default:
		return false
	}
}

func automaticAgentCredentialSupports(configuration agentConfiguration, scopes []string) bool {
	return len(scopes) > 0 && scopesContain(configuration.AgentBootstrapScopes, scopes)
}

func isAgentEnrollmentRequest(request plugin.HookRequest, endpoint string) bool {
	requestURL, requestErr := url.Parse(request.URI)
	endpointURL, endpointErr := url.Parse(endpoint)
	if requestErr != nil || endpointErr != nil ||
		requestURL.Scheme != endpointURL.Scheme || requestURL.Host != endpointURL.Host {
		return false
	}
	collectionPath := strings.TrimSuffix(endpointURL.Path, "/")
	if request.Method == "POST" {
		return requestURL.Path == collectionPath && requestURL.RawQuery == ""
	}
	if request.Method != "GET" {
		return false
	}
	itemID := strings.TrimPrefix(requestURL.Path, collectionPath+"/")
	return itemID != requestURL.Path && itemID != "" && !strings.Contains(itemID, "/")
}

func supportedProtocolAlternative(requirements []authRequirement) bool {
	if len(requirements) != 1 {
		return false
	}
	switch requirements[0].ID {
	case oauth2SchemeID:
		switch requirements[0].Kind {
		case "oauth2-dpop", "oauth2", "openid":
			return true
		}
	case agentAssertionSchemeID:
		return requirements[0].Kind == "http-bearer"
	}
	return false
}

func scopesContain(have, need []string) bool {
	available := make(map[string]bool, len(have))
	for _, scope := range have {
		available[scope] = true
	}
	for _, scope := range need {
		if !available[scope] {
			return false
		}
	}
	return true
}

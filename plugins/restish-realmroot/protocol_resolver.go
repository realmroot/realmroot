package main

import (
	"context"

	"github.com/rest-sh/restish/v2/plugin"
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

func resolveProtocolAuthentication(input authResolverInput, client httpDoer) (authResolverOutput, error) {
	if !supportedProtocolAlternative(input.Requirements) {
		return authResolverOutput{}, nil
	}
	return authResolverOutput{
		Handled: protocolAuthenticationSupports(input.Request.URI, input.Requirements, client),
	}, nil
}

func protocolAuthenticationSupports(requestURI string, requirements []authRequirement, client httpDoer) bool {
	origin, err := realmrootOrigin(requestURI)
	if err != nil {
		return false
	}
	configuration, err := discoverAgentConfiguration(context.Background(), client, origin)
	return err == nil && scopesContain(configuration.AgentBootstrapScopes, requirements[0].Needs)
}

func supportedProtocolAlternative(requirements []authRequirement) bool {
	if len(requirements) != 1 {
		return false
	}
	switch requirements[0].Kind {
	case "http-dpop", "oauth2-dpop", "oauth2", "openid":
		return true
	default:
		return false
	}
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

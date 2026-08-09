package main

import "testing"

func TestSupportedProtocolAlternativeOnlyAcceptsAgentAuth(t *testing.T) {
	tests := []struct {
		name         string
		requirements []authRequirement
		want         bool
	}{
		{
			name:         "Agent protocol scheme",
			requirements: []authRequirement{{ID: "agentAuth", Kind: "http-dpop", Needs: []string{"agent:read"}}},
			want:         true,
		},
		{
			name:         "Resource OAuth scheme with an Agent bootstrap scope",
			requirements: []authRequirement{{ID: "oauth2", Kind: "oauth2-dpop", Needs: []string{"resource-servers:read"}}},
			want:         false,
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

package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/rest-sh/restish/v2/plugin"
)

func handleCapabilityApprovalResponse(
	input plugin.ResponseMiddlewareInput,
	opener browserOpener,
	states capabilityStateFinder,
	client httpDoer,
) (plugin.ResponseMiddlewareOutput, error) {
	if input.Response.Status < 200 || input.Response.Status >= 300 {
		return plugin.ResponseMiddlewareOutput{}, nil
	}
	requestURL, err := url.Parse(input.Request.URI)
	if err != nil ||
		input.Request.Method != http.MethodPost ||
		requestURL.Path != "/api/capability-requests" {
		return plugin.ResponseMiddlewareOutput{}, nil
	}
	body, ok := input.Response.Body.(map[string]any)
	if !ok || body["status"] != "pending" {
		return plugin.ResponseMiddlewareOutput{}, nil
	}
	agentID, ok := body["agent_id"].(string)
	if !ok || agentID == "" {
		return plugin.ResponseMiddlewareOutput{}, errors.New("capability response is missing agent_id")
	}
	capabilities, err := requestedCapabilities(body)
	if err != nil {
		return plugin.ResponseMiddlewareOutput{}, err
	}
	approval, ok := body["approval"].(map[string]any)
	if !ok {
		return plugin.ResponseMiddlewareOutput{}, errors.New("pending capability response is missing approval")
	}
	verificationURI, ok := approval["verification_uri_complete"].(string)
	if !ok || verificationURI == "" {
		return plugin.ResponseMiddlewareOutput{}, errors.New("pending capability response is missing approval URL")
	}
	approvalURL, err := url.Parse(verificationURI)
	if err != nil ||
		approvalURL.Scheme != requestURL.Scheme ||
		approvalURL.Host != requestURL.Host ||
		approvalURL.Path != "/agent/approve" {
		return plugin.ResponseMiddlewareOutput{}, errors.New("capability approval URL must use the FlareAuth origin")
	}
	if err := opener.Open(verificationURI); err != nil {
		return plugin.ResponseMiddlewareOutput{}, fmt.Errorf("open capability approval: %w", err)
	}

	state, err := states.FindByOriginAndAgentID(requestURL.Scheme+"://"+requestURL.Host, agentID)
	if err != nil {
		return plugin.ResponseMiddlewareOutput{}, err
	}
	expiresIn, interval, err := approvalTiming(approval)
	if err != nil {
		return plugin.ResponseMiddlewareOutput{}, err
	}
	status, err := waitForCapabilityDecision(
		context.Background(),
		client,
		state,
		capabilities,
		time.Now().Add(expiresIn),
		interval,
	)
	if err != nil {
		return plugin.ResponseMiddlewareOutput{}, err
	}
	return plugin.ResponseMiddlewareOutput{
		Response: &plugin.HookResponseUpdate{Body: map[string]any{
			"agent_id":                agentID,
			"status":                  "active",
			"agent_capability_grants": status.AgentCapabilityGrants,
		}},
	}, nil
}

func waitForCapabilityDecision(
	ctx context.Context,
	client httpDoer,
	state agentState,
	capabilities []string,
	expiresAt time.Time,
	interval time.Duration,
) (agentStatusResponse, error) {
	for time.Now().Before(expiresAt) {
		var status agentStatusResponse
		if err := requestJSON(
			ctx,
			client,
			http.MethodGet,
			state.Origin+"/api/auth/agent/status",
			mustAgentJWT(state),
			nil,
			&status,
		); err != nil {
			return agentStatusResponse{}, err
		}
		resolved := capabilityStatuses(status.AgentCapabilityGrants, capabilities)
		if resolved == "active" {
			return status, nil
		}
		if resolved == "denied" {
			return agentStatusResponse{}, errors.New("controller denied the requested Agent capabilities")
		}
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return agentStatusResponse{}, ctx.Err()
		case <-timer.C:
		}
	}
	return agentStatusResponse{}, errors.New("controller capability approval expired; invoke the request again")
}

func requestedCapabilities(body map[string]any) ([]string, error) {
	raw, ok := body["agent_capability_grants"].([]any)
	if !ok || len(raw) == 0 {
		return nil, errors.New("capability response is missing requested grants")
	}
	capabilities := make([]string, 0, len(raw))
	for _, item := range raw {
		grant, ok := item.(map[string]any)
		if !ok {
			return nil, errors.New("capability response contains an invalid grant")
		}
		capability, ok := grant["capability"].(string)
		if !ok || capability == "" {
			return nil, errors.New("capability response contains an unnamed grant")
		}
		capabilities = append(capabilities, capability)
	}
	return capabilities, nil
}

func approvalTiming(approval map[string]any) (time.Duration, time.Duration, error) {
	expiresSeconds, ok := numberValue(approval["expires_in"])
	if !ok || expiresSeconds <= 0 {
		return 0, 0, errors.New("capability approval is missing a valid expiry")
	}
	intervalSeconds, ok := numberValue(approval["interval"])
	if !ok || intervalSeconds <= 0 {
		return 0, 0, errors.New("capability approval is missing a valid polling interval")
	}
	return time.Duration(expiresSeconds) * time.Second, time.Duration(intervalSeconds) * time.Second, nil
}

func capabilityStatuses(grants []capabilityGrantSummary, requested []string) string {
	statuses := make(map[string]string, len(grants))
	for _, grant := range grants {
		statuses[grant.Capability] = grant.Status
	}
	allActive := true
	for _, capability := range requested {
		switch statuses[capability] {
		case "active":
		case "denied", "rejected", "revoked", "expired":
			return "denied"
		default:
			allActive = false
		}
	}
	if allActive {
		return "active"
	}
	return "pending"
}

func numberValue(value any) (int64, bool) {
	switch number := value.(type) {
	case int:
		return int64(number), true
	case uint64:
		return int64(number), true
	case int64:
		return number, true
	case float64:
		return int64(number), true
	default:
		return 0, false
	}
}

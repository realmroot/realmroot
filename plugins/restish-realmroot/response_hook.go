package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/rest-sh/restish/v2/plugin"
)

func handleCapabilityApprovalResponse(
	input plugin.ResponseMiddlewareInput,
	opener browserOpener,
	states capabilityStateFinder,
	client httpDoer,
) (plugin.ResponseMiddlewareOutput, error) {
	if input.Response.Status == http.StatusUnauthorized {
		removed, err := removeRejectedTargetCredential(input.Request.URI, states)
		if err != nil {
			return plugin.ResponseMiddlewareOutput{}, err
		}
		if removed {
			return plugin.ResponseMiddlewareOutput{}, errors.New(
				"target API rejected the cached Agent credential; the credential was removed, so discover current access and issue a new target token before retrying",
			)
		}
	}
	if input.Response.Status < 200 || input.Response.Status >= 300 {
		return plugin.ResponseMiddlewareOutput{}, nil
	}
	requestURL, err := url.Parse(input.Request.URI)
	if err != nil {
		return plugin.ResponseMiddlewareOutput{}, nil
	}
	if body, ok := input.Response.Body.(map[string]any); ok && body["accessToken"] != nil {
		if _, recognized := targetTokenGrantID(input.Request.Method, input.Request.URI); !recognized {
			return plugin.ResponseMiddlewareOutput{}, fmt.Errorf(
				"refusing to expose an unrecognized token response for %s %s",
				input.Request.Method,
				requestURL.EscapedPath(),
			)
		}
	}
	if grantID, ok := targetTokenGrantID(input.Request.Method, input.Request.URI); ok {
		store, ok := states.(targetTokenStore)
		if !ok {
			return plugin.ResponseMiddlewareOutput{}, errors.New("Agent state store cannot persist target API tokens")
		}
		encoded, err := json.Marshal(input.Response.Body)
		if err != nil {
			return plugin.ResponseMiddlewareOutput{}, fmt.Errorf("encode target API token response: %w", err)
		}
		var token targetTokenResponse
		if err := json.Unmarshal(encoded, &token); err != nil {
			return plugin.ResponseMiddlewareOutput{}, fmt.Errorf("decode target API token response: %w", err)
		}
		runtime, err := agentRuntime()
		if err != nil {
			return plugin.ResponseMiddlewareOutput{}, err
		}
		requestOrigin := requestURL.Scheme + "://" + requestURL.Host
		if err := store.StoreTargetToken(requestOrigin, runtime, grantID, token); err != nil {
			return plugin.ResponseMiddlewareOutput{}, err
		}
		// Restish preserves the original wire bytes for its default non-TTY
		// output. Replacing only the decoded body would still expose the token
		// outside explicit structured formatters, so suppress the response after
		// persisting the credential in protected plugin state.
		return plugin.ResponseMiddlewareOutput{Drop: true}, nil
	}
	if resourceID, ok := resourceConnectionRequestResourceID(input.Request.Method, requestURL); ok {
		finder, ok := states.(resourceStateFinder)
		if !ok {
			return plugin.ResponseMiddlewareOutput{}, errors.New("Agent state store cannot resolve resource connections")
		}
		return handleResourceConnectionApproval(input, opener, finder, client, requestURL, resourceID)
	}
	if input.Request.Method == http.MethodPost && requestURL.Path == "/api/agent/access-requests" {
		finder, ok := states.(resourceStateFinder)
		if !ok {
			return plugin.ResponseMiddlewareOutput{}, errors.New("Agent state store cannot resolve resource requests")
		}
		return handleResourceAccessApproval(input, opener, finder, client, requestURL)
	}
	if input.Request.Method != http.MethodPost || requestURL.Path != "/api/agent/capability-requests" {
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
	requestOrigin := requestURL.Scheme + "://" + requestURL.Host
	configuration, err := discoverAgentConfiguration(context.Background(), client, requestOrigin)
	if err != nil {
		return plugin.ResponseMiddlewareOutput{}, err
	}
	issuerURL, err := url.Parse(configuration.Issuer)
	if err != nil {
		return plugin.ResponseMiddlewareOutput{}, errors.New("Agent discovery issuer is invalid")
	}
	approvalURL, err := url.Parse(verificationURI)
	if err != nil ||
		approvalURL.Scheme != issuerURL.Scheme ||
		approvalURL.Host != issuerURL.Host ||
		approvalURL.Path != "/agent/approve" {
		return plugin.ResponseMiddlewareOutput{}, errors.New("capability approval URL must use the discovered issuer origin")
	}
	if err := opener.Open(verificationURI); err != nil {
		return plugin.ResponseMiddlewareOutput{}, fmt.Errorf("open capability approval: %w", err)
	}

	state, err := states.FindByOriginAndAgentID(requestOrigin, agentID)
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
		configuration,
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

func handleResourceConnectionApproval(
	input plugin.ResponseMiddlewareInput,
	opener browserOpener,
	states resourceStateFinder,
	client httpDoer,
	requestURL *url.URL,
	resourceID string,
) (plugin.ResponseMiddlewareOutput, error) {
	body, ok := input.Response.Body.(map[string]any)
	if !ok || body["status"] != "pending" {
		return plugin.ResponseMiddlewareOutput{}, nil
	}
	agentID, _ := body["agentId"].(string)
	approval, _ := body["approval"].(map[string]any)
	verificationURI, _ := approval["url"].(string)
	expiresRaw, _ := body["expiresAt"].(string)
	if agentID == "" || verificationURI == "" || expiresRaw == "" {
		return plugin.ResponseMiddlewareOutput{}, errors.New("pending resource connection is missing approval data")
	}
	expiresAt, err := time.Parse(time.RFC3339, expiresRaw)
	if err != nil {
		return plugin.ResponseMiddlewareOutput{}, errors.New("resource connection approval expiry is invalid")
	}
	requestOrigin := requestURL.Scheme + "://" + requestURL.Host
	configuration, err := discoverAgentConfiguration(context.Background(), client, requestOrigin)
	if err != nil {
		return plugin.ResponseMiddlewareOutput{}, err
	}
	approvalURL, err := url.Parse(verificationURI)
	if err != nil || !sameOrigin(verificationURI, requestOrigin) || approvalURL.Path != "/agent/resource-connection/approve" {
		return plugin.ResponseMiddlewareOutput{}, errors.New("resource connection approval URL must use the discovered issuer origin")
	}
	state, err := states.FindByOriginAndIdentityID(requestOrigin, agentID)
	if err != nil {
		return plugin.ResponseMiddlewareOutput{}, err
	}
	statusURL := requestOrigin + "/api/agent/api-resources/" + url.PathEscape(resourceID) +
		"/authorization-detail-catalog?limit=1&offset=0"
	type connectionStatus struct {
		AccountConnectionID        string `json:"accountConnectionId"`
		AccountConnectionUpdatedAt string `json:"accountConnectionUpdatedAt"`
		ConnectionRequired         bool   `json:"connectionRequired"`
	}
	readStatus := func() (connectionStatus, error) {
		var status connectionStatus
		err := requestJSON(
			context.Background(),
			client,
			http.MethodGet,
			statusURL,
			mustAgentJWT(state, configuration.Issuer),
			nil,
			&status,
		)
		return status, err
	}
	baseline, err := readStatus()
	if err != nil {
		return plugin.ResponseMiddlewareOutput{}, err
	}
	if err := opener.Open(verificationURI); err != nil {
		return plugin.ResponseMiddlewareOutput{}, fmt.Errorf("open resource connection approval: %w", err)
	}
	for time.Now().Before(expiresAt) {
		status, err := readStatus()
		if err != nil {
			return plugin.ResponseMiddlewareOutput{}, err
		}
		connectionChanged := status.AccountConnectionID != baseline.AccountConnectionID ||
			status.AccountConnectionUpdatedAt != baseline.AccountConnectionUpdatedAt
		if !status.ConnectionRequired && status.AccountConnectionID != "" && connectionChanged {
			resolved := make(map[string]any, len(body))
			for key, value := range body {
				resolved[key] = value
			}
			resolved["status"] = "connected"
			resolved["accountConnectionId"] = status.AccountConnectionID
			resolved["approval"] = nil
			return plugin.ResponseMiddlewareOutput{Response: &plugin.HookResponseUpdate{Body: resolved}}, nil
		}
		timer := time.NewTimer(2 * time.Second)
		<-timer.C
	}
	return plugin.ResponseMiddlewareOutput{}, errors.New("controller resource connection approval expired; invoke the request again")
}

func resourceConnectionRequestResourceID(method string, requestURL *url.URL) (string, bool) {
	if method != http.MethodPost {
		return "", false
	}
	const prefix = "/api/agent/api-resources/"
	const suffix = "/connections"
	path := requestURL.EscapedPath()
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	encoded := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	if encoded == "" || strings.Contains(encoded, "/") {
		return "", false
	}
	resourceID, err := url.PathUnescape(encoded)
	return resourceID, err == nil && resourceID != ""
}

func removeRejectedTargetCredential(requestURI string, states capabilityStateFinder) (bool, error) {
	credentials, ok := states.(resourceCredentialStore)
	if !ok {
		return false, nil
	}
	runtime, err := agentRuntime()
	if err != nil {
		return false, err
	}
	reference, err := credentials.FindByResourceURL(requestURI, runtime)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err := credentials.DeleteCredential(reference); err != nil {
		return false, fmt.Errorf("remove target credential rejected by resource server: %w", err)
	}
	return true, nil
}

func handleResourceAccessApproval(
	input plugin.ResponseMiddlewareInput,
	opener browserOpener,
	states resourceStateFinder,
	client httpDoer,
	requestURL *url.URL,
) (plugin.ResponseMiddlewareOutput, error) {
	body, ok := input.Response.Body.(map[string]any)
	if !ok || body["status"] != "pending" {
		return plugin.ResponseMiddlewareOutput{}, nil
	}
	requestID, _ := body["id"].(string)
	agentID, _ := body["agentId"].(string)
	approval, _ := body["approval"].(map[string]any)
	verificationURI, _ := approval["url"].(string)
	expiresRaw, _ := body["expiresAt"].(string)
	if requestID == "" || agentID == "" || verificationURI == "" || expiresRaw == "" {
		return plugin.ResponseMiddlewareOutput{}, errors.New("pending resource request is missing approval data")
	}
	expiresAt, err := time.Parse(time.RFC3339, expiresRaw)
	if err != nil {
		return plugin.ResponseMiddlewareOutput{}, errors.New("resource approval expiry is invalid")
	}
	requestOrigin := requestURL.Scheme + "://" + requestURL.Host
	configuration, err := discoverAgentConfiguration(context.Background(), client, requestOrigin)
	if err != nil {
		return plugin.ResponseMiddlewareOutput{}, err
	}
	approvalURL, err := url.Parse(verificationURI)
	if err != nil || !sameOrigin(verificationURI, requestOrigin) || approvalURL.Path != "/agent/resource-access/approve" {
		return plugin.ResponseMiddlewareOutput{}, errors.New("resource approval URL must use the discovered issuer origin")
	}
	if err := opener.Open(verificationURI); err != nil {
		return plugin.ResponseMiddlewareOutput{}, fmt.Errorf("open resource approval: %w", err)
	}
	state, err := states.FindByOriginAndIdentityID(requestOrigin, agentID)
	if err != nil {
		return plugin.ResponseMiddlewareOutput{}, err
	}
	for time.Now().Before(expiresAt) {
		var resolved map[string]any
		if err := requestJSON(
			context.Background(),
			client,
			http.MethodGet,
			requestOrigin+"/api/agent/access-requests/"+url.PathEscape(requestID),
			mustAgentJWT(state, configuration.Issuer),
			nil,
			&resolved,
		); err != nil {
			return plugin.ResponseMiddlewareOutput{}, err
		}
		status, _ := resolved["status"].(string)
		switch status {
		case "approved", "consumed":
			return plugin.ResponseMiddlewareOutput{Response: &plugin.HookResponseUpdate{Body: resolved}}, nil
		case "denied", "expired":
			return plugin.ResponseMiddlewareOutput{}, fmt.Errorf("controller %s the Agent resource request", status)
		}
		timer := time.NewTimer(2 * time.Second)
		<-timer.C
	}
	return plugin.ResponseMiddlewareOutput{}, errors.New("controller resource approval expired; invoke the request again")
}

func waitForCapabilityDecision(
	ctx context.Context,
	client httpDoer,
	state agentState,
	configuration agentConfiguration,
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
			configuration.Endpoints["status"],
			mustAgentJWT(state, configuration.Issuer),
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

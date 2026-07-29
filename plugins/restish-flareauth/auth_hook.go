package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/rest-sh/restish/v2/plugin"
)

const authProvider = "flareauth-agent"

type registrationResponse struct {
	AgentID  string `json:"agent_id"`
	HostID   string `json:"host_id"`
	Approval struct {
		VerificationURIComplete string `json:"verification_uri_complete"`
		ExpiresIn               int    `json:"expires_in"`
		Interval                int    `json:"interval"`
	} `json:"approval"`
}

type agentStatusResponse struct {
	Status                string                   `json:"status"`
	AgentCapabilityGrants []capabilityGrantSummary `json:"agent_capability_grants"`
}

type capabilityGrantSummary struct {
	Capability string `json:"capability"`
	Status     string `json:"status"`
}

type identityResponse struct {
	Agent stableIdentity `json:"agent"`
}

type agentConfiguration struct {
	Version                 string            `json:"version"`
	Issuer                  string            `json:"issuer"`
	Algorithms              []string          `json:"algorithms"`
	AgentIdentityIssuer     string            `json:"agent_identity_issuer"`
	AgentEnrollmentEndpoint string            `json:"agent_enrollment_endpoint"`
	AgentEndpoint           string            `json:"agent_endpoint"`
	Endpoints               map[string]string `json:"endpoints"`
}

type httpDoer interface {
	Do(*http.Request) (*http.Response, error)
}

type approvalPrompt interface {
	Show(string) error
}

type systemPromptWriter struct{}

func authenticateRequest(
	input plugin.AuthHookInput,
	states stateStore,
	client httpDoer,
	prompt approvalPrompt,
) (plugin.AuthHookOutput, error) {
	if input.Params["provider"] != authProvider {
		return plugin.AuthHookOutput{}, nil
	}
	origin, err := flareAuthOrigin(input.Request.URI)
	if err != nil {
		return plugin.AuthHookOutput{}, err
	}
	configuration, err := discoverAgentConfiguration(context.Background(), client, origin)
	if err != nil {
		return plugin.AuthHookOutput{}, err
	}
	target := agentTarget{API: input.API, Profile: input.Profile, Name: "default", Origin: origin}
	state, err := ensureAgentIdentity(context.Background(), states, client, prompt, target, configuration)
	if err != nil {
		return plugin.AuthHookOutput{}, err
	}
	token, err := signAgentJWT(state, configuration.Issuer, time.Now())
	if err != nil {
		return plugin.AuthHookOutput{}, err
	}
	return plugin.AuthHookOutput{
		Request: &plugin.HookRequestHeaderUpdate{
			Headers: map[string]any{"Authorization": "Bearer " + token},
		},
	}, nil
}

func ensureAgentIdentity(
	ctx context.Context,
	states stateStore,
	client httpDoer,
	prompt approvalPrompt,
	target agentTarget,
	configuration agentConfiguration,
) (agentState, error) {
	state, err := states.Load(target)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return agentState{}, err
		}
		state, err = registerAgent(ctx, states, client, target, agentDisplayName(), false, configuration)
		if err != nil {
			return agentState{}, err
		}
	}
	if state.Identity != nil {
		return state, nil
	}
	if state.RegistrationApproval == nil ||
		state.RegistrationApproval.ExpiresAt == nil ||
		!time.Now().Before(*state.RegistrationApproval.ExpiresAt) {
		state, err = registerAgent(ctx, states, client, target, state.Name, true, configuration)
		if err != nil {
			return agentState{}, err
		}
	}
	if err := prompt.Show(state.RegistrationApproval.VerificationURIComplete); err != nil {
		return agentState{}, err
	}
	if err := waitForAgentApproval(ctx, client, state, configuration); err != nil {
		return agentState{}, err
	}

	var identity identityResponse
	if err := requestJSON(
		ctx,
		client,
		http.MethodPost,
		configuration.AgentEnrollmentEndpoint,
		mustAgentJWT(state, configuration.Issuer),
		map[string]any{"name": state.Name},
		&identity,
	); err != nil {
		return agentState{}, err
	}
	if identity.Agent.ID == "" || identity.Agent.Issuer != configuration.AgentIdentityIssuer || identity.Agent.Subject == "" {
		return agentState{}, errors.New("Agent identity response is missing issuer or subject")
	}
	state.Identity = &identity.Agent
	state.RegistrationApproval = nil
	if err := states.Update(target, state); err != nil {
		return agentState{}, err
	}
	return state, nil
}

func discoverAgentConfiguration(
	ctx context.Context,
	client httpDoer,
	origin string,
) (agentConfiguration, error) {
	var configuration agentConfiguration
	if err := requestJSON(
		ctx,
		client,
		http.MethodGet,
		origin+"/.well-known/agent-configuration",
		"",
		nil,
		&configuration,
	); err != nil {
		return agentConfiguration{}, fmt.Errorf("discover FlareAuth Agent support: %w", err)
	}
	if configuration.Version != "1.0-draft" ||
		configuration.AgentIdentityIssuer == "" ||
		configuration.AgentIdentityIssuer != configuration.Issuer ||
		!contains(configuration.Algorithms, "Ed25519") {
		return agentConfiguration{}, errors.New("Agent discovery has an incompatible issuer, version, or signing algorithm")
	}
	issuer, err := url.Parse(configuration.Issuer)
	if err != nil || issuer.Scheme == "" || issuer.Host == "" {
		return agentConfiguration{}, errors.New("Agent discovery issuer is invalid")
	}
	issuerOrigin := issuer.Scheme + "://" + issuer.Host
	for _, endpoint := range []string{
		configuration.Issuer,
		configuration.AgentEnrollmentEndpoint,
		configuration.AgentEndpoint,
		configuration.Endpoints["register"],
		configuration.Endpoints["status"],
	} {
		if !sameOrigin(endpoint, issuerOrigin) {
			return agentConfiguration{}, errors.New("Agent discovery endpoints must use the discovered issuer origin")
		}
	}
	return configuration, nil
}

func sameOrigin(value string, origin string) bool {
	endpoint, err := url.Parse(value)
	if err != nil || endpoint.Scheme == "" || endpoint.Host == "" {
		return false
	}
	return endpoint.Scheme+"://"+endpoint.Host == origin
}

func contains(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func registerAgent(
	ctx context.Context,
	states stateStore,
	client httpDoer,
	target agentTarget,
	name string,
	replace bool,
	configuration agentConfiguration,
) (agentState, error) {
	hostPublicKey, hostPrivateKey, hostKeyID, err := newSigningKey("host")
	if err != nil {
		return agentState{}, err
	}
	agentPublicKey, agentPrivateKey, agentKeyID, err := newSigningKey("agent")
	if err != nil {
		return agentState{}, err
	}
	registrationJWT, err := signRegistrationJWT(
		configuration.Issuer,
		hostPrivateKey,
		hostKeyID,
		hostPublicKey,
		agentKeyID,
		agentPublicKey,
		name+" Host",
		time.Now(),
	)
	if err != nil {
		return agentState{}, err
	}
	var registration registrationResponse
	if err := requestJSON(
		ctx,
		client,
		http.MethodPost,
		configuration.Endpoints["register"],
		registrationJWT,
		map[string]any{
			"name":             name,
			"host_name":        name + " Host",
			"mode":             "delegated",
			"capabilities":     []string{},
			"preferred_method": "device_authorization",
			"force_approval":   true,
		},
		&registration,
	); err != nil {
		return agentState{}, err
	}
	if registration.AgentID == "" || registration.HostID == "" {
		return agentState{}, errors.New("Agent registration response is missing agent_id or host_id")
	}
	if registration.Approval.VerificationURIComplete == "" {
		return agentState{}, errors.New("Agent registration response is missing the controller approval URL")
	}
	interval := registration.Approval.Interval
	if interval <= 0 {
		interval = 5
	}
	expiresAt := time.Now().Add(10 * time.Minute)
	if registration.Approval.ExpiresIn > 0 {
		expiresAt = time.Now().Add(time.Duration(registration.Approval.ExpiresIn) * time.Second)
	}
	state := agentState{
		Version:         1,
		Origin:          target.Origin,
		Name:            name,
		AgentID:         registration.AgentID,
		HostID:          registration.HostID,
		AgentKeyID:      agentKeyID,
		HostKeyID:       hostKeyID,
		AgentPrivateKey: encodePrivateKey(agentPrivateKey),
		HostPrivateKey:  encodePrivateKey(hostPrivateKey),
		RegistrationApproval: &pendingApproval{
			VerificationURIComplete: registration.Approval.VerificationURIComplete,
			ExpiresAt:               &expiresAt,
			IntervalSeconds:         interval,
		},
	}
	if replace {
		err = states.Update(target, state)
	} else {
		_, err = states.Create(target, state)
	}
	return state, err
}

func waitForAgentApproval(
	ctx context.Context,
	client httpDoer,
	state agentState,
	configuration agentConfiguration,
) error {
	interval := time.Duration(state.RegistrationApproval.IntervalSeconds) * time.Second
	if interval <= 0 {
		interval = 5 * time.Second
	}
	for time.Now().Before(*state.RegistrationApproval.ExpiresAt) {
		var status agentStatusResponse
		if err := requestJSON(
			ctx,
			client,
			http.MethodGet,
			configuration.Endpoints["status"]+"?agent_id="+url.QueryEscape(state.AgentID),
			mustHostJWT(state, configuration.Issuer),
			nil,
			&status,
		); err != nil {
			return err
		}
		switch status.Status {
		case "active":
			return nil
		case "pending":
			timer := time.NewTimer(interval)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
		case "rejected", "revoked", "expired":
			return fmt.Errorf("Agent enrollment was %s", status.Status)
		default:
			return fmt.Errorf("Agent enrollment returned unexpected status %q", status.Status)
		}
	}
	return errors.New("controller approval expired; invoke the operation again to restart enrollment")
}

func requestJSON(
	ctx context.Context,
	client httpDoer,
	method string,
	uri string,
	bearer string,
	body any,
	output any,
) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("encode request body: %w", err)
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, uri, reader)
	if err != nil {
		return fmt.Errorf("create FlareAuth request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if bearer != "" {
		request.Header.Set("Authorization", "Bearer "+bearer)
	}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("call FlareAuth: %w", err)
	}
	defer response.Body.Close()
	encoded, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("read FlareAuth response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("FlareAuth returned HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(encoded)))
	}
	if output == nil || len(encoded) == 0 {
		return nil
	}
	if err := json.Unmarshal(encoded, output); err != nil {
		return fmt.Errorf("decode FlareAuth response: %w", err)
	}
	return nil
}

func flareAuthOrigin(requestURI string) (string, error) {
	parsed, err := url.Parse(requestURI)
	if err != nil {
		return "", fmt.Errorf("parse Restish request URI: %w", err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", errors.New("Restish request URI must be absolute")
	}
	if parsed.EscapedPath() != "/api" && !strings.HasPrefix(parsed.EscapedPath(), "/api/") {
		return "", fmt.Errorf("Restish request URI %q is not a FlareAuth API operation", requestURI)
	}
	parsed.Path = ""
	parsed.RawPath = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return strings.TrimSuffix(parsed.String(), "/"), nil
}

func agentDisplayName() string {
	if value := strings.TrimSpace(os.Getenv("FLAREAUTH_AGENT_NAME")); value != "" {
		return value
	}
	host, err := os.Hostname()
	if err != nil || strings.TrimSpace(host) == "" {
		return "Restish Agent"
	}
	return host + " Agent"
}

func mustAgentJWT(state agentState, issuer string) string {
	token, err := signAgentJWT(state, issuer, time.Now())
	if err != nil {
		panic(err)
	}
	return token
}

func mustHostJWT(state agentState, issuer string) string {
	token, err := signHostJWT(state, issuer, time.Now())
	if err != nil {
		panic(err)
	}
	return token
}

func newHTTPClient() *http.Client {
	return &http.Client{Timeout: 30 * time.Second}
}

func (systemPromptWriter) Show(verificationURI string) error {
	message := "Waiting for Agent approval...\n"
	openErr := (systemBrowserOpener{}).Open(verificationURI)
	if openErr != nil {
		message = "Could not open the approval page automatically: " + openErr.Error() + "\n" + message
	}
	terminal, err := os.OpenFile("/dev/tty", os.O_WRONLY, 0)
	if err != nil {
		if os.Getenv("FLAREAUTH_PLUGIN_APPROVAL_FILE") != "" || openErr == nil {
			return nil
		}
		return fmt.Errorf("cannot open or display Agent approval URL: %w", openErr)
	}
	defer terminal.Close()
	_, err = terminal.WriteString(message)
	return err
}

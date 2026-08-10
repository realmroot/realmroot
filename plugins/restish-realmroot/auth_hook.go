package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
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

const (
	authProvider = "realmroot-agent"
)

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
	Status string `json:"status"`
}

type agentSelfStatusResponse struct {
	Agent *stableIdentity `json:"agent"`
}

type targetTokenResponse struct {
	AccessToken          string           `json:"accessToken"`
	TokenType            string           `json:"tokenType"`
	ExpiresAt            time.Time        `json:"expiresAt"`
	Scopes               []string         `json:"scopes"`
	ResourceIndicator    string           `json:"resourceIndicator"`
	AuthorizationDetails []map[string]any `json:"authorizationDetails"`
	DPoPNonce            string           `json:"-"`
}

type agentConfiguration struct {
	Version                 string            `json:"version"`
	Issuer                  string            `json:"issuer"`
	Algorithms              []string          `json:"algorithms"`
	AgentIdentityIssuer     string            `json:"agent_identity_issuer"`
	AgentEnrollmentEndpoint string            `json:"agent_enrollment_endpoint"`
	AgentEndpoint           string            `json:"agent_endpoint"`
	AgentTokenEndpoint      string            `json:"agent_token_endpoint"`
	AgentBootstrapScopes    []string          `json:"agent_bootstrap_scopes_supported"`
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
	runtime, err := agentRuntime()
	if err != nil {
		return plugin.AuthHookOutput{}, err
	}
	switch input.Params["provider"] {
	case authProvider:
	default:
		return plugin.AuthHookOutput{}, nil
	}
	origin, err := realmrootOrigin(input.Request.URI)
	if err != nil {
		return plugin.AuthHookOutput{}, err
	}
	configuration, err := discoverAgentConfiguration(context.Background(), client, origin)
	if err != nil {
		return plugin.AuthHookOutput{}, err
	}
	target := agentTarget{
		API:     input.API,
		Profile: input.Profile,
		Runtime: runtime,
		Origin:  origin,
		Issuer:  configuration.AgentIdentityIssuer,
	}
	state, err := ensureAgentIdentity(context.Background(), states, client, prompt, target, configuration)
	if err != nil {
		return plugin.AuthHookOutput{}, err
	}
	state, credential, err := ensureProtocolCredential(context.Background(), states, client, target, state, configuration)
	if err != nil {
		return plugin.AuthHookOutput{}, err
	}
	proof, err := signDPoPProof(credential.PrivateKey, input.Request.Method, input.Request.URI, credential.AccessToken, time.Now())
	if err != nil {
		return plugin.AuthHookOutput{}, err
	}
	headers := map[string]any{"Authorization": "DPoP " + credential.AccessToken, "DPoP": proof}
	return plugin.AuthHookOutput{
		Request: &plugin.HookRequestHeaderUpdate{
			Headers: headers,
		},
	}, nil
}

func authenticateHookRequest(
	input authHookEnvelope,
	states stateStore,
	client httpDoer,
	prompt approvalPrompt,
) (plugin.AuthHookOutput, error) {
	legacy := plugin.AuthHookInput{
		Type: input.Type, API: input.API, Profile: input.Profile, Params: input.Params, Request: input.Request,
	}
	if len(input.Requirements) > 0 {
		if !supportedProtocolAlternative(input.Requirements) ||
			!protocolAuthenticationSupports(input.Request.URI, input.Requirements, client) {
			return plugin.AuthHookOutput{}, errors.New("Realmroot cannot satisfy the selected operation security alternative")
		}
		legacy.Params = map[string]string{"provider": authProvider}
	}
	return authenticateRequest(legacy, states, client, prompt)
}

func usableProtocolCredential(ctx context.Context, client httpDoer, state agentState) (dpopCredential, error) {
	if state.ProtocolCredential == nil {
		return dpopCredential{}, errors.New("Realmroot Agent protocol OAuth credential is unavailable")
	}
	protocol := *state.ProtocolCredential
	if protocol.AccessToken != "" && protocol.ExpiresAt != nil && time.Now().Add(5*time.Second).Before(*protocol.ExpiresAt) {
		return protocol, nil
	}
	configuration, err := discoverAgentConfiguration(ctx, client, state.Origin)
	if err != nil {
		return dpopCredential{}, err
	}
	return requestProtocolToken(ctx, client, state, protocol, configuration)
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
		state, err = registerAgent(ctx, states, client, target, agentDisplayName(target.Runtime), false, configuration)
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
	host, err := states.LoadHost(target)
	if err != nil {
		return agentState{}, err
	}
	if err := waitForAgentApproval(ctx, client, state, host, configuration); err != nil {
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
		return agentConfiguration{}, fmt.Errorf("discover Realmroot Agent support: %w", err)
	}
	if configuration.Version != "1.0-draft" ||
		configuration.AgentIdentityIssuer == "" ||
		configuration.AgentIdentityIssuer != configuration.Issuer ||
		!contains(configuration.Algorithms, "Ed25519") ||
		!validScopes(configuration.AgentBootstrapScopes) {
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
		configuration.AgentTokenEndpoint,
		configuration.Endpoints["register"],
		configuration.Endpoints["status"],
	} {
		if !sameOrigin(endpoint, issuerOrigin) {
			return agentConfiguration{}, errors.New("Agent discovery endpoints must use the discovered issuer origin")
		}
	}
	return configuration, nil
}

func ensureProtocolCredential(
	ctx context.Context,
	states stateStore,
	client httpDoer,
	target agentTarget,
	state agentState,
	configuration agentConfiguration,
) (agentState, dpopCredential, error) {
	credential := state.ProtocolCredential
	if credential == nil {
		issuerURL, err := validatedAbsoluteURL(configuration.Issuer)
		if err != nil {
			return state, dpopCredential{}, errors.New("Realmroot OAuth issuer is invalid")
		}
		resourceIndicator := issuerURL.Scheme + "://" + issuerURL.Host + "/api"
		privateKey, err := newDPoPPrivateKey()
		if err != nil {
			return state, dpopCredential{}, err
		}
		credential = &dpopCredential{
			ResourceIndicator:  resourceIndicator,
			CredentialEndpoint: configuration.AgentTokenEndpoint,
			ProofTarget:        configuration.AgentTokenEndpoint,
			PrivateKey:         privateKey,
		}
	}
	if credential.AccessToken == "" || credential.ExpiresAt == nil || !time.Now().Add(5*time.Second).Before(*credential.ExpiresAt) {
		updated, err := requestProtocolToken(ctx, client, state, *credential, configuration)
		if err != nil {
			return state, dpopCredential{}, err
		}
		credential = &updated
	}
	state.ProtocolCredential = credential
	if state.Identity == nil {
		proof, err := signDPoPProof(credential.PrivateKey, http.MethodGet, configuration.AgentEndpoint, credential.AccessToken, time.Now())
		if err != nil {
			return state, dpopCredential{}, err
		}
		var status agentSelfStatusResponse
		if err := requestJSONHeaders(ctx, client, http.MethodGet, configuration.AgentEndpoint, map[string]string{
			"Authorization": "DPoP " + credential.AccessToken,
			"DPoP":          proof,
		}, nil, &status); err != nil {
			return state, dpopCredential{}, err
		}
		if status.Agent == nil || status.Agent.ID == "" || status.Agent.Issuer != configuration.AgentIdentityIssuer || status.Agent.Subject == "" {
			return state, dpopCredential{}, errors.New("Agent identity response is missing issuer or subject")
		}
		state.Identity = status.Agent
		state.RegistrationApproval = nil
	}
	if err := states.Update(target, state); err != nil {
		return state, dpopCredential{}, err
	}
	return state, *credential, nil
}

func requestProtocolToken(
	ctx context.Context,
	client httpDoer,
	state agentState,
	credential dpopCredential,
	configuration agentConfiguration,
) (dpopCredential, error) {
	proof, err := signDPoPProof(credential.PrivateKey, http.MethodPost, configuration.AgentTokenEndpoint, "", time.Now())
	if err != nil {
		return credential, err
	}
	var response struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := requestForm(ctx, client, configuration.AgentTokenEndpoint, map[string]string{
		"DPoP": proof,
	}, url.Values{
		"grant_type": {"urn:ietf:params:oauth:grant-type:jwt-bearer"},
		"assertion":  {mustAgentJWT(state, configuration.Issuer)},
		"resource":   {credential.ResourceIndicator},
		"scope":      {strings.Join(configuration.AgentBootstrapScopes, " ")},
	}, &response); err != nil {
		return credential, fmt.Errorf("obtain Realmroot OAuth access token: %w", err)
	}
	if response.TokenType != "DPoP" || response.AccessToken == "" || response.ExpiresIn <= 0 {
		return credential, errors.New("Realmroot returned an invalid OAuth access token")
	}
	credential.AccessToken = response.AccessToken
	expiresAt := time.Now().Add(time.Duration(response.ExpiresIn) * time.Second)
	credential.ExpiresAt = &expiresAt
	return credential, nil
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

func validScopes(scopes []string) bool {
	if len(scopes) == 0 {
		return false
	}
	seen := make(map[string]struct{}, len(scopes))
	for _, scope := range scopes {
		if len(strings.Fields(scope)) != 1 || strings.TrimSpace(scope) != scope {
			return false
		}
		if _, exists := seen[scope]; exists {
			return false
		}
		seen[scope] = struct{}{}
	}
	return true
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
	hostName, err := hostDisplayName()
	if err != nil {
		return agentState{}, err
	}
	sharedHost, err := states.LoadHost(target)
	newHost := errors.Is(err, os.ErrNotExist)
	if err != nil && !newHost {
		return agentState{}, err
	}
	var hostPublicKey ed25519.PublicKey
	var hostPrivateKey ed25519.PrivateKey
	if newHost {
		hostPublicKey, hostPrivateKey, sharedHost.HostKeyID, err = newSigningKey("host")
		if err != nil {
			return agentState{}, err
		}
	} else {
		hostPrivateKey, err = decodePrivateKey(sharedHost.HostPrivateKey)
		if err != nil {
			return agentState{}, err
		}
		hostPublicKey = hostPrivateKey.Public().(ed25519.PublicKey)
	}
	agentPublicKey, agentPrivateKey, agentKeyID, err := newSigningKey("agent")
	if err != nil {
		return agentState{}, err
	}
	registrationJWT, err := signRegistrationJWT(
		configuration.Issuer,
		sharedHost.HostID,
		hostPrivateKey,
		sharedHost.HostKeyID,
		hostPublicKey,
		agentKeyID,
		agentPublicKey,
		hostName,
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
			"host_name":        hostName,
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
	if !newHost && registration.HostID != sharedHost.HostID {
		return agentState{}, errors.New("Agent registration response changed the shared Host")
	}
	if newHost {
		sharedHost = hostState{
			Version: hostStateVersion, Issuer: target.Issuer, HostID: registration.HostID,
			HostKeyID: sharedHost.HostKeyID, HostPrivateKey: encodePrivateKey(hostPrivateKey),
		}
		if _, err := states.CreateHost(target, sharedHost); err != nil {
			return agentState{}, err
		}
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
		Version:         agentStateVersion,
		Origin:          target.Origin,
		Issuer:          target.Issuer,
		Runtime:         target.Runtime,
		Name:            name,
		AgentID:         registration.AgentID,
		HostID:          registration.HostID,
		AgentKeyID:      agentKeyID,
		AgentPrivateKey: encodePrivateKey(agentPrivateKey),
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
	host hostState,
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
			mustHostJWT(host, configuration.Issuer),
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
	headers := make(map[string]string)
	if bearer != "" {
		headers["Authorization"] = "Bearer " + bearer
	}
	return requestJSONHeaders(ctx, client, method, uri, headers, body, output)
}

func requestJSONHeaders(
	ctx context.Context,
	client httpDoer,
	method string,
	uri string,
	headers map[string]string,
	body any,
	output any,
) error {
	_, err := requestJSONHeadersResponse(ctx, client, method, uri, headers, body, output)
	return err
}

func requestJSONHeadersResponse(
	ctx context.Context,
	client httpDoer,
	method string,
	uri string,
	headers map[string]string,
	body any,
	output any,
) (http.Header, error) {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("encode request body: %w", err)
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, uri, reader)
	if err != nil {
		return nil, fmt.Errorf("create Realmroot request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("call Realmroot: %w", err)
	}
	defer response.Body.Close()
	encoded, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("read Realmroot response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, &httpResponseError{
			StatusCode: response.StatusCode,
			Header:     response.Header.Clone(),
			Body:       strings.TrimSpace(string(encoded)),
		}
	}
	if output == nil || len(encoded) == 0 {
		return response.Header.Clone(), nil
	}
	if err := json.Unmarshal(encoded, output); err != nil {
		return nil, fmt.Errorf("decode Realmroot response: %w", err)
	}
	return response.Header.Clone(), nil
}

func requestForm(
	ctx context.Context,
	client httpDoer,
	uri string,
	headers map[string]string,
	form url.Values,
	output any,
) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, uri, strings.NewReader(form.Encode()))
	if err != nil {
		return fmt.Errorf("create Realmroot OAuth request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("call Realmroot OAuth endpoint: %w", err)
	}
	defer response.Body.Close()
	encoded, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("read Realmroot OAuth response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return &httpResponseError{StatusCode: response.StatusCode, Body: strings.TrimSpace(string(encoded))}
	}
	if err := json.Unmarshal(encoded, output); err != nil {
		return fmt.Errorf("decode Realmroot OAuth response: %w", err)
	}
	return nil
}

type httpResponseError struct {
	StatusCode int
	Header     http.Header
	Body       string
}

func (e *httpResponseError) Error() string {
	return fmt.Sprintf("Realmroot returned HTTP %d: %s", e.StatusCode, e.Body)
}

func realmrootOrigin(requestURI string) (string, error) {
	parsed, err := url.Parse(requestURI)
	if err != nil {
		return "", fmt.Errorf("parse Restish request URI: %w", err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", errors.New("Restish request URI must be absolute")
	}
	if parsed.EscapedPath() != "/api" && !strings.HasPrefix(parsed.EscapedPath(), "/api/") {
		return "", fmt.Errorf("Restish request URI %q is not a Realmroot API operation", requestURI)
	}
	parsed.Path = ""
	parsed.RawPath = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return strings.TrimSuffix(parsed.String(), "/"), nil
}

func mustAgentJWT(state agentState, issuer string) string {
	token, err := signAgentJWT(state, issuer, time.Now())
	if err != nil {
		panic(err)
	}
	return token
}

func mustHostJWT(state hostState, issuer string) string {
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
		if os.Getenv("REALMROOT_PLUGIN_APPROVAL_FILE") != "" || openErr == nil {
			return nil
		}
		return fmt.Errorf("cannot open or display Agent approval URL: %w", openErr)
	}
	defer terminal.Close()
	_, err = terminal.WriteString(message)
	return err
}

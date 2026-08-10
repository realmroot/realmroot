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
	authProvider               = "realmroot-agent"
	agentConfigurationCacheTTL = 5 * time.Minute
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
	requiredScopes []string,
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
	configuration, err := resolveAgentConfiguration(context.Background(), client, configurationCache(states), origin)
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
	state, err := loadAgentRegistration(states, target)
	if err != nil {
		return plugin.AuthHookOutput{}, err
	}
	if state.Identity == nil {
		return plugin.AuthHookOutput{}, errors.New("Realmroot Agent enrollment is incomplete; rerun `restish realmroot agent enroll`")
	}
	state, credential, err := ensureProtocolCredential(
		context.Background(), states, client, target, state, configuration, requiredScopes,
	)
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
			!protocolAuthenticationSupports(input.Request, input.Requirements, configurationCache(states), client) {
			return plugin.AuthHookOutput{}, errors.New("Realmroot cannot satisfy the selected operation security alternative")
		}
		if input.Requirements[0].ID == agentAssertionSchemeID {
			return authenticateEnrollmentRequest(input, states, client, prompt)
		}
		legacy.Params = map[string]string{"provider": authProvider}
	}
	var requiredScopes []string
	if len(input.Requirements) > 0 {
		requiredScopes = input.Requirements[0].Needs
	}
	return authenticateRequest(legacy, requiredScopes, states, client, prompt)
}

func authenticateEnrollmentRequest(
	input authHookEnvelope,
	states stateStore,
	client httpDoer,
	prompt approvalPrompt,
) (plugin.AuthHookOutput, error) {
	runtime, err := agentRuntime()
	if err != nil {
		return plugin.AuthHookOutput{}, err
	}
	origin, err := realmrootOrigin(input.Request.URI)
	if err != nil {
		return plugin.AuthHookOutput{}, err
	}
	configuration, err := resolveAgentConfiguration(context.Background(), client, configurationCache(states), origin)
	if err != nil {
		return plugin.AuthHookOutput{}, err
	}
	target := agentTarget{
		API: input.API, Profile: input.Profile, Runtime: runtime, Origin: origin, Issuer: configuration.AgentIdentityIssuer,
	}
	var state agentState
	if input.Request.Method == http.MethodPost && input.Request.URI == configuration.AgentEnrollmentEndpoint {
		state, err = ensureApprovedAgentRegistration(context.Background(), states, client, prompt, target, configuration)
	} else {
		state, err = loadAgentRegistration(states, target)
	}
	if err != nil {
		return plugin.AuthHookOutput{}, err
	}
	headers := map[string]any{"Authorization": "Bearer " + mustAgentJWT(state, configuration.Issuer)}
	if input.Request.Method == http.MethodPost && input.Request.URI == configuration.AgentEnrollmentEndpoint {
		headers["Idempotency-Key"] = state.EnrollmentIdempotencyKey
	}
	return plugin.AuthHookOutput{Request: &plugin.HookRequestHeaderUpdate{Headers: headers}}, nil
}

func usableProtocolCredential(
	ctx context.Context,
	client httpDoer,
	cache agentConfigurationCache,
	state agentState,
) (dpopCredential, error) {
	if state.ProtocolCredential == nil {
		return dpopCredential{}, errors.New("Realmroot Agent protocol OAuth credential is unavailable")
	}
	protocol := *state.ProtocolCredential
	if protocol.AccessToken != "" && protocol.ExpiresAt != nil && time.Now().Add(5*time.Second).Before(*protocol.ExpiresAt) {
		return protocol, nil
	}
	if len(protocol.Scopes) == 0 {
		return dpopCredential{}, errors.New("Realmroot Agent protocol OAuth credential has no reusable scopes")
	}
	configuration, err := resolveAgentConfiguration(ctx, client, cache, state.Origin)
	if err != nil {
		return dpopCredential{}, err
	}
	return requestProtocolToken(ctx, client, state, protocol, configuration, protocol.Scopes)
}

func ensureApprovedAgentRegistration(
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

func loadAgentRegistration(states stateStore, target agentTarget) (agentState, error) {
	state, err := states.Load(target)
	if errors.Is(err, os.ErrNotExist) {
		return agentState{}, errors.New("Realmroot Agent is not enrolled; run `restish realmroot agent enroll`")
	}
	if err != nil {
		return agentState{}, err
	}
	return state, nil
}

func completeAgentEnrollment(
	ctx context.Context,
	states stateStore,
	client httpDoer,
	target agentTarget,
	state agentState,
	configuration agentConfiguration,
) error {
	if state.Identity != nil {
		return nil
	}
	state, credential, err := ensureProtocolCredential(
		ctx, states, client, target, state, configuration, []string{"agent:read"},
	)
	if err != nil {
		return err
	}
	proof, err := signDPoPProof(
		credential.PrivateKey, http.MethodGet, configuration.AgentEndpoint, credential.AccessToken, time.Now(),
	)
	if err != nil {
		return err
	}
	var status agentSelfStatusResponse
	if err := requestJSONHeaders(ctx, client, http.MethodGet, configuration.AgentEndpoint, map[string]string{
		"Authorization": "DPoP " + credential.AccessToken,
		"DPoP":          proof,
	}, nil, &status); err != nil {
		return err
	}
	if status.Agent == nil || status.Agent.ID == "" ||
		status.Agent.Issuer != configuration.AgentIdentityIssuer || status.Agent.Subject == "" {
		return errors.New("Agent identity response is missing issuer or subject")
	}
	state.Identity = status.Agent
	state.RegistrationApproval = nil
	return states.Update(target, state)
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
	if err := validateAgentConfiguration(configuration); err != nil {
		return agentConfiguration{}, err
	}
	return configuration, nil
}

func resolveAgentConfiguration(
	ctx context.Context,
	client httpDoer,
	cache agentConfigurationCache,
	origin string,
) (agentConfiguration, error) {
	if cache != nil {
		cached, err := cache.LoadAgentConfiguration(origin)
		if err == nil && time.Now().Before(cached.ExpiresAt) {
			if err := validateAgentConfiguration(cached.Configuration); err != nil {
				return agentConfiguration{}, fmt.Errorf("validate cached Agent discovery: %w", err)
			}
			return cached.Configuration, nil
		}
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return agentConfiguration{}, fmt.Errorf("load Agent discovery cache: %w", err)
		}
	}
	configuration, err := discoverAgentConfiguration(ctx, client, origin)
	if err != nil {
		return agentConfiguration{}, err
	}
	if cache != nil {
		if err := cache.StoreAgentConfiguration(origin, configuration, time.Now().Add(agentConfigurationCacheTTL)); err != nil {
			return agentConfiguration{}, err
		}
	}
	return configuration, nil
}

func validateAgentConfiguration(configuration agentConfiguration) error {
	if configuration.Version != "1.0-draft" ||
		configuration.AgentIdentityIssuer == "" ||
		configuration.AgentIdentityIssuer != configuration.Issuer ||
		!contains(configuration.Algorithms, "Ed25519") ||
		!validScopes(configuration.AgentBootstrapScopes) {
		return errors.New("Agent discovery has an incompatible issuer, version, or signing algorithm")
	}
	issuer, err := url.Parse(configuration.Issuer)
	if err != nil || issuer.Scheme == "" || issuer.Host == "" {
		return errors.New("Agent discovery issuer is invalid")
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
			return errors.New("Agent discovery endpoints must use the discovered issuer origin")
		}
	}
	return nil
}

func configurationCache(value any) agentConfigurationCache {
	cache, _ := value.(agentConfigurationCache)
	return cache
}

func ensureProtocolCredential(
	ctx context.Context,
	states stateStore,
	client httpDoer,
	target agentTarget,
	state agentState,
	configuration agentConfiguration,
	requiredScopes []string,
) (agentState, dpopCredential, error) {
	if len(requiredScopes) == 0 || !scopesContain(configuration.AgentBootstrapScopes, requiredScopes) {
		return state, dpopCredential{}, errors.New("Realmroot operation requires unsupported Agent bootstrap scopes")
	}
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
	if credential.AccessToken == "" || credential.ExpiresAt == nil ||
		!time.Now().Add(5*time.Second).Before(*credential.ExpiresAt) ||
		!sameStringSet(credential.Scopes, requiredScopes) {
		updated, err := requestProtocolToken(ctx, client, state, *credential, configuration, requiredScopes)
		if err != nil {
			return state, dpopCredential{}, err
		}
		credential = &updated
	}
	state.ProtocolCredential = credential
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
	requiredScopes []string,
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
		"scope":      {strings.Join(requiredScopes, " ")},
	}, &response); err != nil {
		return credential, fmt.Errorf("obtain Realmroot OAuth access token: %w", err)
	}
	if response.TokenType != "DPoP" || response.AccessToken == "" || response.ExpiresIn <= 0 {
		return credential, errors.New("Realmroot returned an invalid OAuth access token")
	}
	credential.AccessToken = response.AccessToken
	expiresAt := time.Now().Add(time.Duration(response.ExpiresIn) * time.Second)
	credential.ExpiresAt = &expiresAt
	credential.Scopes = append([]string(nil), requiredScopes...)
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
	idempotencyKey, err := newEnrollmentIdempotencyKey()
	if err != nil {
		return agentState{}, err
	}
	state := agentState{
		Version:                  agentStateVersion,
		Origin:                   target.Origin,
		Issuer:                   target.Issuer,
		Runtime:                  target.Runtime,
		Name:                     name,
		AgentID:                  registration.AgentID,
		HostID:                   registration.HostID,
		AgentKeyID:               agentKeyID,
		AgentPrivateKey:          encodePrivateKey(agentPrivateKey),
		EnrollmentIdempotencyKey: idempotencyKey,
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
	_, err := requestFormHeadersResponse(ctx, client, uri, headers, form, output)
	return err
}

func requestFormHeadersResponse(
	ctx context.Context,
	client httpDoer,
	uri string,
	headers map[string]string,
	form url.Values,
	output any,
) (http.Header, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, uri, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("create Realmroot OAuth request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("call Realmroot OAuth endpoint: %w", err)
	}
	defer response.Body.Close()
	encoded, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("read Realmroot OAuth response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, &httpResponseError{
			StatusCode: response.StatusCode,
			Header:     response.Header.Clone(),
			Body:       strings.TrimSpace(string(encoded)),
		}
	}
	if err := json.Unmarshal(encoded, output); err != nil {
		return nil, fmt.Errorf("decode Realmroot OAuth response: %w", err)
	}
	return response.Header.Clone(), nil
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

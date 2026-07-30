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

const authProvider = "realmroot-agent"

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

type agentAPIResourcesResponse struct {
	Items []struct {
		ID                string `json:"id"`
		ResourceURL       string `json:"resourceUrl"`
		AuthorizationMode string `json:"authorizationMode"`
		AccessGrants      []struct {
			ID     string `json:"id"`
			Mode   string `json:"mode"`
			Status string `json:"status"`
		} `json:"accessGrants"`
	} `json:"items"`
}

type targetTokenResponse struct {
	AccessToken string    `json:"accessToken"`
	TokenType   string    `json:"tokenType"`
	ExpiresAt   time.Time `json:"expiresAt"`
	ResourceURL string    `json:"resourceUrl"`
}

type protectedResourceMetadata struct {
	Resource             string   `json:"resource"`
	AuthorizationServers []string `json:"authorization_servers"`
}

type authorizationServerMetadata struct {
	Issuer         string   `json:"issuer"`
	TokenEndpoint  string   `json:"token_endpoint"`
	DPoPAlgorithms []string `json:"dpop_signing_alg_values_supported"`
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
	runtime, err := agentRuntime()
	if err != nil {
		return plugin.AuthHookOutput{}, err
	}
	if input.Params["provider"] != authProvider {
		credentials, ok := states.(resourceCredentialStore)
		if !ok {
			return plugin.AuthHookOutput{}, nil
		}
		return authenticateTargetRequest(input, credentials, client, runtime)
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
	token, err := signAgentJWT(state, configuration.Issuer, time.Now())
	if err != nil {
		return plugin.AuthHookOutput{}, err
	}
	headers := map[string]any{"Authorization": "Bearer " + token}
	if grantID, ok := targetTokenGrantID(input.Request.Method, input.Request.URI); ok {
		credential, updatedState, err := ensureDPoPCredential(
			context.Background(),
			states,
			client,
			target,
			state,
			configuration,
			grantID,
		)
		if err != nil {
			return plugin.AuthHookOutput{}, err
		}
		state = updatedState
		proofTarget, err := dpopTokenTarget(context.Background(), client, state.Origin, grantID, credential)
		if err != nil {
			return plugin.AuthHookOutput{}, err
		}
		proof, err := signDPoPProof(credential.PrivateKey, http.MethodPost, proofTarget, "", time.Now())
		if err != nil {
			return plugin.AuthHookOutput{}, err
		}
		headers["DPoP"] = proof
	}
	return plugin.AuthHookOutput{
		Request: &plugin.HookRequestHeaderUpdate{
			Headers: headers,
		},
	}, nil
}

func authenticateTargetRequest(
	input plugin.AuthHookInput,
	states resourceCredentialStore,
	client httpDoer,
	runtime string,
) (plugin.AuthHookOutput, error) {
	reference, err := states.FindByResourceURL(input.Request.URI, runtime)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return plugin.AuthHookOutput{}, nil
		}
		return plugin.AuthHookOutput{}, err
	}
	credential := reference.credential
	if credential.GrantMode == "once" &&
		credential.ExpiresAt != nil &&
		!time.Now().Add(5*time.Second).Before(*credential.ExpiresAt) {
		if err := states.DeleteCredential(reference); err != nil {
			return plugin.AuthHookOutput{}, fmt.Errorf("remove expired one-time target credential: %w", err)
		}
		return plugin.AuthHookOutput{}, errors.New("one-time target API access expired; request and approve a new access grant")
	}
	if credential.AccessToken == "" || credential.ExpiresAt == nil || !time.Now().Add(5*time.Second).Before(*credential.ExpiresAt) {
		credential, err = refreshTargetToken(context.Background(), client, reference.state, credential)
		if err != nil {
			var responseError *httpResponseError
			if errors.As(err, &responseError) && responseError.StatusCode == http.StatusForbidden {
				if deleteErr := states.DeleteCredential(reference); deleteErr != nil {
					return plugin.AuthHookOutput{}, fmt.Errorf("remove inactive target credential: %w", deleteErr)
				}
				return plugin.AuthHookOutput{}, errors.New(
					"target API access grant is no longer active; request and approve a new access grant",
				)
			}
			return plugin.AuthHookOutput{}, err
		}
		if err := states.UpdateCredential(reference, credential); err != nil {
			return plugin.AuthHookOutput{}, err
		}
	}
	proof, err := signDPoPProof(
		credential.PrivateKey,
		input.Request.Method,
		input.Request.URI,
		credential.AccessToken,
		time.Now(),
	)
	if err != nil {
		return plugin.AuthHookOutput{}, err
	}
	return plugin.AuthHookOutput{Request: &plugin.HookRequestHeaderUpdate{Headers: map[string]any{
		"Authorization": "DPoP " + credential.AccessToken,
		"DPoP":          proof,
	}}}, nil
}

func ensureDPoPCredential(
	ctx context.Context,
	states stateStore,
	client httpDoer,
	target agentTarget,
	state agentState,
	configuration agentConfiguration,
	grantID string,
) (dpopCredential, agentState, error) {
	for _, credential := range state.DPoPCredentials {
		if credential.GrantID == grantID {
			return credential, state, nil
		}
	}
	var resources agentAPIResourcesResponse
	if err := requestJSON(
		ctx,
		client,
		http.MethodGet,
		state.Origin+"/api/agent/api-resources?limit=100&offset=0",
		mustAgentJWT(state, configuration.Issuer),
		nil,
		&resources,
	); err != nil {
		return dpopCredential{}, state, fmt.Errorf("discover Agent API resource grant: %w", err)
	}
	for _, resource := range resources.Items {
		for _, grant := range resource.AccessGrants {
			if grant.ID != grantID || grant.Status != "active" {
				continue
			}
			privateKey, err := newDPoPPrivateKey()
			if err != nil {
				return dpopCredential{}, state, err
			}
			credential := dpopCredential{
				GrantID:           grantID,
				GrantMode:         grant.Mode,
				ResourceID:        resource.ID,
				ResourceURL:       resource.ResourceURL,
				AuthorizationMode: resource.AuthorizationMode,
				PrivateKey:        privateKey,
			}
			if state.DPoPCredentials == nil {
				state.DPoPCredentials = make(map[string]dpopCredential)
			}
			state.DPoPCredentials[resource.ID] = credential
			if err := states.Update(target, state); err != nil {
				return dpopCredential{}, state, err
			}
			return credential, state, nil
		}
	}
	return dpopCredential{}, state, errors.New("active Agent access grant was not found in API resource discovery")
}

func refreshTargetToken(
	ctx context.Context,
	client httpDoer,
	state agentState,
	credential dpopCredential,
) (dpopCredential, error) {
	configuration, err := discoverAgentConfiguration(ctx, client, state.Origin)
	if err != nil {
		return dpopCredential{}, err
	}
	tokenURL := state.Origin + "/api/agent/access-grants/" + url.PathEscape(credential.GrantID) + "/tokens"
	proofTarget, err := dpopTokenTarget(ctx, client, state.Origin, credential.GrantID, credential)
	if err != nil {
		return dpopCredential{}, err
	}
	proof, err := signDPoPProof(credential.PrivateKey, http.MethodPost, proofTarget, "", time.Now())
	if err != nil {
		return dpopCredential{}, err
	}
	var token targetTokenResponse
	if err := requestJSONHeaders(
		ctx,
		client,
		http.MethodPost,
		tokenURL,
		map[string]string{
			"Authorization": "Bearer " + mustAgentJWT(state, configuration.Issuer),
			"DPoP":          proof,
		},
		nil,
		&token,
	); err != nil {
		return dpopCredential{}, fmt.Errorf("issue target API access token: %w", err)
	}
	if token.TokenType != "DPoP" || token.AccessToken == "" || token.ResourceURL != credential.ResourceURL ||
		!token.ExpiresAt.After(time.Now()) {
		return dpopCredential{}, errors.New("Realmroot returned an invalid target API access token")
	}
	credential.AccessToken = token.AccessToken
	credential.ExpiresAt = &token.ExpiresAt
	return credential, nil
}

func dpopTokenTarget(
	ctx context.Context,
	client httpDoer,
	realmrootOrigin string,
	grantID string,
	credential dpopCredential,
) (string, error) {
	if credential.AuthorizationMode == "native" {
		return realmrootOrigin + "/api/agent/access-grants/" + url.PathEscape(grantID) + "/tokens", nil
	}
	resourceURL, err := validatedAbsoluteURL(credential.ResourceURL)
	if err != nil {
		return "", fmt.Errorf("external API resource URL is invalid: %w", err)
	}
	resourcePath := strings.TrimSuffix(resourceURL.EscapedPath(), "/")
	metadataURL := resourceURL.Scheme + "://" + resourceURL.Host + "/.well-known/oauth-protected-resource" + resourcePath
	var protected protectedResourceMetadata
	if err := requestJSON(ctx, client, http.MethodGet, metadataURL, "", nil, &protected); err != nil {
		return "", fmt.Errorf("discover external protected resource metadata: %w", err)
	}
	if protected.Resource != credential.ResourceURL || len(protected.AuthorizationServers) != 1 {
		return "", errors.New("external protected resource metadata does not match the registered API resource")
	}
	issuer, err := validatedAbsoluteURL(protected.AuthorizationServers[0])
	if err != nil {
		return "", fmt.Errorf("external authorization server issuer is invalid: %w", err)
	}
	issuerPath := strings.TrimSuffix(issuer.EscapedPath(), "/")
	authorizationMetadataURL := issuer.Scheme + "://" + issuer.Host + "/.well-known/oauth-authorization-server" + issuerPath
	var metadata authorizationServerMetadata
	if err := requestJSON(ctx, client, http.MethodGet, authorizationMetadataURL, "", nil, &metadata); err != nil {
		return "", fmt.Errorf("discover external authorization server metadata: %w", err)
	}
	if metadata.Issuer != strings.TrimSuffix(issuer.String(), "/") ||
		metadata.TokenEndpoint == "" ||
		!contains(metadata.DPoPAlgorithms, "ES256") {
		return "", errors.New("external authorization server metadata is incompatible with ES256 DPoP")
	}
	if _, err := validatedAbsoluteURL(metadata.TokenEndpoint); err != nil {
		return "", fmt.Errorf("external token endpoint is invalid: %w", err)
	}
	return metadata.TokenEndpoint, nil
}

func targetTokenGrantID(method string, requestURI string) (string, bool) {
	if method != http.MethodPost {
		return "", false
	}
	parsed, err := url.Parse(requestURI)
	if err != nil {
		return "", false
	}
	const prefix = "/api/agent/access-grants/"
	const suffix = "/tokens"
	if !strings.HasPrefix(parsed.EscapedPath(), prefix) || !strings.HasSuffix(parsed.EscapedPath(), suffix) {
		return "", false
	}
	encoded := strings.TrimSuffix(strings.TrimPrefix(parsed.EscapedPath(), prefix), suffix)
	if encoded == "" || strings.Contains(encoded, "/") {
		return "", false
	}
	grantID, err := url.PathUnescape(encoded)
	return grantID, err == nil && grantID != ""
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
		return agentConfiguration{}, fmt.Errorf("discover Realmroot Agent support: %w", err)
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
		Version:         agentStateVersion,
		Origin:          target.Origin,
		Issuer:          target.Issuer,
		Runtime:         target.Runtime,
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
		return fmt.Errorf("create Realmroot request: %w", err)
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
		return fmt.Errorf("call Realmroot: %w", err)
	}
	defer response.Body.Close()
	encoded, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("read Realmroot response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return &httpResponseError{StatusCode: response.StatusCode, Body: strings.TrimSpace(string(encoded))}
	}
	if output == nil || len(encoded) == 0 {
		return nil
	}
	if err := json.Unmarshal(encoded, output); err != nil {
		return fmt.Errorf("decode Realmroot response: %w", err)
	}
	return nil
}

type httpResponseError struct {
	StatusCode int
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

func agentDisplayName() string {
	if value := strings.TrimSpace(os.Getenv("REALMROOT_AGENT_NAME")); value != "" {
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
		if os.Getenv("REALMROOT_PLUGIN_APPROVAL_FILE") != "" || openErr == nil {
			return nil
		}
		return fmt.Errorf("cannot open or display Agent approval URL: %w", openErr)
	}
	defer terminal.Close()
	_, err = terminal.WriteString(message)
	return err
}

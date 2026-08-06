package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/gofrs/flock"
	"github.com/rest-sh/restish/v2/plugin"
)

const authCommandHelp = `Authenticate Realmroot Agent identities.

Usage:
  restish auth login [--hostname HOST] [--runtime RUNTIME]
  restish auth logout [--hostname HOST] [--runtime RUNTIME]
  restish auth status [--hostname HOST] [--runtime RUNTIME]

login is the only command that can register or authenticate an Agent identity.
status and logout operate only on protected local state.
`

type authCommandHost interface {
	WriteStdout([]byte) error
	Response(int, map[string][]string, any) error
	ConfigRead(string, string, string) (*plugin.ConfigReadResponseMsg, error)
	ListProfiles(string) (*plugin.ListProfilesResponseMsg, error)
	Prompt(string, bool) (*plugin.PromptResponseMsg, error)
}

type commandOptions struct {
	hostname string
	runtime  string
}

type localAuthAccount struct {
	Hostname string
	Origin   string
	Issuer   string
	Runtime  string
	Identity stableIdentity
	target   agentTarget
}

type localAgentState struct {
	path     string
	Hostname string
	Origin   string
	Issuer   string
	Runtime  string
	Identity *stableIdentity
	target   agentTarget
}

type installationEnrollment struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Status    string `json:"status"`
	ExpiresAt string `json:"expiresAt"`
}

type installationEnrollmentResponse struct {
	Enrollment      installationEnrollment `json:"enrollment"`
	VerificationURI string                 `json:"verificationUri"`
}

func runAuthCommand(args []string, host authCommandHost, states *fileStateStore, bindings *authBindingStore) error {
	if len(args) == 0 || args[0] == "help" || args[0] == "--help" || args[0] == "-h" {
		return host.WriteStdout([]byte(authCommandHelp))
	}
	if len(args) == 2 && args[1] == "--help" {
		return host.WriteStdout([]byte(authCommandHelp))
	}
	options, err := parseCommandOptions(args[1:])
	if err != nil {
		return err
	}
	switch args[0] {
	case "login":
		return authLogin(host, states, bindings, options)
	case "logout":
		return authLogout(host, states, bindings, options)
	case "status":
		return authStatus(host, states, options)
	default:
		return fmt.Errorf("unknown auth subcommand %q; run `restish auth --help`", args[0])
	}
}

func parseCommandOptions(args []string) (commandOptions, error) {
	var options commandOptions
	for index := 0; index < len(args); index++ {
		argument := args[index]
		name, value, hasValue := strings.Cut(argument, "=")
		if !hasValue {
			index++
			if index >= len(args) {
				return commandOptions{}, fmt.Errorf("%s requires a value", name)
			}
			value = args[index]
		}
		switch name {
		case "--hostname", "-h":
			options.hostname = value
		case "--runtime":
			options.runtime = value
		default:
			if strings.HasPrefix(argument, "-") {
				return commandOptions{}, fmt.Errorf("unknown option %s", name)
			}
			return commandOptions{}, errors.New("auth commands do not accept positional arguments")
		}
	}
	return options, nil
}

func authLogin(
	host authCommandHost,
	states *fileStateStore,
	bindings *authBindingStore,
	options commandOptions,
) (result error) {
	runtime, err := loginRuntime(host, options.runtime)
	if err != nil {
		return err
	}
	if _, detectionErr := agentRuntime(); errors.Is(detectionErr, errUnknownAgentRuntime) {
		if err := bindings.SetRuntimeFallback(runtime); err != nil {
			return err
		}
	}
	origin, err := loginOrigin(host, options.hostname)
	if err != nil {
		return err
	}
	configuration, err := discoverAgentConfiguration(context.Background(), newHTTPClient(), origin)
	if err != nil {
		return err
	}
	target := agentTarget{
		API: "realmroot", Profile: "default", Runtime: runtime, Origin: origin, Issuer: configuration.AgentIdentityIssuer,
	}
	if err := os.MkdirAll(filepath.Dir(states.path(target)), 0o700); err != nil {
		return fmt.Errorf("create Realmroot login directory: %w", err)
	}
	loginLock := flock.New(states.path(target) + ".login.lock")
	if err := loginLock.Lock(); err != nil {
		return fmt.Errorf("lock Realmroot login: %w", err)
	}
	defer func() {
		if err := loginLock.Unlock(); err != nil {
			result = errors.Join(result, fmt.Errorf("unlock Realmroot login: %w", err))
		}
	}()

	remembered, err := bindings.Find(target.Issuer, runtime)
	if err != nil {
		return err
	}
	state, err := ensureAgentIdentity(context.Background(), states, newHTTPClient(), systemPromptWriter{}, target, configuration)
	if err != nil {
		return err
	}
	if state.Identity == nil && remembered != nil {
		if err := enrollRememberedIdentity(context.Background(), state, configuration, remembered.Identity); err != nil {
			var terminal *terminalAgentApprovalError
			if errors.As(err, &terminal) {
				err = errors.Join(err, states.Delete(target))
			}
			return err
		}
	}
	state, _, err = ensurePlatformCredential(context.Background(), states, newHTTPClient(), target, state, configuration)
	if err != nil {
		return err
	}
	if remembered != nil &&
		(state.Identity.ID != remembered.Identity.ID || state.Identity.Subject != remembered.Identity.Subject) {
		return errors.Join(
			errors.New("Realmroot login did not restore the remembered stable Agent identity"),
			states.Delete(target),
		)
	}
	if err := bindings.Put(rememberedIdentity{
		Origin: origin, Issuer: target.Issuer, Runtime: runtime, Identity: *state.Identity,
	}); err != nil {
		return err
	}
	return host.Response(http.StatusOK, nil, accountView(accountFromState(target, state), true))
}

func authLogout(
	host authCommandHost,
	states *fileStateStore,
	bindings *authBindingStore,
	options commandOptions,
) (result error) {
	runtime, err := explicitOrStoredRuntime(states, options.runtime)
	if err != nil {
		return err
	}
	if err := states.cleanupStateTemps(); err != nil {
		return err
	}
	localStates, err := listLocalAgentStates(states)
	if err != nil {
		return err
	}
	state, err := selectLocalAgentState(localStates, options.hostname, runtime)
	if err != nil {
		return err
	}
	loginLock := flock.New(states.path(state.target) + ".login.lock")
	if err := loginLock.Lock(); err != nil {
		return fmt.Errorf("lock Realmroot logout: %w", err)
	}
	defer func() {
		if err := loginLock.Unlock(); err != nil {
			result = errors.Join(result, fmt.Errorf("unlock Realmroot logout: %w", err))
		}
	}()
	localStates, err = listLocalAgentStates(states)
	if err != nil {
		return err
	}
	state, err = selectLocalAgentState(localStates, options.hostname, runtime)
	if err != nil {
		return err
	}
	if state.Identity != nil {
		if err := bindings.Put(rememberedIdentity{
			Origin: state.Origin, Issuer: state.Issuer, Runtime: state.Runtime, Identity: *state.Identity,
		}); err != nil {
			return err
		}
	}
	if err := states.deletePath(state.path); err != nil {
		return err
	}
	if err := states.cleanupStateTemps(); err != nil {
		return err
	}
	return host.Response(http.StatusOK, nil, map[string]any{
		"hostname":              state.Hostname,
		"runtime":               state.Runtime,
		"loggedIn":              false,
		"remoteIdentityChanged": false,
	})
}

func authStatus(host authCommandHost, states *fileStateStore, options commandOptions) error {
	accounts, err := listLocalAuthAccounts(states)
	if err != nil {
		return err
	}
	if options.hostname != "" {
		hostname, err := normalizeHostname(options.hostname)
		if err != nil {
			return err
		}
		accounts = filterAccounts(accounts, hostname, "")
	}
	currentRuntime, detectionErr := explicitOrStoredRuntime(states, options.runtime)
	items := make([]map[string]any, 0, len(accounts))
	for _, account := range accounts {
		items = append(items, accountView(account, detectionErr == nil && account.Runtime == currentRuntime))
	}
	return host.Response(http.StatusOK, nil, map[string]any{"hosts": groupAccountViews(items)})
}

func explicitOrStoredRuntime(states *fileStateStore, explicit string) (string, error) {
	runtime, err := explicitOrDetectedRuntime(explicit)
	if err == nil || !errors.Is(err, errUnknownAgentRuntime) {
		return runtime, err
	}
	fallback, fallbackErr := newAuthBindingStore(states).RuntimeFallback()
	if fallbackErr != nil {
		return "", fallbackErr
	}
	if fallback == "" {
		return "", err
	}
	return fallback, nil
}

func enrollRememberedIdentity(
	ctx context.Context,
	state agentState,
	configuration agentConfiguration,
	identity stableIdentity,
) error {
	digest := sha256.Sum256([]byte(identity.ID + "\x00" + state.AgentID))
	var response installationEnrollmentResponse
	if err := requestJSONHeaders(
		ctx,
		newHTTPClient(),
		http.MethodPost,
		configuration.AgentEnrollmentEndpoint,
		map[string]string{
			"Authorization":   "Bearer " + mustAgentJWT(state, configuration.Issuer),
			"Idempotency-Key": "login-" + hex.EncodeToString(digest[:16]),
		},
		map[string]any{"kind": "additional_installation", "agentId": identity.ID},
		&response,
	); err != nil {
		return fmt.Errorf("restore stable Agent identity: %w", err)
	}
	if response.Enrollment.ID == "" || response.Enrollment.Kind != "additional_host" {
		return errors.New("Realmroot returned an invalid Agent installation enrollment")
	}
	if response.Enrollment.Status == "pending" {
		if _, err := url.ParseRequestURI(response.VerificationURI); err != nil {
			return errors.New("Realmroot returned an invalid Agent installation approval URL")
		}
		if err := (systemPromptWriter{}).Show(response.VerificationURI); err != nil {
			return err
		}
		return waitForInstallationApproval(ctx, state, configuration, response.Enrollment)
	}
	if response.Enrollment.Status != "approved" {
		return &terminalAgentApprovalError{status: response.Enrollment.Status}
	}
	return nil
}

func waitForInstallationApproval(
	ctx context.Context,
	state agentState,
	configuration agentConfiguration,
	enrollment installationEnrollment,
) error {
	expiresAt, err := time.Parse(time.RFC3339, enrollment.ExpiresAt)
	if err != nil {
		return errors.New("Realmroot returned an invalid Agent installation enrollment expiration")
	}
	endpoint := strings.TrimSuffix(configuration.AgentEnrollmentEndpoint, "/") + "/" + url.PathEscape(enrollment.ID)
	for time.Now().Before(expiresAt) {
		var current installationEnrollment
		if err := requestJSONHeaders(
			ctx,
			newHTTPClient(),
			http.MethodGet,
			endpoint,
			map[string]string{"Authorization": "Bearer " + mustAgentJWT(state, configuration.Issuer)},
			nil,
			&current,
		); err != nil {
			return fmt.Errorf("read Agent installation approval: %w", err)
		}
		switch current.Status {
		case "approved":
			return nil
		case "pending":
			timer := time.NewTimer(2 * time.Second)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
		case "denied", "expired", "cancelled":
			return &terminalAgentApprovalError{status: current.Status}
		default:
			return fmt.Errorf("Agent installation enrollment returned unexpected status %q", current.Status)
		}
	}
	return &terminalAgentApprovalError{status: "expired"}
}

func loginRuntime(host authCommandHost, explicit string) (string, error) {
	runtime, err := explicitOrDetectedRuntime(explicit)
	if err == nil {
		return runtime, nil
	}
	if !errors.Is(err, errUnknownAgentRuntime) {
		return "", err
	}
	response, err := host.Prompt("Runtime name", false)
	if err != nil {
		return "", fmt.Errorf("read runtime name: %w", err)
	}
	if response.Error != "" {
		return "", errors.New(response.Error)
	}
	return normalizeAgentRuntime(response.Value)
}

func explicitOrDetectedRuntime(explicit string) (string, error) {
	if explicit != "" {
		return normalizeAgentRuntime(explicit)
	}
	return agentRuntime()
}

func loginOrigin(host authCommandHost, hostname string) (string, error) {
	config, configErr := host.ConfigRead("realmroot", "default", "")
	if hostname == "" {
		if configErr != nil {
			return "", fmt.Errorf("read Realmroot Restish configuration: %w", configErr)
		}
		if config.Error != "" {
			return "", errors.New(config.Error)
		}
		if config.BaseURL == "" {
			return "", errors.New("Realmroot Restish configuration has no base URL")
		}
		return realmrootOrigin(config.BaseURL)
	}
	normalized, err := normalizeHostname(hostname)
	if err != nil {
		return "", err
	}
	if configErr == nil && config.Error == "" && config.BaseURL != "" {
		origin, originErr := realmrootOrigin(config.BaseURL)
		if originErr == nil && originHostname(origin) == normalized {
			return origin, nil
		}
	}
	profiles, err := host.ListProfiles("realmroot")
	if err != nil {
		return "", fmt.Errorf("read Realmroot Restish profiles: %w", err)
	}
	if profiles.Error == "" {
		var matched string
		for _, profile := range profiles.Profiles {
			profileConfig, err := host.ConfigRead("realmroot", profile, "")
			if err != nil {
				return "", fmt.Errorf("read Realmroot Restish profile %q: %w", profile, err)
			}
			if profileConfig.Error != "" || profileConfig.BaseURL == "" {
				continue
			}
			origin, err := realmrootOrigin(profileConfig.BaseURL)
			if err != nil || originHostname(origin) != normalized {
				continue
			}
			if matched != "" && matched != origin {
				return "", fmt.Errorf("multiple Realmroot profiles use hostname %q; remove the ambiguous profile", normalized)
			}
			matched = origin
		}
		if matched != "" {
			return matched, nil
		}
	}
	return "https://" + normalized, nil
}

func listLocalAgentStates(states *fileStateStore) ([]localAgentState, error) {
	localStates := make([]localAgentState, 0)
	err := states.walkStates(func(path string, state agentState) error {
		target := agentTarget{Runtime: state.Runtime, Origin: state.Origin, Issuer: state.Issuer}
		localStates = append(localStates, localAgentState{
			path:     path,
			Hostname: originHostname(state.Origin), Origin: state.Origin, Issuer: state.Issuer,
			Runtime: state.Runtime, Identity: state.Identity, target: target,
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	return localStates, nil
}

func listLocalAuthAccounts(states *fileStateStore) ([]localAuthAccount, error) {
	accounts := make([]localAuthAccount, 0)
	err := states.walkStates(func(_ string, state agentState) error {
		if state.Identity == nil || state.PlatformCredential == nil {
			return nil
		}
		target := agentTarget{Runtime: state.Runtime, Origin: state.Origin, Issuer: state.Issuer}
		accounts = append(accounts, accountFromState(target, state))
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(accounts, func(i, j int) bool {
		if accounts[i].Issuer != accounts[j].Issuer {
			return accounts[i].Issuer < accounts[j].Issuer
		}
		return accounts[i].Runtime < accounts[j].Runtime
	})
	return accounts, nil
}

func selectLocalAgentState(states []localAgentState, hostname string, runtime string) (localAgentState, error) {
	filtered := make([]localAgentState, 0)
	if hostname != "" {
		normalized, err := normalizeHostname(hostname)
		if err != nil {
			return localAgentState{}, err
		}
		hostname = normalized
	}
	for _, state := range states {
		if (hostname == "" || state.Hostname == hostname) && state.Runtime == runtime {
			filtered = append(filtered, state)
		}
	}
	if len(filtered) == 0 {
		return localAgentState{}, fmt.Errorf("runtime %q has no local authentication state; run `restish auth login`", runtime)
	}
	if len(filtered) > 1 {
		return localAgentState{}, errors.New("runtime has local authentication state for multiple Realmroot hosts; specify --hostname")
	}
	return filtered[0], nil
}

func filterAccounts(accounts []localAuthAccount, hostname string, runtime string) []localAuthAccount {
	filtered := make([]localAuthAccount, 0)
	for _, account := range accounts {
		if (hostname == "" || account.Hostname == hostname) && (runtime == "" || account.Runtime == runtime) {
			filtered = append(filtered, account)
		}
	}
	return filtered
}

func accountFromState(target agentTarget, state agentState) localAuthAccount {
	return localAuthAccount{
		Hostname: originHostname(state.Origin), Origin: state.Origin, Issuer: state.Issuer,
		Runtime: state.Runtime, Identity: *state.Identity, target: target,
	}
}

func normalizeHostname(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	parsed, err := url.Parse("https://" + value)
	if err != nil || parsed.Host == "" || parsed.Host != value || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("hostname must be a host name without a scheme or path")
	}
	return parsed.Host, nil
}

func originHostname(origin string) string {
	parsed, _ := url.Parse(origin)
	return strings.ToLower(parsed.Host)
}

func accountView(account localAuthAccount, current bool) map[string]any {
	return map[string]any{
		"hostname": account.Hostname,
		"issuer":   account.Issuer,
		"runtime":  account.Runtime,
		"agent": map[string]any{
			"id": account.Identity.ID, "issuer": account.Identity.Issuer,
			"subject": account.Identity.Subject, "name": account.Identity.Name,
		},
		"authenticated": true,
		"local_agent":   account.Runtime,
		"loggedIn":      true,
		"current":       current,
	}
}

func groupAccountViews(items []map[string]any) []map[string]any {
	groups := make([]map[string]any, 0)
	byIssuer := map[string]int{}
	for _, item := range items {
		issuer := item["issuer"].(string)
		index, ok := byIssuer[issuer]
		if !ok {
			index = len(groups)
			byIssuer[issuer] = index
			groups = append(groups, map[string]any{
				"hostname": item["hostname"], "issuer": issuer, "accounts": []map[string]any{},
			})
		}
		accounts := groups[index]["accounts"].([]map[string]any)
		groups[index]["accounts"] = append(accounts, item)
	}
	return groups
}

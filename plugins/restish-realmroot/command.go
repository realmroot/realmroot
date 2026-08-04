package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/rest-sh/restish/v2/plugin"
)

const authCommandHelp = `Manage Realmroot Agent identity lifecycle.

Usage:
  restish auth status [--profile NAME]
  restish auth list
  restish auth login [NAME] [--api realmroot] [--api-profile default] [--agent-name NAME]
  restish auth use NAME
  restish auth logout [--profile NAME]
  restish auth revoke INSTALLATION_ID [--profile NAME]
  restish auth recover [--profile NAME] [--yes]
  restish auth retire [--profile NAME] [--confirm SUBJECT]

logout removes only local adapter state. revoke changes one remote installation.
recover replaces obsolete installations while preserving the stable subject.
retire is permanent and requires the exact stable subject as confirmation.
`

type authCommandHost interface {
	WriteStdout([]byte) error
	Response(int, map[string][]string, any) error
	ConfigRead(string, string, string) (*plugin.ConfigReadResponseMsg, error)
	Prompt(string, bool) (*plugin.PromptResponseMsg, error)
	Confirm(string) (*plugin.ConfirmResponseMsg, error)
	Do(*plugin.HTTPRequestMsg) (*plugin.HTTPResponseMsg, error)
}

type commandOptions struct {
	profile     string
	api         string
	apiProfile  string
	agentName   string
	confirm     string
	yes         bool
	positionals []string
}

type agentInstallationView struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Status         string  `json:"status"`
	CredentialType string  `json:"credentialType"`
	BoundAt        string  `json:"boundAt"`
	LastSeenAt     *string `json:"lastSeenAt"`
}

type installationRevocationView struct {
	AgentID        string `json:"agentId"`
	InstallationID string `json:"installationId"`
	Status         string `json:"status"`
	RevokedAt      string `json:"revokedAt"`
	LocalState     string `json:"localState,omitempty"`
}

type recoveryEnrollment struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Status    string `json:"status"`
	ExpiresAt string `json:"expiresAt"`
}

type recoveryEnrollmentResponse struct {
	Enrollment      recoveryEnrollment `json:"enrollment"`
	VerificationURI string             `json:"verificationUri"`
}

func runAuthCommand(args []string, host authCommandHost, states *fileStateStore, profiles *lifecycleProfileStore) error {
	if len(args) == 0 || args[0] == "help" || args[0] == "--help" || args[0] == "-h" {
		return host.WriteStdout([]byte(authCommandHelp))
	}
	subcommand := args[0]
	options, err := parseCommandOptions(args[1:])
	if err != nil {
		return err
	}
	switch subcommand {
	case "status":
		if len(options.positionals) != 0 || options.api != "" || options.apiProfile != "" || options.agentName != "" || options.confirm != "" || options.yes {
			return errors.New("usage: restish auth status [--profile NAME]")
		}
		return authStatus(host, states, profiles, options.profile)
	case "list":
		if len(options.positionals) != 0 || options.profile != "" || options.api != "" || options.apiProfile != "" || options.agentName != "" || options.confirm != "" || options.yes {
			return errors.New("usage: restish auth list")
		}
		return authList(host, states, profiles)
	case "login":
		if len(options.positionals) > 1 || options.profile != "" || options.confirm != "" || options.yes {
			return errors.New("usage: restish auth login [NAME] [--api API] [--api-profile PROFILE] [--agent-name NAME]")
		}
		if options.api == "" {
			options.api = "realmroot"
		}
		if options.apiProfile == "" {
			options.apiProfile = "default"
		}
		name := options.apiProfile
		if len(options.positionals) == 1 {
			name = options.positionals[0]
		}
		return authLogin(host, states, profiles, name, options)
	case "use":
		if len(options.positionals) != 1 || options.profile != "" || options.api != "" || options.apiProfile != "" || options.agentName != "" || options.confirm != "" || options.yes {
			return errors.New("usage: restish auth use NAME")
		}
		return authUse(host, profiles, options.positionals[0])
	case "logout":
		if len(options.positionals) != 0 || options.api != "" || options.apiProfile != "" || options.agentName != "" || options.confirm != "" || options.yes {
			return errors.New("usage: restish auth logout [--profile NAME]")
		}
		return authLogout(host, states, profiles, options.profile)
	case "revoke":
		if len(options.positionals) != 1 || options.api != "" || options.apiProfile != "" || options.agentName != "" || options.confirm != "" || options.yes {
			return errors.New("usage: restish auth revoke INSTALLATION_ID [--profile NAME]")
		}
		return authRevoke(host, states, profiles, options.profile, options.positionals[0])
	case "recover":
		if len(options.positionals) != 0 || options.api != "" || options.apiProfile != "" || options.agentName != "" || options.confirm != "" {
			return errors.New("usage: restish auth recover [--profile NAME] [--yes]")
		}
		return authRecover(host, states, profiles, options.profile, options.yes)
	case "retire":
		if len(options.positionals) != 0 || options.api != "" || options.apiProfile != "" || options.agentName != "" || options.yes {
			return errors.New("usage: restish auth retire [--profile NAME] [--confirm SUBJECT]")
		}
		return authRetire(host, states, profiles, options.profile, options.confirm)
	default:
		return fmt.Errorf("unknown auth subcommand %q; run `restish auth --help`", subcommand)
	}
}

func parseCommandOptions(args []string) (commandOptions, error) {
	var options commandOptions
	for index := 0; index < len(args); index++ {
		argument := args[index]
		if !strings.HasPrefix(argument, "--") {
			options.positionals = append(options.positionals, argument)
			continue
		}
		name, value, hasValue := strings.Cut(strings.TrimPrefix(argument, "--"), "=")
		if name == "yes" {
			if hasValue {
				return commandOptions{}, errors.New("--yes does not accept a value")
			}
			options.yes = true
			continue
		}
		if !hasValue {
			index++
			if index >= len(args) {
				return commandOptions{}, fmt.Errorf("--%s requires a value", name)
			}
			value = args[index]
		}
		switch name {
		case "profile":
			options.profile = value
		case "api":
			options.api = value
		case "api-profile":
			options.apiProfile = value
		case "agent-name":
			options.agentName = value
		case "confirm":
			options.confirm = value
		default:
			return commandOptions{}, fmt.Errorf("unknown option --%s", name)
		}
	}
	return options, nil
}

func authLogin(
	host authCommandHost,
	states *fileStateStore,
	profiles *lifecycleProfileStore,
	name string,
	options commandOptions,
) error {
	if err := validateLifecycleProfileName(name); err != nil {
		return err
	}
	config, err := host.ConfigRead(options.api, options.apiProfile, "")
	if err != nil {
		return fmt.Errorf("read Restish API profile: %w", err)
	}
	if config.Error != "" {
		return errors.New(config.Error)
	}
	if config.BaseURL == "" {
		return fmt.Errorf("Restish API %q profile %q has no base URL", options.api, options.apiProfile)
	}
	origin, err := realmrootOrigin(config.BaseURL)
	if err != nil {
		return err
	}
	configuration, err := discoverAgentConfiguration(context.Background(), newHTTPClient(), origin)
	if err != nil {
		return err
	}
	runtime, err := agentRuntime()
	if err != nil {
		return err
	}
	profile := lifecycleProfile{
		Name: name, API: options.api, APIProfile: options.apiProfile, Origin: origin,
		Issuer: configuration.AgentIdentityIssuer, Runtime: runtime,
	}
	if err := profiles.Put(profile); err != nil {
		return err
	}
	displayName := strings.TrimSpace(options.agentName)
	if displayName == "" {
		displayName = agentDisplayName()
	}
	state, err := ensureAgentIdentityNamed(
		context.Background(), states, newHTTPClient(), systemPromptWriter{}, profile.target(), configuration, displayName,
	)
	if err != nil {
		return err
	}
	state, _, err = ensurePlatformCredential(context.Background(), states, newHTTPClient(), profile.target(), state, configuration)
	if err != nil {
		return err
	}
	return writeStatus(host, profile, state, nil)
}

func authUse(host authCommandHost, profiles *lifecycleProfileStore, name string) error {
	if err := validateLifecycleProfileName(name); err != nil {
		return err
	}
	profile, err := profiles.Use(name)
	if err != nil {
		return err
	}
	return host.Response(http.StatusOK, nil, map[string]any{
		"profile": profile.Name, "api": profile.API, "apiProfile": profile.APIProfile,
		"issuer": profile.Issuer, "selected": true, "restishProfileFlag": "--rsh-profile " + profile.APIProfile,
	})
}

func authStatus(host authCommandHost, states *fileStateStore, profiles *lifecycleProfileStore, name string) error {
	profile, state, err := selectedState(states, profiles, name)
	if err != nil {
		return err
	}
	if state.Identity == nil {
		return writeStatus(host, profile, state, nil)
	}
	var remote agentSelfStatusResponse
	if err := lifecycleJSON(host, states, profile, http.MethodGet, "/api/agent/status", nil, &remote); err != nil {
		return fmt.Errorf("read remote Agent status: %w", err)
	}
	return writeStatus(host, profile, state, &remote)
}

func authList(host authCommandHost, states *fileStateStore, profileStore *lifecycleProfileStore) error {
	profiles, err := profileStore.Load()
	if err != nil {
		return err
	}
	names := make([]string, 0, len(profiles.Profiles))
	for name := range profiles.Profiles {
		names = append(names, name)
	}
	sort.Strings(names)
	items := make([]map[string]any, 0, len(names))
	for _, name := range names {
		profile := profiles.Profiles[name]
		state, loadErr := states.Load(profile.target())
		if errors.Is(loadErr, os.ErrNotExist) {
			items = append(items, localProfileView(profile, profiles.Active == name, nil))
			continue
		}
		if loadErr != nil {
			return loadErr
		}
		items = append(items, localProfileView(profile, profiles.Active == name, &state))
	}
	result := map[string]any{"current": profiles.Active, "profiles": items, "installations": []any{}}
	if profiles.Active != "" {
		profile := profiles.Profiles[profiles.Active]
		state, loadErr := states.Load(profile.target())
		if loadErr == nil && state.Identity != nil {
			installations := make([]agentInstallationView, 0)
			offset := 0
			for {
				var remote struct {
					Items      []agentInstallationView `json:"items"`
					Pagination struct {
						HasMore    bool `json:"hasMore"`
						NextOffset *int `json:"nextOffset"`
					} `json:"pagination"`
				}
				path := fmt.Sprintf(
					"/api/agents/%s/installations?limit=100&offset=%d",
					url.PathEscape(state.Identity.ID), offset,
				)
				if err := lifecycleJSON(host, states, profile, http.MethodGet, path, nil, &remote); err != nil {
					return fmt.Errorf("list remote Agent installations: %w", err)
				}
				for _, installation := range remote.Items {
					if installation.ID == "" || installation.Name == "" || installation.Status == "" ||
						(installation.CredentialType != "public_key" && installation.CredentialType != "remote_jwks") {
						return errors.New("Realmroot returned an invalid Agent installation")
					}
					if _, err := time.Parse(time.RFC3339, installation.BoundAt); err != nil {
						return errors.New("Realmroot returned an invalid Agent installation bound time")
					}
					if installation.LastSeenAt != nil {
						if _, err := time.Parse(time.RFC3339, *installation.LastSeenAt); err != nil {
							return errors.New("Realmroot returned an invalid Agent installation last-seen time")
						}
					}
				}
				installations = append(installations, remote.Items...)
				if !remote.Pagination.HasMore {
					break
				}
				if remote.Pagination.NextOffset == nil || *remote.Pagination.NextOffset <= offset {
					return errors.New("Realmroot returned invalid Agent installation pagination")
				}
				offset = *remote.Pagination.NextOffset
			}
			result["installations"] = installations
		}
	}
	return host.Response(http.StatusOK, nil, result)
}

func authLogout(host authCommandHost, states *fileStateStore, profiles *lifecycleProfileStore, name string) error {
	profile, err := profiles.Selected(name)
	if err != nil {
		return err
	}
	state, err := states.Load(profile.target())
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if err := profiles.Delete(profile.Name); err != nil {
			return err
		}
		return host.Response(http.StatusOK, nil, map[string]any{
			"profile": profile.Name, "localState": "removed", "remoteIdentityChanged": false,
		})
	}
	identity := state.Identity
	if err := removeLocalLifecycleProfile(states, profiles, profile); err != nil {
		return err
	}
	result := map[string]any{"profile": profile.Name, "localState": "removed", "remoteIdentityChanged": false}
	if identity != nil {
		result["issuer"] = identity.Issuer
		result["subject"] = identity.Subject
	}
	return host.Response(http.StatusOK, nil, result)
}

func authRevoke(
	host authCommandHost,
	states *fileStateStore,
	profiles *lifecycleProfileStore,
	name string,
	installationID string,
) error {
	profile, err := profiles.Selected(name)
	if err != nil {
		return err
	}
	if profile.Completion != nil {
		if profile.Completion.Kind != "installation_revocation" || profile.Completion.Installation != installationID {
			return errors.New("selected lifecycle profile has a different completed remote operation")
		}
		if err := removeLocalLifecycleProfile(states, profiles, profile); err != nil {
			return err
		}
		return host.Response(http.StatusOK, nil, map[string]any{
			"installationId": installationID, "status": "revoked", "localState": "removed",
		})
	}
	state, err := states.Load(profile.target())
	if errors.Is(err, os.ErrNotExist) {
		return errors.New("local Agent credential state is missing; remote installation state is unknown")
	}
	if err != nil {
		return err
	}
	if state.Identity == nil {
		return errors.New("selected lifecycle profile has no enrolled Agent identity")
	}
	var current agentSelfStatusResponse
	if err := lifecycleJSON(host, states, profile, http.MethodGet, "/api/agent/status", nil, &current); err != nil {
		return fmt.Errorf("read current Agent installation: %w", err)
	}
	path := fmt.Sprintf(
		"/api/agents/%s/installations/%s/revocation",
		url.PathEscape(state.Identity.ID),
		url.PathEscape(installationID),
	)
	var revocation installationRevocationView
	if err := lifecycleJSON(host, states, profile, http.MethodPut, path, nil, &revocation); err != nil {
		return fmt.Errorf("revoke Agent installation: %w", err)
	}
	if revocation.AgentID != state.Identity.ID || revocation.InstallationID != installationID ||
		revocation.Status != "revoked" || revocation.RevokedAt == "" {
		return errors.New("Realmroot returned an invalid Agent installation revocation")
	}
	if _, err := time.Parse(time.RFC3339, revocation.RevokedAt); err != nil {
		return errors.New("Realmroot returned an invalid Agent installation revocation time")
	}
	if current.Installation != nil && current.Installation.ID == installationID {
		if err := profiles.Complete(profile.Name, lifecycleCompletion{
			Kind: "installation_revocation", ResourceID: state.Identity.ID, Installation: installationID,
		}); err != nil {
			return err
		}
		if err := removeLocalLifecycleProfile(states, profiles, profile); err != nil {
			return err
		}
		revocation.LocalState = "removed"
	}
	return host.Response(http.StatusOK, nil, revocation)
}

func authRecover(
	host authCommandHost,
	states *fileStateStore,
	profiles *lifecycleProfileStore,
	name string,
	yes bool,
) error {
	profile, state, err := selectedState(states, profiles, name)
	if err != nil {
		return err
	}
	if state.Identity == nil && state.RecoveryIdentity == nil {
		return errors.New("selected lifecycle profile has no stable Agent identity to recover")
	}
	identity := state.Identity
	if identity == nil {
		identity = state.RecoveryIdentity
	}
	if !yes {
		confirmation, err := host.Confirm(
			fmt.Sprintf("Recover %s (%s)? This revokes every existing installation and freezes Resource access.", state.Name, identity.Subject),
		)
		if err != nil {
			return err
		}
		if !confirmation.Value {
			return host.Response(http.StatusOK, nil, map[string]any{"status": "cancelled", "identityChanged": false})
		}
	}
	configuration, err := discoverAgentConfiguration(context.Background(), newHTTPClient(), profile.Origin)
	if err != nil {
		return err
	}
	if state.RecoveryIdentity == nil {
		state.RecoveryIdentity = identity
		if err := states.Update(profile.target(), state); err != nil {
			return err
		}
	}
	fresh, err := states.Load(profile.target())
	if err != nil {
		return err
	}
	if fresh.Identity != nil || fresh.RegistrationApproval == nil || fresh.RegistrationApproval.ExpiresAt == nil ||
		!time.Now().Before(*fresh.RegistrationApproval.ExpiresAt) {
		fresh, err = registerAgent(context.Background(), states, newHTTPClient(), profile.target(), fresh.Name, true, configuration)
		if err != nil {
			return err
		}
		fresh.RecoveryIdentity = identity
		if err := states.Update(profile.target(), fresh); err != nil {
			return err
		}
	}
	if fresh.RegistrationApproval != nil {
		if err := (systemPromptWriter{}).Show(fresh.RegistrationApproval.VerificationURIComplete); err != nil {
			return err
		}
		if err := waitForAgentApproval(context.Background(), newHTTPClient(), fresh, configuration); err != nil {
			var terminal *terminalAgentApprovalError
			if errors.As(err, &terminal) {
				fresh.RegistrationApproval = nil
				if updateErr := states.Update(profile.target(), fresh); updateErr != nil {
					return errors.Join(err, updateErr)
				}
			}
			return err
		}
	}
	keyDigest := sha256.Sum256([]byte(identity.ID + "\x00" + fresh.AgentID))
	var enrollment recoveryEnrollmentResponse
	if err := requestJSONHeaders(
		context.Background(),
		newHTTPClient(),
		http.MethodPost,
		configuration.AgentEnrollmentEndpoint,
		map[string]string{
			"Authorization":   "Bearer " + mustAgentJWT(fresh, configuration.Issuer),
			"Idempotency-Key": "recovery-" + hex.EncodeToString(keyDigest[:16]),
		},
		map[string]any{"kind": "recovery_installation", "agentId": identity.ID},
		&enrollment,
	); err != nil {
		return fmt.Errorf("enroll recovered Agent installation: %w", err)
	}
	if enrollment.Enrollment.Kind != "recovery" || enrollment.Enrollment.ID == "" {
		return errors.New("Realmroot returned an invalid recovery enrollment")
	}
	if enrollment.Enrollment.Status == "pending" {
		if _, err := url.ParseRequestURI(enrollment.VerificationURI); err != nil {
			return errors.New("Realmroot returned an invalid recovery approval URL")
		}
		if err := (systemPromptWriter{}).Show(enrollment.VerificationURI); err != nil {
			return err
		}
		if err := waitForRecoveryApproval(
			context.Background(), newHTTPClient(), fresh, configuration, enrollment.Enrollment,
		); err != nil {
			return err
		}
	} else if enrollment.Enrollment.Status != "approved" {
		return &terminalAgentApprovalError{status: enrollment.Enrollment.Status}
	}
	fresh.RecoveryIdentity = nil
	fresh, _, err = ensurePlatformCredential(
		context.Background(), states, newHTTPClient(), profile.target(), fresh, configuration,
	)
	if err != nil {
		return err
	}
	if fresh.Identity == nil || fresh.Identity.Subject != identity.Subject || fresh.Identity.Issuer != identity.Issuer {
		return errors.New("recovered installation did not preserve the stable Agent issuer and subject")
	}
	if err := states.Update(profile.target(), fresh); err != nil {
		return err
	}
	return writeStatus(host, profile, fresh, nil)
}

func waitForRecoveryApproval(
	ctx context.Context,
	client httpDoer,
	state agentState,
	configuration agentConfiguration,
	enrollment recoveryEnrollment,
) error {
	expiresAt, err := time.Parse(time.RFC3339, enrollment.ExpiresAt)
	if err != nil {
		return errors.New("Realmroot returned an invalid recovery enrollment expiration")
	}
	endpoint := strings.TrimSuffix(configuration.AgentEnrollmentEndpoint, "/") + "/" + url.PathEscape(enrollment.ID)
	for time.Now().Before(expiresAt) {
		var current recoveryEnrollment
		if err := requestJSONHeaders(
			ctx,
			client,
			http.MethodGet,
			endpoint,
			map[string]string{"Authorization": "Bearer " + mustAgentJWT(state, configuration.Issuer)},
			nil,
			&current,
		); err != nil {
			return fmt.Errorf("read recovery approval: %w", err)
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
			return fmt.Errorf("recovery enrollment returned unexpected status %q", current.Status)
		}
	}
	return errors.New("recovery approval expired; invoke `restish auth recover` again to resume")
}

func authRetire(
	host authCommandHost,
	states *fileStateStore,
	profiles *lifecycleProfileStore,
	name string,
	confirmation string,
) error {
	profile, err := profiles.Selected(name)
	if err != nil {
		return err
	}
	if profile.Completion != nil {
		if profile.Completion.Kind != "identity_retirement" {
			return errors.New("selected lifecycle profile has a different completed remote operation")
		}
		if err := removeLocalLifecycleProfile(states, profiles, profile); err != nil {
			return err
		}
		return host.Response(http.StatusOK, nil, map[string]any{
			"agentId": profile.Completion.ResourceID, "status": "retired", "localState": "removed",
		})
	}
	state, err := states.Load(profile.target())
	if errors.Is(err, os.ErrNotExist) {
		return errors.New("local Agent credential state is missing; remote identity retirement state is unknown")
	}
	if err != nil {
		return err
	}
	if state.Identity == nil {
		return errors.New("selected lifecycle profile has no enrolled Agent identity")
	}
	if confirmation == "" {
		answer, err := host.Prompt(
			fmt.Sprintf("Permanent and irreversible. Type the stable subject %s to retire this Agent", state.Identity.Subject),
			false,
		)
		if err != nil {
			return err
		}
		confirmation = answer.Value
	}
	if confirmation != state.Identity.Subject {
		return host.Response(http.StatusOK, nil, map[string]any{"status": "cancelled", "identityChanged": false})
	}
	path := fmt.Sprintf("/api/agents/%s/retirement", url.PathEscape(state.Identity.ID))
	if err := lifecycleJSON(host, states, profile, http.MethodPut, path, nil, nil); err != nil {
		return fmt.Errorf("retire Agent identity: %w", err)
	}
	if err := profiles.Complete(profile.Name, lifecycleCompletion{
		Kind: "identity_retirement", ResourceID: state.Identity.ID,
	}); err != nil {
		return err
	}
	if err := removeLocalLifecycleProfile(states, profiles, profile); err != nil {
		return err
	}
	return host.Response(http.StatusOK, nil, map[string]any{
		"agentId": state.Identity.ID, "status": "retired", "localState": "removed",
	})
}

func removeLocalLifecycleProfile(
	states *fileStateStore,
	profiles *lifecycleProfileStore,
	profile lifecycleProfile,
) error {
	stateErr := states.Delete(profile.target())
	profileErr := profiles.Delete(profile.Name)
	return errors.Join(stateErr, profileErr)
}

func lifecycleJSON(
	host authCommandHost,
	states *fileStateStore,
	profile lifecycleProfile,
	method string,
	path string,
	body any,
	output any,
) error {
	state, err := states.Load(profile.target())
	if err != nil {
		return err
	}
	configuration, err := discoverAgentConfiguration(context.Background(), newHTTPClient(), profile.Origin)
	if err != nil {
		return err
	}
	state, credential, err := ensurePlatformCredential(
		context.Background(), states, newHTTPClient(), profile.target(), state, configuration,
	)
	if err != nil {
		return err
	}
	uri := strings.TrimSuffix(profile.Origin, "/") + path
	proof, err := signDPoPProof(credential.PrivateKey, method, uri, credential.AccessToken, time.Now())
	if err != nil {
		return err
	}
	response, err := host.Do(&plugin.HTTPRequestMsg{
		Method: method, URI: uri, Body: body, ContentType: "application/json", NoCache: true, Timeout: 30,
		Headers: map[string]string{"Authorization": "DPoP " + credential.AccessToken, "DPoP": proof},
	})
	if err != nil {
		return err
	}
	if response.Error != "" {
		return errors.New(response.Error)
	}
	if response.Status < 200 || response.Status >= 300 {
		return fmt.Errorf("Realmroot returned HTTP %d: %s", response.Status, responseErrorMessage(response.Body))
	}
	if output == nil {
		return nil
	}
	encoded, err := json.Marshal(response.Body)
	if err != nil {
		return fmt.Errorf("encode Realmroot response: %w", err)
	}
	if err := json.Unmarshal(encoded, output); err != nil {
		return fmt.Errorf("decode Realmroot response: %w", err)
	}
	_ = state
	return nil
}

func responseErrorMessage(body any) string {
	encoded, err := json.Marshal(body)
	if err != nil {
		return "request failed"
	}
	var envelope struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(encoded, &envelope) == nil && envelope.Error.Message != "" {
		return envelope.Error.Message
	}
	return "request failed"
}

func selectedState(
	states *fileStateStore,
	profiles *lifecycleProfileStore,
	name string,
) (lifecycleProfile, agentState, error) {
	profile, err := profiles.Selected(name)
	if err != nil {
		return lifecycleProfile{}, agentState{}, err
	}
	state, err := states.Load(profile.target())
	if err != nil {
		return lifecycleProfile{}, agentState{}, err
	}
	return profile, state, nil
}

func writeStatus(host authCommandHost, profile lifecycleProfile, state agentState, remote *agentSelfStatusResponse) error {
	localStatus := "pending"
	if state.Identity != nil {
		localStatus = "authenticated"
	}
	result := map[string]any{
		"profile":    profile.Name,
		"api":        profile.API,
		"apiProfile": profile.APIProfile,
		"issuer":     profile.Issuer,
		"local": map[string]any{
			"status":                  localStatus,
			"runtime":                 profile.Runtime,
			"session":                 agentSession(),
			"resourceCredentialCount": len(state.DPoPCredentials),
		},
	}
	if state.Identity != nil {
		identityName := state.Identity.Name
		if identityName == "" {
			identityName = state.Name
		}
		result["agent"] = map[string]any{
			"id": state.Identity.ID, "issuer": state.Identity.Issuer,
			"subject": state.Identity.Subject, "name": identityName,
		}
	}
	if remote != nil {
		result["remote"] = remote
	}
	return host.Response(http.StatusOK, nil, result)
}

func localProfileView(profile lifecycleProfile, current bool, state *agentState) map[string]any {
	view := map[string]any{
		"name": profile.Name, "current": current, "api": profile.API,
		"apiProfile": profile.APIProfile, "issuer": profile.Issuer, "runtime": profile.Runtime,
		"localState": "logged_out",
	}
	if state != nil {
		view["localState"] = "pending"
		if state.Identity != nil {
			identityName := state.Identity.Name
			if identityName == "" {
				identityName = state.Name
			}
			view["localState"] = "authenticated"
			view["agent"] = map[string]any{
				"id": state.Identity.ID, "subject": state.Identity.Subject, "name": identityName,
			}
		}
	}
	return view
}

func validateLifecycleProfileName(value string) error {
	if value == "" || len(value) > 64 {
		return errors.New("lifecycle profile name must contain 1 to 64 characters")
	}
	for _, character := range value {
		if (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') ||
			(character >= '0' && character <= '9') || character == '.' || character == '_' || character == '-' {
			continue
		}
		return errors.New("lifecycle profile name must contain only letters, numbers, dots, underscores, or hyphens")
	}
	return nil
}

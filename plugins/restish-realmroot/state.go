package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	stateDirectoryEnv = "REALMROOT_PLUGIN_STATE_DIR"
	agentStateVersion = 16
	hostStateVersion  = 1
	identityDirectory = "identities"
	hostDirectory     = "hosts"
)

type agentTarget struct {
	API     string
	Profile string
	Runtime string
	Origin  string
	Issuer  string
}

type stableIdentity struct {
	ID      string `json:"id"`
	Issuer  string `json:"issuer"`
	Subject string `json:"subject"`
}

type pendingApproval struct {
	VerificationURIComplete string     `json:"verification_uri_complete"`
	ExpiresAt               *time.Time `json:"expires_at,omitempty"`
	IntervalSeconds         int        `json:"interval_seconds"`
}

type dpopCredential struct {
	ResourceIndicator    string           `json:"resource_indicator"`
	AuthorizationDetails []map[string]any `json:"authorization_details,omitempty"`
	CredentialEndpoint   string           `json:"credential_endpoint"`
	ProofTarget          string           `json:"proof_target"`
	PrivateKey           string           `json:"private_key,omitempty"`
	AccessToken          string           `json:"access_token,omitempty"`
	ExpiresAt            *time.Time       `json:"expires_at,omitempty"`
	Scopes               []string         `json:"scopes,omitempty"`
}

type credentialSource struct {
	ResourceIndicator    string           `json:"resource_indicator"`
	AuthorizationDetails []map[string]any `json:"authorization_details,omitempty"`
	Offers               []dpopCredential `json:"offers"`
}

type agentState struct {
	Version                  int                         `json:"version"`
	Origin                   string                      `json:"origin"`
	Issuer                   string                      `json:"issuer"`
	Runtime                  string                      `json:"runtime"`
	Name                     string                      `json:"name"`
	AgentID                  string                      `json:"agent_id"`
	HostID                   string                      `json:"host_id"`
	AgentKeyID               string                      `json:"agent_key_id"`
	AgentPrivateKey          string                      `json:"agent_private_key"`
	RegistrationApproval     *pendingApproval            `json:"registration_approval,omitempty"`
	Identity                 *stableIdentity             `json:"identity,omitempty"`
	CredentialSources        map[string]credentialSource `json:"credential_sources,omitempty"`
	ProtocolCredential       *dpopCredential             `json:"protocol_credential,omitempty"`
	LegacyPlatformCredential *dpopCredential             `json:"platform_credential,omitempty"`
}

type hostState struct {
	Version        int    `json:"version"`
	Issuer         string `json:"issuer"`
	HostID         string `json:"host_id"`
	HostKeyID      string `json:"host_key_id"`
	HostPrivateKey string `json:"host_private_key"`
}

type stateStore interface {
	Create(target agentTarget, state agentState) (string, error)
	Load(target agentTarget) (agentState, error)
	Update(target agentTarget, state agentState) error
	CreateHost(target agentTarget, state hostState) (string, error)
	LoadHost(target agentTarget) (hostState, error)
}

type agentStateFinder interface {
	FindByOriginAndAgentID(origin string, agentID string) (agentState, error)
}

type resourceStateFinder interface {
	FindByOriginAndIdentityID(origin string, identityID string) (agentState, error)
}

type agentStateReference struct {
	path  string
	state agentState
}

type resourceAccessStateStore interface {
	FindReferenceByOriginIdentityRuntime(origin string, identityID string, runtime string) (agentStateReference, error)
	UpdateStateReference(reference agentStateReference) error
}

type resourceCredentialReference struct {
	path       string
	state      agentState
	reference  string
	credential dpopCredential
}

type credentialOfferStore interface {
	FindCredentialOffer(reference string, runtime string, scopes []string) (resourceCredentialReference, error)
	RemoveCredentialOffer(reference resourceCredentialReference) error
}

type fileStateStore struct {
	root string
}

func newFileStateStore() *fileStateStore {
	root := os.Getenv(stateDirectoryEnv)
	if root == "" {
		configDir, err := os.UserConfigDir()
		if err != nil {
			panic(fmt.Sprintf("resolve user config directory: %v", err))
		}
		root = filepath.Join(configDir, "restish", "plugins", "realmroot", "agents")
	}
	return &fileStateStore{root: root}
}

func (s *fileStateStore) Create(target agentTarget, state agentState) (string, error) {
	state.Version = agentStateVersion
	state.Origin = target.Origin
	state.Issuer = target.Issuer
	state.Runtime = target.Runtime
	return s.createPath(s.path(target), state)
}

func (s *fileStateStore) createPath(path string, state agentState) (string, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", fmt.Errorf("create Agent state directory: %w", err)
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return "", fmt.Errorf("encode Agent state: %w", err)
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return "", fmt.Errorf("create Agent state: %w", err)
	}
	if _, err := file.Write(append(data, '\n')); err != nil {
		_ = file.Close()
		return "", fmt.Errorf("write Agent state: %w", err)
	}
	if err := file.Close(); err != nil {
		return "", fmt.Errorf("close Agent state: %w", err)
	}
	return path, nil
}

func (s *fileStateStore) Load(target agentTarget) (agentState, error) {
	path := s.path(target)
	state, err := s.loadPath(path)
	if err == nil {
		if err := validateAgentState(state, target); err != nil {
			return agentState{}, err
		}
		if state.Origin != target.Origin {
			state.Origin = target.Origin
			if err := s.updatePath(path, state); err != nil {
				return agentState{}, fmt.Errorf("update Agent state origin: %w", err)
			}
		}
		return state, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return agentState{}, err
	}
	return agentState{}, os.ErrNotExist
}

func (s *fileStateStore) CreateHost(target agentTarget, state hostState) (string, error) {
	state.Version = hostStateVersion
	state.Issuer = target.Issuer
	if err := validateHostState(state, target); err != nil {
		return "", err
	}
	return s.createHostPath(s.hostPath(target), state)
}

func (s *fileStateStore) LoadHost(target agentTarget) (hostState, error) {
	path := s.hostPath(target)
	info, err := os.Lstat(path)
	if err != nil {
		return hostState{}, fmt.Errorf("read Host state metadata: %w", err)
	}
	if !info.Mode().IsRegular() {
		return hostState{}, errors.New("Host state must be a regular file")
	}
	if info.Mode().Perm()&0o077 != 0 {
		return hostState{}, fmt.Errorf("Host state %s must not be accessible by group or other users", path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return hostState{}, fmt.Errorf("read Host state: %w", err)
	}
	var state hostState
	if err := json.Unmarshal(data, &state); err != nil {
		return hostState{}, fmt.Errorf("decode Host state: %w", err)
	}
	if err := validateHostState(state, target); err != nil {
		return hostState{}, err
	}
	return state, nil
}

func (s *fileStateStore) createHostPath(path string, state hostState) (string, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", fmt.Errorf("create Host state directory: %w", err)
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return "", fmt.Errorf("encode Host state: %w", err)
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return "", fmt.Errorf("create Host state: %w", err)
	}
	if _, err := file.Write(append(data, '\n')); err != nil {
		_ = file.Close()
		return "", fmt.Errorf("write Host state: %w", err)
	}
	if err := file.Close(); err != nil {
		return "", fmt.Errorf("close Host state: %w", err)
	}
	return path, nil
}

func (s *fileStateStore) loadPath(path string) (agentState, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return agentState{}, fmt.Errorf("read Agent state metadata: %w", err)
	}
	if !info.Mode().IsRegular() {
		return agentState{}, errors.New("Agent state must be a regular file")
	}
	if info.Mode().Perm()&0o077 != 0 {
		return agentState{}, fmt.Errorf("Agent state %s must not be accessible by group or other users", path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return agentState{}, fmt.Errorf("read Agent state: %w", err)
	}
	var state agentState
	if err := json.Unmarshal(data, &state); err != nil {
		return agentState{}, fmt.Errorf("decode Agent state: %w", err)
	}
	if state.Version == 14 || state.Version == 15 {
		state.Version = agentStateVersion
		state.CredentialSources = nil
		state.ProtocolCredential = nil
		if err := s.updatePath(path, state); err != nil {
			return agentState{}, fmt.Errorf("migrate Agent state: %w", err)
		}
	}
	return state, nil
}

func (s *fileStateStore) Update(target agentTarget, state agentState) error {
	state.Version = agentStateVersion
	state.Origin = target.Origin
	state.Issuer = target.Issuer
	state.Runtime = target.Runtime
	return s.updatePath(s.path(target), state)
}

func (s *fileStateStore) updatePath(path string, state agentState) error {
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("encode Agent state: %w", err)
	}
	temp, err := os.CreateTemp(filepath.Dir(path), ".agent-*.json")
	if err != nil {
		return fmt.Errorf("create temporary Agent state: %w", err)
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0o600); err != nil {
		_ = temp.Close()
		return fmt.Errorf("protect temporary Agent state: %w", err)
	}
	if _, err := temp.Write(append(data, '\n')); err != nil {
		_ = temp.Close()
		return fmt.Errorf("write temporary Agent state: %w", err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("close temporary Agent state: %w", err)
	}
	if err := os.Rename(tempPath, path); err != nil {
		return fmt.Errorf("replace Agent state: %w", err)
	}
	return nil
}

func (s *fileStateStore) FindCredentialOffer(reference string, runtime string, scopes []string) (resourceCredentialReference, error) {
	var matched *resourceCredentialReference
	err := s.walkStates(func(path string, state agentState) error {
		if state.Runtime != runtime {
			return nil
		}
		source, ok := state.CredentialSources[reference]
		if !ok {
			return nil
		}
		var offer *dpopCredential
		for index := range source.Offers {
			if scopesContain(source.Offers[index].Scopes, scopes) &&
				(offer == nil || len(source.Offers[index].Scopes) < len(offer.Scopes)) {
				offer = &source.Offers[index]
			}
		}
		if offer == nil {
			return nil
		}
		if matched != nil {
			return errors.New("multiple Realmroot credential offers match the source reference")
		}
		matched = &resourceCredentialReference{path: path, state: state, reference: reference, credential: *offer}
		return nil
	})
	if err != nil {
		return resourceCredentialReference{}, fmt.Errorf("find Realmroot credential offer: %w", err)
	}
	if matched == nil {
		return resourceCredentialReference{}, os.ErrNotExist
	}
	return *matched, nil
}

func (s *fileStateStore) RemoveCredentialOffer(reference resourceCredentialReference) error {
	source, ok := reference.state.CredentialSources[reference.reference]
	if !ok {
		return os.ErrNotExist
	}
	remaining := make([]dpopCredential, 0, len(source.Offers))
	removed := false
	for _, offer := range source.Offers {
		if !removed && sameCredentialOffer(offer, reference.credential) {
			removed = true
			continue
		}
		remaining = append(remaining, offer)
	}
	if !removed {
		return os.ErrNotExist
	}
	if len(remaining) == 0 {
		delete(reference.state.CredentialSources, reference.reference)
	} else {
		source.Offers = remaining
		reference.state.CredentialSources[reference.reference] = source
	}
	return s.UpdateStateReference(agentStateReference{path: reference.path, state: reference.state})
}

func sameCredentialOffer(left dpopCredential, right dpopCredential) bool {
	return left.ResourceIndicator == right.ResourceIndicator &&
		sameAuthorizationDetails(left.AuthorizationDetails, right.AuthorizationDetails) &&
		left.CredentialEndpoint == right.CredentialEndpoint &&
		left.ProofTarget == right.ProofTarget &&
		sameStringSet(left.Scopes, right.Scopes)
}

func (s *fileStateStore) FindByOriginAndAgentID(origin string, agentID string) (agentState, error) {
	return s.find(origin, func(state agentState) bool { return state.AgentID == agentID }, "Agent interaction")
}

func (s *fileStateStore) FindByOriginAndIdentityID(origin string, identityID string) (agentState, error) {
	return s.find(
		origin,
		func(state agentState) bool { return state.Identity != nil && state.Identity.ID == identityID },
		"resource request",
	)
}

func (s *fileStateStore) FindReferenceByOriginIdentityRuntime(
	origin string,
	identityID string,
	runtime string,
) (agentStateReference, error) {
	var matched *agentStateReference
	err := s.walkStates(func(path string, state agentState) error {
		if state.Origin != origin || state.Runtime != runtime || state.Identity == nil || state.Identity.ID != identityID {
			return nil
		}
		if matched != nil {
			return errors.New("multiple Agent states match the resource request")
		}
		matched = &agentStateReference{path: path, state: state}
		return nil
	})
	if err != nil {
		return agentStateReference{}, fmt.Errorf("find Agent state for resource request: %w", err)
	}
	if matched == nil {
		return agentStateReference{}, os.ErrNotExist
	}
	return *matched, nil
}

func (s *fileStateStore) UpdateStateReference(reference agentStateReference) error {
	return s.updatePath(reference.path, reference.state)
}

func (s *fileStateStore) find(origin string, matches func(agentState) bool, label string) (agentState, error) {
	var matched *agentState
	err := s.walkStates(func(_ string, state agentState) error {
		if state.Origin != origin || !matches(state) {
			return nil
		}
		if matched != nil {
			return fmt.Errorf("multiple local Agent states match the %s", label)
		}
		matched = &state
		return nil
	})
	if err != nil {
		return agentState{}, fmt.Errorf("find local Agent state: %w", err)
	}
	if matched == nil {
		return agentState{}, fmt.Errorf("local Agent state was not found for the %s", label)
	}
	return *matched, nil
}

func (s *fileStateStore) walkStates(visit func(path string, state agentState) error) error {
	return filepath.WalkDir(s.root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			if errors.Is(walkErr, os.ErrNotExist) {
				return nil
			}
			return walkErr
		}
		if entry.IsDir() || filepath.Ext(path) != ".json" {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		var state agentState
		if err := json.Unmarshal(data, &state); err != nil {
			return nil
		}
		if state.Version > 0 &&
			state.Version < agentStateVersion &&
			state.Issuer != "" &&
			state.Runtime != "" {
			state, err = s.loadPath(path)
			if err != nil {
				return err
			}
		}
		if state.Version != agentStateVersion {
			return nil
		}
		if err := validateAgentStateCredentials(state); err != nil {
			return err
		}
		return visit(path, state)
	})
}

func (s *fileStateStore) path(target agentTarget) string {
	return filepath.Join(
		s.root,
		identityDirectory,
		encodeStatePathPart(target.Issuer),
		encodeStatePathPart(target.Runtime)+".json",
	)
}

func (s *fileStateStore) hostPath(target agentTarget) string {
	return filepath.Join(s.root, hostDirectory, encodeStatePathPart(target.Issuer)+".json")
}

func encodeStatePathPart(value string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(value))
}

func validateAgentState(state agentState, target agentTarget) error {
	if state.Version != agentStateVersion {
		return fmt.Errorf("unsupported Agent state version %d", state.Version)
	}
	if state.Issuer != target.Issuer {
		return fmt.Errorf("Agent state issuer %q does not match discovered issuer %q", state.Issuer, target.Issuer)
	}
	if state.Runtime != target.Runtime {
		return fmt.Errorf("Agent state runtime %q does not match current runtime %q", state.Runtime, target.Runtime)
	}
	return validateAgentStateCredentials(state)
}

func validateAgentStateCredentials(state agentState) error {
	if state.AgentID == "" || state.HostID == "" || state.AgentKeyID == "" {
		return errors.New("Agent state is missing protocol identifiers")
	}
	key, err := base64.RawURLEncoding.DecodeString(state.AgentPrivateKey)
	if err != nil || len(key) != ed25519.PrivateKeySize {
		return errors.New("Agent private key is invalid")
	}
	authorizationContexts := make(map[string]string, len(state.CredentialSources))
	for reference, source := range state.CredentialSources {
		if !isCredentialSourceReference(reference) || source.ResourceIndicator == "" || len(source.Offers) == 0 {
			return errors.New("Agent state contains invalid DPoP credential metadata")
		}
		contextKey, err := authorizationContextKey(source.ResourceIndicator, source.AuthorizationDetails)
		if err != nil {
			return fmt.Errorf("Agent state authorization details are invalid: %w", err)
		}
		if existingReference, exists := authorizationContexts[contextKey]; exists {
			return fmt.Errorf(
				"Agent state credential sources %q and %q address the same authorization context",
				existingReference,
				reference,
			)
		}
		authorizationContexts[contextKey] = reference
		if _, err := validatedAbsoluteURL(source.ResourceIndicator); err != nil {
			return fmt.Errorf("Agent state DPoP resource URL is invalid: %w", err)
		}
		for _, credential := range source.Offers {
			if credential.ResourceIndicator != source.ResourceIndicator ||
				!sameAuthorizationDetails(credential.AuthorizationDetails, source.AuthorizationDetails) ||
				credential.CredentialEndpoint == "" || credential.ProofTarget == "" {
				return errors.New("Agent state contains invalid DPoP credential metadata")
			}
			if _, err := validatedAbsoluteURL(credential.ResourceIndicator); err != nil {
				return fmt.Errorf("Agent state DPoP resource URL is invalid: %w", err)
			}
			if _, err := validatedAbsoluteURL(credential.CredentialEndpoint); err != nil {
				return fmt.Errorf("Agent state credential endpoint is invalid: %w", err)
			}
			if _, err := validatedAbsoluteURL(credential.ProofTarget); err != nil {
				return fmt.Errorf("Agent state credential proof target is invalid: %w", err)
			}
			if credential.PrivateKey != "" || credential.AccessToken != "" || credential.ExpiresAt != nil {
				return errors.New("Agent state credential offers must not contain target key or token material")
			}
		}
	}
	if state.LegacyPlatformCredential != nil {
		return errors.New("Agent state contains a legacy platform credential")
	}
	if state.ProtocolCredential != nil {
		credential := state.ProtocolCredential
		if credential.ResourceIndicator == "" || credential.CredentialEndpoint == "" || credential.ProofTarget == "" {
			return errors.New("Agent state contains invalid Agent protocol OAuth credential metadata")
		}
		if _, err := decodeDPoPPrivateKey(credential.PrivateKey); err != nil {
			return fmt.Errorf("Agent state protocol OAuth credential is invalid: %w", err)
		}
		if (credential.AccessToken == "") != (credential.ExpiresAt == nil) {
			return errors.New("Agent state contains an incomplete Agent protocol OAuth credential")
		}
	}
	return nil
}

func authorizationContextKey(resourceIndicator string, details []map[string]any) (string, error) {
	entries := make([]string, 0, len(details))
	for _, detail := range details {
		encoded, err := json.Marshal(detail)
		if err != nil {
			return "", err
		}
		entries = append(entries, string(encoded))
	}
	sort.Strings(entries)
	return resourceIndicator + "\x00" + strings.Join(entries, "\x00"), nil
}

func sameAuthorizationDetails(left, right []map[string]any) bool {
	leftKey, leftErr := authorizationContextKey("", left)
	rightKey, rightErr := authorizationContextKey("", right)
	return leftErr == nil && rightErr == nil && leftKey == rightKey
}

func validateHostState(state hostState, target agentTarget) error {
	if state.Version != hostStateVersion {
		return fmt.Errorf("unsupported Host state version %d", state.Version)
	}
	if state.Issuer != target.Issuer {
		return fmt.Errorf("Host state issuer %q does not match discovered issuer %q", state.Issuer, target.Issuer)
	}
	if state.HostID == "" || state.HostKeyID == "" {
		return errors.New("Host state is missing protocol identifiers")
	}
	key, err := base64.RawURLEncoding.DecodeString(state.HostPrivateKey)
	if err != nil || len(key) != ed25519.PrivateKeySize {
		return errors.New("Host private key is invalid")
	}
	return nil
}

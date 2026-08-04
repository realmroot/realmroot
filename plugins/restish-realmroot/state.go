package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofrs/flock"
)

const (
	stateDirectoryEnv = "REALMROOT_PLUGIN_STATE_DIR"
	agentStateVersion = 9
	identityDirectory = "identities"
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
	Name    string `json:"name,omitempty"`
}

type pendingApproval struct {
	VerificationURIComplete string     `json:"verification_uri_complete"`
	ExpiresAt               *time.Time `json:"expires_at,omitempty"`
	IntervalSeconds         int        `json:"interval_seconds"`
}

type dpopCredential struct {
	ResourceHref       string     `json:"resource_href"`
	ResourceIndicator  string     `json:"resource_indicator"`
	CredentialEndpoint string     `json:"credential_endpoint"`
	ProofTarget        string     `json:"proof_target"`
	PrivateKey         string     `json:"private_key"`
	AccessToken        string     `json:"access_token,omitempty"`
	ExpiresAt          *time.Time `json:"expires_at,omitempty"`
}

type agentState struct {
	Version               int                       `json:"version"`
	Origin                string                    `json:"origin"`
	Issuer                string                    `json:"issuer"`
	Runtime               string                    `json:"runtime"`
	Name                  string                    `json:"name"`
	AgentID               string                    `json:"agent_id"`
	HostID                string                    `json:"host_id"`
	AgentKeyID            string                    `json:"agent_key_id"`
	HostKeyID             string                    `json:"host_key_id"`
	AgentPrivateKey       string                    `json:"agent_private_key"`
	HostPrivateKey        string                    `json:"host_private_key"`
	RegistrationApproval  *pendingApproval          `json:"registration_approval,omitempty"`
	Identity              *stableIdentity           `json:"identity,omitempty"`
	RecoveryIdentity      *stableIdentity           `json:"recovery_identity,omitempty"`
	DPoPCredentials       map[string]dpopCredential `json:"dpop_credentials,omitempty"`
	ActiveDPoPCredentials map[string]string         `json:"active_dpop_credentials,omitempty"`
	PlatformCredential    *dpopCredential           `json:"platform_credential,omitempty"`
	snapshot              [sha256.Size]byte
}

type stateStore interface {
	Create(target agentTarget, state agentState) (string, error)
	Load(target agentTarget) (agentState, error)
	Update(target agentTarget, state agentState) error
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
	credential dpopCredential
}

type resourceCredentialStore interface {
	FindByResourceURL(resourceURL string, runtime string, issuer string) (resourceCredentialReference, error)
	UpdateCredential(reference resourceCredentialReference, credential dpopCredential) error
	DeleteCredential(reference resourceCredentialReference) error
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
	path := s.path(target)
	var created string
	err := withStateFileLock(path, func() error {
		var err error
		created, err = s.createPath(path, state)
		return err
	})
	return created, err
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
	var state agentState
	err := withStateFileLock(path, func() error {
		loaded, err := s.loadPath(path)
		if errors.Is(err, os.ErrNotExist) {
			loaded, err = s.migrateLegacy(target)
		}
		if err == nil && loaded.Origin != target.Origin {
			loaded.Origin = target.Origin
			if err := s.updateExistingPath(path, loaded); err != nil {
				return fmt.Errorf("update Agent state origin: %w", err)
			}
			loaded, err = s.loadPath(path)
		}
		state = loaded
		return err
	})
	if err == nil {
		if err := validateAgentState(state, target); err != nil {
			return agentState{}, err
		}
		return state, nil
	}
	return agentState{}, err
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
	if state.Version > 0 && state.Version < agentStateVersion {
		if state.Version < 7 {
			state.DPoPCredentials = nil
			state.ActiveDPoPCredentials = nil
		}
		state.PlatformCredential = nil
		state.Version = agentStateVersion
		if err := s.updatePath(path, state); err != nil {
			return agentState{}, fmt.Errorf("upgrade Agent state: %w", err)
		}
		return s.loadPath(path)
	}
	state.snapshot = sha256.Sum256(data)
	return state, nil
}

func (s *fileStateStore) Update(target agentTarget, state agentState) error {
	state.Version = agentStateVersion
	state.Origin = target.Origin
	state.Issuer = target.Issuer
	state.Runtime = target.Runtime
	path := s.path(target)
	return withStateFileLock(path, func() error { return s.updateExistingPath(path, state) })
}

func (s *fileStateStore) Delete(target agentTarget) error {
	path := s.path(target)
	return withStateFileLock(path, func() error {
		if err := os.Remove(path); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return nil
			}
			return fmt.Errorf("remove local Agent state: %w", err)
		}
		return nil
	})
}

type legacyState struct {
	path  string
	state agentState
}

func (s *fileStateStore) migrateLegacy(target agentTarget) (agentState, error) {
	states, err := s.legacyStates()
	if err != nil {
		return agentState{}, err
	}
	exactPath := s.legacyPath(target)
	var exactPending *legacyState
	var completed []legacyState
	var pending []legacyState
	for _, candidate := range states {
		if candidate.state.Identity != nil && candidate.state.Identity.Issuer == target.Issuer {
			if candidate.path == exactPath {
				return s.migrateState(target, candidate)
			}
			completed = append(completed, candidate)
			continue
		}
		if candidate.state.Identity == nil && candidate.state.Origin == target.Origin {
			if candidate.path == exactPath {
				value := candidate
				exactPending = &value
			}
			pending = append(pending, candidate)
		}
	}
	if len(completed) == 1 {
		return s.migrateState(target, completed[0])
	}
	if len(completed) > 1 {
		return agentState{}, fmt.Errorf(
			"multiple local Agent identities match issuer %q; invoke an existing Restish API name first to select its identity",
			target.Issuer,
		)
	}
	if exactPending != nil {
		return s.migrateState(target, *exactPending)
	}
	if len(pending) == 1 {
		return s.migrateState(target, pending[0])
	}
	if len(pending) > 1 {
		return agentState{}, fmt.Errorf("multiple pending local Agent registrations match origin %q", target.Origin)
	}
	return agentState{}, os.ErrNotExist
}

func (s *fileStateStore) migrateState(target agentTarget, candidate legacyState) (agentState, error) {
	state := candidate.state
	state.Version = agentStateVersion
	state.Origin = target.Origin
	state.Issuer = target.Issuer
	state.Runtime = target.Runtime
	path := s.path(target)
	if _, err := s.createPath(path, state); err != nil {
		return agentState{}, fmt.Errorf("migrate Agent state: %w", err)
	}
	if err := os.Remove(candidate.path); err != nil {
		return agentState{}, fmt.Errorf("remove migrated Agent state %s: %w", candidate.path, err)
	}
	state, err := s.loadPath(path)
	if err != nil {
		return agentState{}, err
	}
	if err := validateAgentState(state, target); err != nil {
		return agentState{}, err
	}
	return state, nil
}

func (s *fileStateStore) legacyStates() ([]legacyState, error) {
	var states []legacyState
	err := filepath.WalkDir(s.root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			if errors.Is(walkErr, os.ErrNotExist) {
				return nil
			}
			return walkErr
		}
		if entry.IsDir() {
			if path == filepath.Join(s.root, identityDirectory) {
				return filepath.SkipDir
			}
			return nil
		}
		if path == filepath.Join(s.root, lifecycleProfilesFilename) ||
			path == filepath.Join(s.root, identityDirectory, lifecycleProfilesFilename) {
			return nil
		}
		if filepath.Ext(path) != ".json" {
			return nil
		}
		state, err := s.loadPathWithLock(path)
		if err != nil {
			return err
		}
		if state.Version != 2 && state.Version != agentStateVersion {
			return fmt.Errorf("unsupported Agent state version %d", state.Version)
		}
		if err := validateAgentStateCredentials(state); err != nil {
			return err
		}
		states = append(states, legacyState{path: path, state: state})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("read legacy Agent states: %w", err)
	}
	return states, nil
}

func (s *fileStateStore) updatePath(path string, state agentState) error {
	state.snapshot = [sha256.Size]byte{}
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

func (s *fileStateStore) updateExistingPath(path string, state agentState) error {
	current, err := s.loadPath(path)
	if err != nil {
		return err
	}
	if state.snapshot == [sha256.Size]byte{} || state.snapshot != current.snapshot {
		return errors.New("Agent state changed concurrently; retry the operation")
	}
	return s.updatePath(path, state)
}

func (s *fileStateStore) loadPathWithLock(path string) (agentState, error) {
	var state agentState
	err := withStateFileLock(path, func() error {
		var err error
		state, err = s.loadPath(path)
		return err
	})
	return state, err
}

func withStateFileLock(path string, operation func() error) (result error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create Agent state directory: %w", err)
	}
	lock := flock.New(path + ".lock")
	if err := lock.Lock(); err != nil {
		return fmt.Errorf("lock Agent state: %w", err)
	}
	defer func() {
		if err := lock.Unlock(); err != nil {
			result = errors.Join(result, fmt.Errorf("unlock Agent state: %w", err))
		}
	}()
	return operation()
}

func (s *fileStateStore) FindByResourceURL(resourceURL string, runtime string, issuer string) (resourceCredentialReference, error) {
	var matched *resourceCredentialReference
	matchedPriority := 0
	err := s.walkStates(func(path string, state agentState) error {
		if state.Runtime != runtime || (issuer != "" && strings.TrimSuffix(state.Issuer, "/") != issuer) {
			return nil
		}
		for selectionKey, resourceHref := range state.ActiveDPoPCredentials {
			registeredURL, priority, selected := selectedResourceURL(selectionKey)
			if !selected {
				continue
			}
			if !resourceURLMatches(registeredURL, resourceURL) {
				continue
			}
			credential, ok := state.DPoPCredentials[resourceHref]
			if !ok {
				return errors.New("active target credential is missing its Resource state")
			}
			if matched != nil && len(matched.credential.ResourceIndicator) == len(registeredURL) {
				if priority < matchedPriority || (priority == matchedPriority && credential.ResourceHref == matched.credential.ResourceHref) {
					continue
				}
				if priority == matchedPriority {
					return errors.New("multiple local DPoP credentials match the target API request")
				}
			}
			if matched == nil || len(registeredURL) > len(matched.credential.ResourceIndicator) ||
				(len(registeredURL) == len(matched.credential.ResourceIndicator) && priority > matchedPriority) {
				value := resourceCredentialReference{path: path, state: state, credential: credential}
				matched = &value
				matchedPriority = priority
			}
		}
		return nil
	})
	if err != nil {
		return resourceCredentialReference{}, fmt.Errorf("find target API DPoP credential: %w", err)
	}
	if matched == nil {
		return resourceCredentialReference{}, os.ErrNotExist
	}
	return *matched, nil
}

func (s *fileStateStore) UpdateCredential(reference resourceCredentialReference, credential dpopCredential) error {
	if reference.state.DPoPCredentials == nil {
		reference.state.DPoPCredentials = make(map[string]dpopCredential)
	}
	reference.state.DPoPCredentials[credential.ResourceHref] = credential
	return withStateFileLock(reference.path, func() error { return s.updateExistingPath(reference.path, reference.state) })
}

func (s *fileStateStore) DeleteCredential(reference resourceCredentialReference) error {
	delete(reference.state.DPoPCredentials, reference.credential.ResourceHref)
	for key, resourceHref := range reference.state.ActiveDPoPCredentials {
		if resourceHref == reference.credential.ResourceHref {
			delete(reference.state.ActiveDPoPCredentials, key)
		}
	}
	return withStateFileLock(reference.path, func() error { return s.updateExistingPath(reference.path, reference.state) })
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
	return withStateFileLock(reference.path, func() error { return s.updateExistingPath(reference.path, reference.state) })
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
		if path == filepath.Join(s.root, lifecycleProfilesFilename) ||
			path == filepath.Join(s.root, identityDirectory, lifecycleProfilesFilename) {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
			return nil
		}
		state, err := s.loadPathWithLock(path)
		if err != nil {
			return err
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

func (s *fileStateStore) legacyPath(target agentTarget) string {
	return filepath.Join(
		s.root,
		encodeStatePathPart(target.API),
		encodeStatePathPart(target.Profile),
		encodeStatePathPart("default")+".json",
	)
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
	for label, identity := range map[string]*stableIdentity{
		"Agent identity": state.Identity, "Agent recovery identity": state.RecoveryIdentity,
	} {
		if identity == nil {
			continue
		}
		if identity.ID == "" || identity.Subject == "" || identity.Issuer != target.Issuer {
			return fmt.Errorf("%s does not match the selected issuer", label)
		}
	}
	if state.Identity != nil && state.RecoveryIdentity != nil &&
		(state.Identity.ID != state.RecoveryIdentity.ID ||
			state.Identity.Subject != state.RecoveryIdentity.Subject ||
			state.Identity.Issuer != state.RecoveryIdentity.Issuer) {
		return errors.New("Agent recovery identity does not match the stable Agent identity")
	}
	return validateAgentStateCredentials(state)
}

func validateAgentStateCredentials(state agentState) error {
	if state.AgentID == "" || state.HostID == "" || state.AgentKeyID == "" || state.HostKeyID == "" {
		return errors.New("Agent state is missing protocol identifiers")
	}
	for label, encoded := range map[string]string{
		"Agent private key": state.AgentPrivateKey,
		"Host private key":  state.HostPrivateKey,
	} {
		key, err := base64.RawURLEncoding.DecodeString(encoded)
		if err != nil || len(key) != ed25519.PrivateKeySize {
			return fmt.Errorf("%s is invalid", label)
		}
	}
	for resourceHref, credential := range state.DPoPCredentials {
		if resourceHref == "" || credential.ResourceHref != resourceHref || credential.ResourceIndicator == "" ||
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
		if _, err := decodeDPoPPrivateKey(credential.PrivateKey); err != nil {
			return err
		}
		if (credential.AccessToken == "") != (credential.ExpiresAt == nil) {
			return errors.New("Agent state contains an incomplete target API token")
		}
	}
	if state.PlatformCredential != nil {
		credential := state.PlatformCredential
		if credential.ResourceIndicator == "" || credential.CredentialEndpoint == "" || credential.ProofTarget == "" {
			return errors.New("Agent state contains invalid Realmroot OAuth credential metadata")
		}
		if _, err := decodeDPoPPrivateKey(credential.PrivateKey); err != nil {
			return fmt.Errorf("Agent state Realmroot OAuth credential is invalid: %w", err)
		}
		if (credential.AccessToken == "") != (credential.ExpiresAt == nil) {
			return errors.New("Agent state contains an incomplete Realmroot OAuth credential")
		}
	}
	for selectionKey, resourceHref := range state.ActiveDPoPCredentials {
		credential, ok := state.DPoPCredentials[resourceHref]
		if !ok || credential.ResourceIndicator != resourceURLFromSelectionKey(selectionKey) {
			return errors.New("Agent state contains an invalid active DPoP credential binding")
		}
	}
	return nil
}

func credentialSelectionKey(resourceURL string) string {
	return agentSession() + "\n" + resourceURL
}

func selectedResourceURL(selectionKey string) (string, int, bool) {
	session, resourceURL, found := strings.Cut(selectionKey, "\n")
	if !found {
		return selectionKey, 1, true
	}
	return resourceURL, 2, session == agentSession()
}

func resourceURLFromSelectionKey(selectionKey string) string {
	_, resourceURL, found := strings.Cut(selectionKey, "\n")
	if found {
		return resourceURL
	}
	return selectionKey
}

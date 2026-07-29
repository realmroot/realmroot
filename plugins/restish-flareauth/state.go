package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const stateDirectoryEnv = "FLAREAUTH_PLUGIN_STATE_DIR"

type agentTarget struct {
	API     string
	Profile string
	Name    string
	Origin  string
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

type agentState struct {
	Version              int              `json:"version"`
	Origin               string           `json:"origin"`
	Name                 string           `json:"name"`
	AgentID              string           `json:"agent_id"`
	HostID               string           `json:"host_id"`
	AgentKeyID           string           `json:"agent_key_id"`
	HostKeyID            string           `json:"host_key_id"`
	AgentPrivateKey      string           `json:"agent_private_key"`
	HostPrivateKey       string           `json:"host_private_key"`
	RegistrationApproval *pendingApproval `json:"registration_approval,omitempty"`
	Identity             *stableIdentity  `json:"identity,omitempty"`
}

type stateStore interface {
	Create(target agentTarget, state agentState) (string, error)
	Load(target agentTarget) (agentState, error)
	Update(target agentTarget, state agentState) error
}

type capabilityStateFinder interface {
	FindByOriginAndAgentID(origin string, agentID string) (agentState, error)
}

type resourceStateFinder interface {
	FindByOriginAndIdentityID(origin string, identityID string) (agentState, error)
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
		root = filepath.Join(configDir, "restish", "plugins", "flareauth", "agents")
	}
	return &fileStateStore{root: root}
}

func (s *fileStateStore) Create(target agentTarget, state agentState) (string, error) {
	path := s.path(target)
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
	if err := validateAgentState(state, target); err != nil {
		return agentState{}, err
	}
	return state, nil
}

func (s *fileStateStore) Update(target agentTarget, state agentState) error {
	path := s.path(target)
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

func (s *fileStateStore) FindByOriginAndAgentID(origin string, agentID string) (agentState, error) {
	return s.find(origin, func(state agentState) bool { return state.AgentID == agentID }, "capability request")
}

func (s *fileStateStore) FindByOriginAndIdentityID(origin string, identityID string) (agentState, error) {
	return s.find(
		origin,
		func(state agentState) bool { return state.Identity != nil && state.Identity.ID == identityID },
		"resource request",
	)
}

func (s *fileStateStore) find(origin string, matches func(agentState) bool, label string) (agentState, error) {
	var matched *agentState
	err := filepath.WalkDir(s.root, func(path string, entry os.DirEntry, walkErr error) error {
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
		if state.Origin != origin || !matches(state) {
			return nil
		}
		if err := validateAgentStateCredentials(state); err != nil {
			return err
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

func (s *fileStateStore) path(target agentTarget) string {
	encode := func(value string) string {
		return base64.RawURLEncoding.EncodeToString([]byte(value))
	}
	return filepath.Join(s.root, encode(target.API), encode(target.Profile), encode(target.Name)+".json")
}

func validateAgentState(state agentState, target agentTarget) error {
	if state.Version != 1 {
		return fmt.Errorf("unsupported Agent state version %d", state.Version)
	}
	if state.Origin != target.Origin {
		return fmt.Errorf("Agent state origin %q does not match Restish API origin %q", state.Origin, target.Origin)
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
	return nil
}

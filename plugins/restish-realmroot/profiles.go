package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/gofrs/flock"
)

const (
	authBindingsVersion  = 1
	authBindingsFilename = "bindings.json"
)

type rememberedIdentity struct {
	Origin   string         `json:"origin"`
	Issuer   string         `json:"issuer"`
	Runtime  string         `json:"runtime"`
	Identity stableIdentity `json:"identity"`
}

func (b rememberedIdentity) target() agentTarget {
	return agentTarget{Runtime: b.Runtime, Origin: b.Origin, Issuer: b.Issuer}
}

type authBindings struct {
	Version         int                           `json:"version"`
	FallbackRuntime string                        `json:"fallback_runtime,omitempty"`
	Accounts        map[string]rememberedIdentity `json:"accounts"`
}

type authBindingStore struct {
	path string
}

func newAuthBindingStore(states *fileStateStore) *authBindingStore {
	return &authBindingStore{path: filepath.Join(states.root, identityDirectory, authBindingsFilename)}
}

func authBindingKey(issuer string, runtime string) string {
	return issuer + "\n" + runtime
}

func (s *authBindingStore) Load() (authBindings, error) {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return authBindings{Version: authBindingsVersion, Accounts: map[string]rememberedIdentity{}}, nil
	}
	if err != nil {
		return authBindings{}, fmt.Errorf("read local Agent identity bindings: %w", err)
	}
	info, err := os.Lstat(s.path)
	if err != nil {
		return authBindings{}, fmt.Errorf("read local Agent identity binding metadata: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
		return authBindings{}, errors.New("local Agent identity bindings must be a private regular file")
	}
	var bindings authBindings
	if err := json.Unmarshal(data, &bindings); err != nil {
		return authBindings{}, fmt.Errorf("decode local Agent identity bindings: %w", err)
	}
	if bindings.Version != authBindingsVersion {
		return authBindings{}, fmt.Errorf("unsupported local Agent identity binding version %d", bindings.Version)
	}
	if bindings.Accounts == nil {
		bindings.Accounts = map[string]rememberedIdentity{}
	}
	if bindings.FallbackRuntime != "" {
		if normalized, err := normalizeAgentRuntime(bindings.FallbackRuntime); err != nil || normalized != bindings.FallbackRuntime {
			return authBindings{}, errors.New("local Agent identity bindings contain an invalid fallback runtime")
		}
	}
	for key, binding := range bindings.Accounts {
		if key != authBindingKey(binding.Issuer, binding.Runtime) {
			return authBindings{}, errors.New("local Agent identity binding key is invalid")
		}
		if err := validateRememberedIdentity(binding); err != nil {
			return authBindings{}, err
		}
	}
	return bindings, nil
}

func (s *authBindingStore) RuntimeFallback() (string, error) {
	bindings, err := s.Load()
	if err != nil {
		return "", err
	}
	return bindings.FallbackRuntime, nil
}

func (s *authBindingStore) SetRuntimeFallback(runtime string) error {
	normalized, err := normalizeAgentRuntime(runtime)
	if err != nil {
		return err
	}
	return s.mutate(func(bindings *authBindings) error {
		bindings.FallbackRuntime = normalized
		return nil
	})
}

func (s *authBindingStore) Find(issuer string, runtime string) (*rememberedIdentity, error) {
	bindings, err := s.Load()
	if err != nil {
		return nil, err
	}
	binding, ok := bindings.Accounts[authBindingKey(issuer, runtime)]
	if !ok {
		return nil, nil
	}
	return &binding, nil
}

func (s *authBindingStore) Put(binding rememberedIdentity) error {
	if err := validateRememberedIdentity(binding); err != nil {
		return err
	}
	return s.mutate(func(bindings *authBindings) error {
		key := authBindingKey(binding.Issuer, binding.Runtime)
		if existing, ok := bindings.Accounts[key]; ok &&
			(existing.Identity.ID != binding.Identity.ID || existing.Identity.Subject != binding.Identity.Subject) {
			return errors.New("Realmroot issuer and runtime are already bound to another stable Agent identity")
		}
		bindings.Accounts[key] = binding
		return nil
	})
}

func validateRememberedIdentity(binding rememberedIdentity) error {
	if _, err := validatedAbsoluteURL(binding.Origin); err != nil {
		return errors.New("local Agent identity binding origin is invalid")
	}
	if _, err := validatedAbsoluteURL(binding.Issuer); err != nil {
		return errors.New("local Agent identity binding issuer is invalid")
	}
	if normalized, err := normalizeAgentRuntime(binding.Runtime); err != nil || normalized != binding.Runtime {
		return errors.New("local Agent identity binding runtime is invalid")
	}
	if binding.Identity.ID == "" || binding.Identity.Subject == "" || binding.Identity.Issuer != binding.Issuer {
		return errors.New("local Agent identity binding identity is invalid")
	}
	return nil
}

func (s *authBindingStore) mutate(change func(*authBindings) error) (result error) {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return fmt.Errorf("create local Agent identity binding directory: %w", err)
	}
	lock := flock.New(s.path + ".lock")
	if err := lock.Lock(); err != nil {
		return fmt.Errorf("lock local Agent identity bindings: %w", err)
	}
	defer func() {
		if err := lock.Unlock(); err != nil {
			result = errors.Join(result, fmt.Errorf("unlock local Agent identity bindings: %w", err))
		}
	}()
	bindings, err := s.Load()
	if err != nil {
		return err
	}
	if err := change(&bindings); err != nil {
		return err
	}
	data, err := json.MarshalIndent(bindings, "", "  ")
	if err != nil {
		return fmt.Errorf("encode local Agent identity bindings: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(s.path), ".bindings-*")
	if err != nil {
		return fmt.Errorf("create temporary local Agent identity bindings: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("protect temporary local Agent identity bindings: %w", err)
	}
	if _, err := temporary.Write(append(data, '\n')); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("write local Agent identity bindings: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close local Agent identity bindings: %w", err)
	}
	if err := os.Rename(temporaryPath, s.path); err != nil {
		return fmt.Errorf("replace local Agent identity bindings: %w", err)
	}
	return nil
}

package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/gofrs/flock"
)

const (
	lifecycleProfilesVersion  = 1
	lifecycleProfilesFilename = "profiles.json"
)

type lifecycleProfile struct {
	Name       string               `json:"name"`
	API        string               `json:"api"`
	APIProfile string               `json:"api_profile"`
	Origin     string               `json:"origin"`
	Issuer     string               `json:"issuer"`
	Runtime    string               `json:"runtime"`
	Completion *lifecycleCompletion `json:"completion,omitempty"`
}

type lifecycleCompletion struct {
	Kind         string `json:"kind"`
	ResourceID   string `json:"resource_id"`
	Installation string `json:"installation_id,omitempty"`
}

func (p lifecycleProfile) target() agentTarget {
	return agentTarget{
		API: p.API, Profile: p.APIProfile, Runtime: p.Runtime, Origin: p.Origin, Issuer: p.Issuer,
	}
}

type lifecycleProfiles struct {
	Version  int                         `json:"version"`
	Active   string                      `json:"active,omitempty"`
	Profiles map[string]lifecycleProfile `json:"profiles"`
}

type lifecycleProfileStore struct {
	path string
}

func newLifecycleProfileStore(states *fileStateStore) *lifecycleProfileStore {
	// Older adapters skip the identities directory while scanning legacy state.
	// Keep non-credential metadata there so a downgrade fails on v9 identity
	// state instead of trying to decode profiles.json as an Agent identity.
	return &lifecycleProfileStore{path: filepath.Join(states.root, identityDirectory, lifecycleProfilesFilename)}
}

func (s *lifecycleProfileStore) Load() (lifecycleProfiles, error) {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return lifecycleProfiles{Version: lifecycleProfilesVersion, Profiles: map[string]lifecycleProfile{}}, nil
	}
	if err != nil {
		return lifecycleProfiles{}, fmt.Errorf("read Agent lifecycle profiles: %w", err)
	}
	info, err := os.Lstat(s.path)
	if err != nil {
		return lifecycleProfiles{}, fmt.Errorf("read Agent lifecycle profile metadata: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
		return lifecycleProfiles{}, errors.New("Agent lifecycle profiles must be a private regular file")
	}
	var profiles lifecycleProfiles
	if err := json.Unmarshal(data, &profiles); err != nil {
		return lifecycleProfiles{}, fmt.Errorf("decode Agent lifecycle profiles: %w", err)
	}
	if profiles.Version != lifecycleProfilesVersion {
		return lifecycleProfiles{}, fmt.Errorf("unsupported Agent lifecycle profile version %d", profiles.Version)
	}
	if profiles.Profiles == nil {
		profiles.Profiles = map[string]lifecycleProfile{}
	}
	for name, profile := range profiles.Profiles {
		if name != profile.Name {
			return lifecycleProfiles{}, errors.New("Agent lifecycle profile key does not match its name")
		}
		if err := validateLifecycleProfile(profile); err != nil {
			return lifecycleProfiles{}, err
		}
	}
	if profiles.Active != "" {
		if _, ok := profiles.Profiles[profiles.Active]; !ok {
			return lifecycleProfiles{}, errors.New("active Agent lifecycle profile does not exist")
		}
	}
	return profiles, nil
}

func (s *lifecycleProfileStore) save(profiles lifecycleProfiles) error {
	profiles.Version = lifecycleProfilesVersion
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return fmt.Errorf("create Agent lifecycle profile directory: %w", err)
	}
	data, err := json.MarshalIndent(profiles, "", "  ")
	if err != nil {
		return fmt.Errorf("encode Agent lifecycle profiles: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(s.path), ".profiles-*.json")
	if err != nil {
		return fmt.Errorf("create temporary Agent lifecycle profiles: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("protect temporary Agent lifecycle profiles: %w", err)
	}
	if _, err := temporary.Write(append(data, '\n')); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("write Agent lifecycle profiles: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close Agent lifecycle profiles: %w", err)
	}
	if err := os.Rename(temporaryPath, s.path); err != nil {
		return fmt.Errorf("replace Agent lifecycle profiles: %w", err)
	}
	return nil
}

func (s *lifecycleProfileStore) Put(profile lifecycleProfile) error {
	if err := validateLifecycleProfile(profile); err != nil {
		return err
	}
	return s.mutate(func(profiles *lifecycleProfiles) error {
		for name, existing := range profiles.Profiles {
			if name != profile.Name && existing.Issuer == profile.Issuer && existing.Runtime == profile.Runtime {
				return fmt.Errorf("issuer and runtime are already selected by lifecycle profile %q", name)
			}
		}
		if existing, ok := profiles.Profiles[profile.Name]; ok &&
			(existing.Issuer != profile.Issuer || existing.Runtime != profile.Runtime) {
			return fmt.Errorf("lifecycle profile %q already selects another Agent identity", profile.Name)
		}
		profile.Completion = nil
		profiles.Profiles[profile.Name] = profile
		profiles.Active = profile.Name
		return nil
	})
}

func (s *lifecycleProfileStore) Complete(name string, completion lifecycleCompletion) error {
	if err := validateLifecycleCompletion(completion); err != nil {
		return err
	}
	return s.mutate(func(profiles *lifecycleProfiles) error {
		profile, ok := profiles.Profiles[name]
		if !ok {
			return fmt.Errorf("Agent lifecycle profile %q was not found", name)
		}
		profile.Completion = &completion
		profiles.Profiles[name] = profile
		return nil
	})
}

func validateLifecycleProfile(profile lifecycleProfile) error {
	if err := validateLifecycleProfileName(profile.Name); err != nil {
		return err
	}
	if profile.API == "" || profile.APIProfile == "" {
		return errors.New("Agent lifecycle profile must select a Restish API and API profile")
	}
	origin, err := validatedAbsoluteURL(profile.Origin)
	if err != nil || (origin.Path != "" && origin.Path != "/") || origin.RawQuery != "" || origin.Fragment != "" {
		return errors.New("Agent lifecycle profile origin must be an absolute origin")
	}
	if _, err := validatedAbsoluteURL(profile.Issuer); err != nil || !sameOrigin(profile.Issuer, profile.Origin) {
		return errors.New("Agent lifecycle profile issuer must belong to its origin")
	}
	runtime, err := normalizeAgentRuntime(profile.Runtime)
	if err != nil || runtime != profile.Runtime {
		return errors.New("Agent lifecycle profile runtime is invalid")
	}
	if profile.Completion != nil {
		return validateLifecycleCompletion(*profile.Completion)
	}
	return nil
}

func validateLifecycleCompletion(completion lifecycleCompletion) error {
	if completion.ResourceID == "" ||
		(completion.Kind != "installation_revocation" && completion.Kind != "identity_retirement") ||
		(completion.Kind == "installation_revocation" && completion.Installation == "") {
		return errors.New("Agent lifecycle completion marker is invalid")
	}
	return nil
}

func (s *lifecycleProfileStore) Use(name string) (lifecycleProfile, error) {
	var selected lifecycleProfile
	err := s.mutate(func(profiles *lifecycleProfiles) error {
		profile, ok := profiles.Profiles[name]
		if !ok {
			return fmt.Errorf("Agent lifecycle profile %q was not found", name)
		}
		profiles.Active = name
		selected = profile
		return nil
	})
	return selected, err
}

func (s *lifecycleProfileStore) Selected(name string) (lifecycleProfile, error) {
	profiles, err := s.Load()
	if err != nil {
		return lifecycleProfile{}, err
	}
	if name == "" {
		name = profiles.Active
	}
	if name == "" {
		return lifecycleProfile{}, errors.New("no Agent lifecycle profile is selected; run `restish auth login NAME`")
	}
	profile, ok := profiles.Profiles[name]
	if !ok {
		return lifecycleProfile{}, fmt.Errorf("Agent lifecycle profile %q was not found", name)
	}
	return profile, nil
}

func (s *lifecycleProfileStore) Active() (*lifecycleProfile, error) {
	profiles, err := s.Load()
	if err != nil {
		return nil, err
	}
	if profiles.Active == "" {
		return nil, nil
	}
	profile := profiles.Profiles[profiles.Active]
	return &profile, nil
}

func (s *lifecycleProfileStore) Delete(name string) error {
	return s.mutate(func(profiles *lifecycleProfiles) error {
		if _, ok := profiles.Profiles[name]; !ok {
			return nil
		}
		delete(profiles.Profiles, name)
		if profiles.Active == name {
			profiles.Active = ""
			names := make([]string, 0, len(profiles.Profiles))
			for candidate := range profiles.Profiles {
				names = append(names, candidate)
			}
			sort.Strings(names)
			if len(names) > 0 {
				profiles.Active = names[0]
			}
		}
		return nil
	})
}

func (s *lifecycleProfileStore) mutate(change func(*lifecycleProfiles) error) (result error) {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return fmt.Errorf("create Agent lifecycle profile directory: %w", err)
	}
	lock := flock.New(s.path + ".lock")
	if err := lock.Lock(); err != nil {
		return fmt.Errorf("lock Agent lifecycle profiles: %w", err)
	}
	defer func() {
		if err := lock.Unlock(); err != nil {
			result = errors.Join(result, fmt.Errorf("unlock Agent lifecycle profiles: %w", err))
		}
	}()
	profiles, err := s.Load()
	if err != nil {
		return err
	}
	if err := change(&profiles); err != nil {
		return err
	}
	return s.save(profiles)
}

package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFileStateStoreProtectsAndValidatesAgentKeys(t *testing.T) {
	store := &fileStateStore{root: t.TempDir()}
	target := agentTarget{
		API:     "realmroot-local",
		Profile: "default",
		Runtime: "codex",
		Origin:  "https://auth.example.com",
		Issuer:  "https://auth.example.com/api/auth",
	}
	_, agentPrivateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	_, hostPrivateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	state := agentState{
		Version:         agentStateVersion,
		Origin:          target.Origin,
		Name:            "Build Agent",
		AgentID:         "agent-123",
		HostID:          "host-123",
		AgentKeyID:      "agent-key",
		HostKeyID:       "host-key",
		AgentPrivateKey: encodePrivateKey(agentPrivateKey),
		HostPrivateKey:  encodePrivateKey(hostPrivateKey),
	}

	path, err := store.Create(target, state)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("state permissions = %o", info.Mode().Perm())
	}
	alias := target
	alias.API = "realmroot-alias"
	alias.Profile = "work"
	alias.Origin = "https://realmroot-gateway.example.com"
	loaded, err := store.Load(alias)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.AgentID != state.AgentID || loaded.HostID != state.HostID {
		t.Fatalf("loaded unexpected state: %#v", loaded)
	}
	if loaded.Origin != alias.Origin {
		t.Fatalf("loaded origin = %q", loaded.Origin)
	}

	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Load(target); err == nil {
		t.Fatal("expected permissive state file to be rejected")
	}
}

func TestFileStateStoreUpgradeDropsLegacyGrantCredentialCache(t *testing.T) {
	store := &fileStateStore{root: t.TempDir()}
	target := agentTarget{
		API:     "realmroot-local",
		Profile: "default",
		Runtime: "codex",
		Origin:  "https://auth.example.com",
		Issuer:  "https://auth.example.com/api/auth",
	}
	_, agentPrivateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	_, hostPrivateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	legacy := map[string]any{
		"version": 6, "origin": target.Origin, "issuer": target.Issuer, "runtime": target.Runtime,
		"name": "Build Agent", "agent_id": "agent-123", "host_id": "host-123",
		"agent_key_id": "agent-key", "host_key_id": "host-key",
		"agent_private_key": encodePrivateKey(agentPrivateKey), "host_private_key": encodePrivateKey(hostPrivateKey),
		"dpop_credentials": map[string]any{"grant-old": map[string]any{
			"grant_id": "grant-old", "resource_id": "resource-1", "resource_url": "https://api.example.com",
		}},
	}
	legacyPath := store.path(target)
	if err := os.MkdirAll(filepath.Dir(legacyPath), 0o700); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacyPath, encoded, 0o600); err != nil {
		t.Fatal(err)
	}

	upgraded, err := store.Load(target)
	if err != nil {
		t.Fatal(err)
	}
	if upgraded.Version != agentStateVersion || len(upgraded.DPoPCredentials) != 0 {
		t.Fatalf("legacy credential cache was retained: %#v", upgraded)
	}
	reloaded, err := store.Load(target)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Version != agentStateVersion || len(reloaded.DPoPCredentials) != 0 {
		t.Fatalf("upgraded state was not persisted: %#v", reloaded)
	}
	if _, err := os.Stat(legacyPath); err != nil {
		t.Fatalf("upgraded state was not persisted: %v", err)
	}
}

func TestFileStateStoreUpgradeRenamesProtocolCredential(t *testing.T) {
	store := &fileStateStore{root: t.TempDir()}
	target := agentTarget{
		API:     "realmroot-local",
		Profile: "default",
		Runtime: "codex",
		Origin:  "https://auth.example.com",
		Issuer:  "https://auth.example.com/api/auth",
	}
	_, agentPrivateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	_, hostPrivateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	protocolPrivateKey, err := newDPoPPrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	expiresAt := time.Now().Add(time.Minute)
	legacy := map[string]any{
		"version": 8, "origin": target.Origin, "issuer": target.Issuer, "runtime": target.Runtime,
		"name": "Build Agent", "agent_id": "agent-123", "host_id": "host-123",
		"agent_key_id": "agent-key", "host_key_id": "host-key",
		"agent_private_key": encodePrivateKey(agentPrivateKey), "host_private_key": encodePrivateKey(hostPrivateKey),
		"platform_credential": map[string]any{
			"resource_href": "https://auth.example.com/api", "resource_indicator": "https://auth.example.com/api",
			"credential_endpoint": "https://auth.example.com/api/auth/oauth2/token",
			"proof_target":        "https://auth.example.com/api/auth/oauth2/token",
			"private_key":         protocolPrivateKey,
			"access_token":        "protocol-token",
			"expires_at":          expiresAt,
		},
	}
	path := store.path(target)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		t.Fatal(err)
	}

	upgraded, err := store.Load(target)
	if err != nil {
		t.Fatal(err)
	}
	if upgraded.Version != agentStateVersion || upgraded.ProtocolCredential == nil {
		t.Fatalf("protocol credential was not migrated: %#v", upgraded)
	}
	if upgraded.ProtocolCredential.AccessToken != "protocol-token" || upgraded.LegacyPlatformCredential != nil {
		t.Fatalf("protocol credential migration was incomplete: %#v", upgraded)
	}
	persisted, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var representation map[string]any
	if err := json.Unmarshal(persisted, &representation); err != nil {
		t.Fatal(err)
	}
	if _, exists := representation["platform_credential"]; exists {
		t.Fatal("legacy platform credential field was retained")
	}
	if _, exists := representation["protocol_credential"]; !exists {
		t.Fatal("protocol credential field was not persisted")
	}
}

func TestFileStateStoreFindsCredentialOfferByOpaqueReference(t *testing.T) {
	store := &fileStateStore{root: t.TempDir()}
	target := agentTarget{
		API:     "realmroot",
		Profile: "local",
		Runtime: "codex",
		Origin:  "https://auth.example.com",
		Issuer:  "https://auth.example.com/api/auth",
	}
	_, agentPrivateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	_, hostPrivateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	credential := testCredential(t, "", time.Time{})
	state := agentState{
		Version:              agentStateVersion,
		Origin:               target.Origin,
		Issuer:               target.Issuer,
		Runtime:              target.Runtime,
		Name:                 "Build Agent",
		AgentID:              "agent-123",
		HostID:               "host-123",
		AgentKeyID:           "agent-key",
		HostKeyID:            "host-key",
		AgentPrivateKey:      encodePrivateKey(agentPrivateKey),
		HostPrivateKey:       encodePrivateKey(hostPrivateKey),
		DPoPCredentialOffers: map[string][]dpopCredential{credential.ResourceHref: {credential}},
	}
	path := store.path(target)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		t.Fatal(err)
	}

	reference, err := store.FindCredentialOffer(credential.ResourceHref, target.Runtime, credential.Scopes)
	if err != nil {
		t.Fatal(err)
	}
	if reference.credential.ResourceHref != credential.ResourceHref {
		t.Fatalf("credential = %#v", reference.credential)
	}
}

func TestFileStateStoreRejectsSymlink(t *testing.T) {
	store := &fileStateStore{root: t.TempDir()}
	target := agentTarget{
		API:     "api",
		Profile: "default",
		Runtime: "codex",
		Origin:  "https://auth.example.com",
		Issuer:  "https://auth.example.com/api/auth",
	}
	path := store.path(target)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(t.TempDir(), "missing"), path); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Load(target); err == nil {
		t.Fatal("expected symlink state to be rejected")
	}
}

func TestFileStateStoreKeysIdentityByIssuerAndRuntime(t *testing.T) {
	t.Run("[spec: agent-identity/agent-runtime-identity-continuity]", func(t *testing.T) {
		store := &fileStateStore{root: t.TempDir()}
		first := agentTarget{
			API:     "realmroot-primary",
			Profile: "default",
			Runtime: "codex",
			Origin:  "https://auth.example.com",
			Issuer:  "https://auth.example.com/api/auth",
		}
		alias := first
		alias.API = "realmroot-alias"
		alias.Profile = "work"
		otherRuntime := first
		otherRuntime.Runtime = "claude"
		otherEnvironment := first
		otherEnvironment.Origin = "https://staging-auth.example.com"
		otherEnvironment.Issuer = "https://staging-auth.example.com/api/auth"

		if store.path(first) != store.path(alias) {
			t.Fatal("Restish API alias or profile changed the Agent identity path")
		}
		if store.path(first) == store.path(otherRuntime) {
			t.Fatal("different runtimes shared an Agent identity path")
		}
		if store.path(first) == store.path(otherEnvironment) {
			t.Fatal("different Realmroot issuers shared an Agent identity path")
		}
	})
}

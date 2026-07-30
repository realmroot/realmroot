package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"os"
	"path/filepath"
	"testing"
)

func TestFileStateStoreProtectsAndValidatesAgentKeys(t *testing.T) {
	store := &fileStateStore{root: t.TempDir()}
	target := agentTarget{
		API:     "realmroot-local",
		Profile: "default",
		Name:    "build-agent",
		Origin:  "https://auth.example.com",
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
		Version:         1,
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
	loaded, err := store.Load(target)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.AgentID != state.AgentID || loaded.HostID != state.HostID {
		t.Fatalf("loaded unexpected state: %#v", loaded)
	}

	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Load(target); err == nil {
		t.Fatal("expected permissive state file to be rejected")
	}
}

func TestFileStateStoreRejectsSymlink(t *testing.T) {
	store := &fileStateStore{root: t.TempDir()}
	target := agentTarget{API: "api", Profile: "default", Name: "agent", Origin: "https://auth.example.com"}
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

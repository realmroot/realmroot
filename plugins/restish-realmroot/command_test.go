package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofrs/flock"
	"github.com/rest-sh/restish/v2/plugin"
)

func TestAuthCommandHelpExposesOnlyLoginLogoutAndStatus(t *testing.T) {
	host := &fakeAuthCommandHost{}
	if err := runAuthCommand([]string{"--help"}, host, &fileStateStore{root: t.TempDir()}, nil); err != nil {
		t.Fatal(err)
	}
	help := string(host.stdout)
	for _, command := range []string{"auth login", "auth logout", "auth status"} {
		if !strings.Contains(help, command) {
			t.Fatalf("help omitted %q: %s", command, help)
		}
	}
	for _, forbidden := range []string{"auth switch", "auth list", "auth use", "auth revoke", "auth recover", "auth retire"} {
		if strings.Contains(help, forbidden) {
			t.Fatalf("help exposed %q: %s", forbidden, help)
		}
	}
	if err := runAuthCommand([]string{"login", "--help"}, host, &fileStateStore{root: t.TempDir()}, nil); err != nil {
		t.Fatalf("login --help: %v", err)
	}
}

func TestAuthStatusListsLocalIdentitiesWithoutNetworkAccess(t *testing.T) {
	t.Log("[spec: agent-identity/restish-agent-auth-accounts]")
	t.Setenv("AGENT", "codex")
	states := &fileStateStore{root: t.TempDir()}
	createAuthenticatedState(t, states, testTarget("https://one.example.com", "codex"), "identity-1", "agt-one")
	createAuthenticatedState(t, states, testTarget("https://one.example.com", "claude"), "identity-2", "agt-two")
	createAuthenticatedState(t, states, testTarget("https://two.example.com", "codex"), "identity-3", "agt-three")
	host := &fakeAuthCommandHost{}
	if err := runAuthCommand([]string{"status"}, host, states, newAuthBindingStore(states)); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(host.response)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(encoded), `"loggedIn":true`) != 3 || strings.Count(string(encoded), `"current":true`) != 2 {
		t.Fatalf("status = %s", encoded)
	}
	for _, secret := range []string{"private_key", "access_token", "platform-token"} {
		if strings.Contains(string(encoded), secret) {
			t.Fatalf("status exposed %q: %s", secret, encoded)
		}
	}
}

func TestAuthStatusIgnoresAtomicWriteTemporaryFiles(t *testing.T) {
	states := &fileStateStore{root: t.TempDir()}
	directory := filepath.Join(states.root, identityDirectory)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, ".agent-interrupted.json"), []byte("partial"), 0o600); err != nil {
		t.Fatal(err)
	}
	host := &fakeAuthCommandHost{}
	if err := runAuthCommand([]string{"status", "--runtime", "codex"}, host, states, newAuthBindingStore(states)); err != nil {
		t.Fatal(err)
	}
}

func TestAuthStatusRejectsInsecureStateCandidate(t *testing.T) {
	states := &fileStateStore{root: t.TempDir()}
	target := testTarget("https://one.example.com", "codex")
	createAuthenticatedState(t, states, target, "identity-1", "agt-one")
	if err := os.Chmod(states.path(target), 0o644); err != nil {
		t.Fatal(err)
	}
	host := &fakeAuthCommandHost{}
	if err := runAuthCommand([]string{"status", "--runtime", "codex"}, host, states, newAuthBindingStore(states)); err == nil {
		t.Fatal("status accepted insecure Agent state")
	}
}

func TestAuthLogoutForgetsCredentialsButRemembersStableIdentity(t *testing.T) {
	t.Log("[spec: agent-identity/restish-agent-auth-accounts]")
	t.Setenv("AGENT", "codex")
	states := &fileStateStore{root: t.TempDir()}
	target := testTarget("https://one.example.com", "codex")
	createAuthenticatedState(t, states, target, "identity-1", "agt-one")
	bindings := newAuthBindingStore(states)
	host := &fakeAuthCommandHost{}
	if err := runAuthCommand([]string{"logout"}, host, states, bindings); err != nil {
		t.Fatal(err)
	}
	if _, err := states.Load(target); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("sensitive Agent state still exists: %v", err)
	}
	remembered, err := bindings.Find(target.Issuer, target.Runtime)
	if err != nil {
		t.Fatal(err)
	}
	if remembered == nil || remembered.Identity.ID != "identity-1" || remembered.Identity.Subject != "agt-one" {
		t.Fatalf("remembered identity = %#v", remembered)
	}
}

func TestAuthLogoutDiscardsInterruptedLoginState(t *testing.T) {
	t.Log("[spec: agent-identity/restish-agent-login-boundaries]")
	t.Setenv("AGENT", "codex")
	states := &fileStateStore{root: t.TempDir()}
	target := testTarget("https://one.example.com", "codex")
	createAgentState(t, states, target, nil, nil)

	host := &fakeAuthCommandHost{}
	if err := runAuthCommand([]string{"logout"}, host, states, newAuthBindingStore(states)); err != nil {
		t.Fatal(err)
	}
	if _, err := states.Load(target); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("pending sensitive Agent state still exists: %v", err)
	}
}

func TestAuthLogoutDeletesLegacyStateAtItsScannedPath(t *testing.T) {
	t.Setenv("AGENT", "codex")
	states := &fileStateStore{root: t.TempDir()}
	target := testTarget("https://one.example.com", "codex")
	createAuthenticatedState(t, states, target, "identity-1", "agt-one")
	legacyPath := states.legacyPath(target)
	if err := os.MkdirAll(filepath.Dir(legacyPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(states.path(target), legacyPath); err != nil {
		t.Fatal(err)
	}

	if err := runAuthCommand([]string{"logout"}, &fakeAuthCommandHost{}, states, newAuthBindingStore(states)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(legacyPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("legacy sensitive Agent state still exists: %v", err)
	}
}

func TestAuthLogoutWaitsForLoginCriticalSection(t *testing.T) {
	t.Setenv("AGENT", "codex")
	states := &fileStateStore{root: t.TempDir()}
	target := testTarget("https://one.example.com", "codex")
	createAuthenticatedState(t, states, target, "identity-1", "agt-one")
	loginLock := flock.New(states.path(target) + ".login.lock")
	if err := loginLock.Lock(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		done <- runAuthCommand([]string{"logout"}, &fakeAuthCommandHost{}, states, newAuthBindingStore(states))
	}()
	select {
	case err := <-done:
		t.Fatalf("logout did not wait for login: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	if err := loginLock.Unlock(); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestAuthLogoutRemovesOrphanedAtomicState(t *testing.T) {
	t.Setenv("AGENT", "codex")
	states := &fileStateStore{root: t.TempDir()}
	target := testTarget("https://one.example.com", "codex")
	createAuthenticatedState(t, states, target, "identity-1", "agt-one")
	orphan := filepath.Join(filepath.Dir(states.path(target)), ".agent-orphan")
	if err := os.WriteFile(orphan, []byte("private state"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := runAuthCommand([]string{"logout"}, &fakeAuthCommandHost{}, states, newAuthBindingStore(states)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(orphan); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("orphaned temporary Agent state still exists: %v", err)
	}
}

func TestLoginOriginUsesConfiguredNamedProfileScheme(t *testing.T) {
	host := &fakeAuthCommandHost{
		baseURL:  "https://auth.example.com/api",
		profiles: map[string]string{"local": "http://localhost:8787/api"},
	}
	origin, err := loginOrigin(host, "localhost:8787")
	if err != nil {
		t.Fatal(err)
	}
	if origin != "http://localhost:8787" {
		t.Fatalf("origin = %q", origin)
	}
}

func TestRememberedIdentityAcceptsCanonicalIssuerThroughAlternateOrigin(t *testing.T) {
	states := &fileStateStore{root: t.TempDir()}
	bindings := newAuthBindingStore(states)
	identity := stableIdentity{
		ID: "identity-1", Issuer: "https://auth.example.com/api/auth", Subject: "agt-one", Name: "Build Agent",
	}
	if err := bindings.Put(rememberedIdentity{
		Origin: "https://preview.example.net", Issuer: identity.Issuer, Runtime: "codex", Identity: identity,
	}); err != nil {
		t.Fatal(err)
	}
}

func TestAuthLoginResumesAfterNetworkFailureWithoutDuplicateRegistration(t *testing.T) {
	t.Log("[spec: agent-identity/restish-agent-login-boundaries]")
	t.Setenv("AGENT", "codex")
	t.Setenv("REALMROOT_PLUGIN_APPROVAL_FILE", t.TempDir()+"/approval")
	server := newLoginTestServer(t)
	defer server.Close()
	states := &fileStateStore{root: t.TempDir()}
	host := &fakeAuthCommandHost{baseURL: server.URL + "/api"}
	bindings := newAuthBindingStore(states)
	server.failNextStatus = true
	if err := runAuthCommand([]string{"login"}, host, states, bindings); err == nil {
		t.Fatal("interrupted login unexpectedly succeeded")
	}
	if server.registrationCount != 1 {
		t.Fatalf("registrations = %d", server.registrationCount)
	}
	if err := runAuthCommand([]string{"login"}, host, states, bindings); err != nil {
		t.Fatal(err)
	}
	if server.registrationCount != 1 {
		t.Fatalf("resumed login registered again: %d", server.registrationCount)
	}
}

func TestAuthLoginRestoresRememberedIdentityAfterLogout(t *testing.T) {
	t.Log("[spec: agent-identity/agent-runtime-identity-continuity]")
	t.Setenv("AGENT", "codex")
	t.Setenv("REALMROOT_PLUGIN_APPROVAL_FILE", t.TempDir()+"/approval")
	server := newLoginTestServer(t)
	defer server.Close()
	states := &fileStateStore{root: t.TempDir()}
	host := &fakeAuthCommandHost{baseURL: server.URL + "/api"}
	bindings := newAuthBindingStore(states)
	if err := runAuthCommand([]string{"login"}, host, states, bindings); err != nil {
		t.Fatal(err)
	}
	if err := runAuthCommand([]string{"logout"}, host, states, bindings); err != nil {
		t.Fatal(err)
	}
	if err := runAuthCommand([]string{"login"}, host, states, bindings); err != nil {
		t.Fatal(err)
	}
	if server.registrationCount != 2 || server.installationEnrollmentCount != 1 {
		t.Fatalf("registration=%d installation enrollment=%d", server.registrationCount, server.installationEnrollmentCount)
	}
	target := testTarget(server.URL, "codex")
	state, err := states.Load(target)
	if err != nil {
		t.Fatal(err)
	}
	if state.Identity == nil || state.Identity.ID != "identity-1" || state.Identity.Subject != "agt-stable" {
		t.Fatalf("restored identity = %#v", state.Identity)
	}
}

func TestAuthLoginRetriesExpiredRememberedIdentityEnrollmentWithNewRegistration(t *testing.T) {
	t.Log("[spec: agent-identity/restish-agent-login-boundaries]")
	t.Setenv("AGENT", "codex")
	t.Setenv("REALMROOT_PLUGIN_APPROVAL_FILE", t.TempDir()+"/approval")
	server := newLoginTestServer(t)
	defer server.Close()
	states := &fileStateStore{root: t.TempDir()}
	host := &fakeAuthCommandHost{baseURL: server.URL + "/api"}
	bindings := newAuthBindingStore(states)
	if err := runAuthCommand([]string{"login"}, host, states, bindings); err != nil {
		t.Fatal(err)
	}
	if err := runAuthCommand([]string{"logout"}, host, states, bindings); err != nil {
		t.Fatal(err)
	}
	server.installationEnrollmentStatus = "expired"
	if err := runAuthCommand([]string{"login"}, host, states, bindings); err == nil {
		t.Fatal("expired installation enrollment unexpectedly succeeded")
	}
	target := testTarget(server.URL, "codex")
	if _, err := states.Load(target); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("terminal login state still exists: %v", err)
	}
	server.installationEnrollmentStatus = "approved"
	if err := runAuthCommand([]string{"login"}, host, states, bindings); err != nil {
		t.Fatal(err)
	}
	if server.registrationCount != 3 || server.installationEnrollmentCount != 2 {
		t.Fatalf("registration=%d installation enrollment=%d", server.registrationCount, server.installationEnrollmentCount)
	}
}

func TestAuthLoginDeletesStateWhenRememberedIdentityDoesNotMatch(t *testing.T) {
	t.Setenv("AGENT", "codex")
	t.Setenv("REALMROOT_PLUGIN_APPROVAL_FILE", t.TempDir()+"/approval")
	server := newLoginTestServer(t)
	defer server.Close()
	states := &fileStateStore{root: t.TempDir()}
	host := &fakeAuthCommandHost{baseURL: server.URL + "/api"}
	bindings := newAuthBindingStore(states)
	if err := runAuthCommand([]string{"login"}, host, states, bindings); err != nil {
		t.Fatal(err)
	}
	if err := runAuthCommand([]string{"logout"}, host, states, bindings); err != nil {
		t.Fatal(err)
	}
	server.identityID = "identity-unexpected"
	if err := runAuthCommand([]string{"login"}, host, states, bindings); err == nil {
		t.Fatal("mismatched stable identity unexpectedly succeeded")
	}
	if _, err := states.Load(testTarget(server.URL, "codex")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("mismatched sensitive Agent state still exists: %v", err)
	}
}

func TestConcurrentAuthLoginSerializesIssuerRuntimeRegistration(t *testing.T) {
	t.Log("[spec: agent-identity/agent-runtime-identity-continuity]")
	t.Setenv("AGENT", "codex")
	t.Setenv("REALMROOT_PLUGIN_APPROVAL_FILE", t.TempDir()+"/approval")
	server := newLoginTestServer(t)
	defer server.Close()
	states := &fileStateStore{root: t.TempDir()}
	host := &fakeAuthCommandHost{baseURL: server.URL + "/api"}
	bindings := newAuthBindingStore(states)
	errors := make(chan error, 2)
	var group sync.WaitGroup
	for range 2 {
		group.Add(1)
		go func() {
			defer group.Done()
			errors <- runAuthCommand([]string{"login"}, host, states, bindings)
		}()
	}
	group.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	if server.registrationCount != 1 {
		t.Fatalf("concurrent login registrations = %d", server.registrationCount)
	}
}

type fakeAuthCommandHost struct {
	mutex       sync.Mutex
	baseURL     string
	promptValue string
	stdout      []byte
	response    any
	profiles    map[string]string
}

func (h *fakeAuthCommandHost) WriteStdout(value []byte) error {
	h.mutex.Lock()
	defer h.mutex.Unlock()
	h.stdout = append(h.stdout, value...)
	return nil
}

func (h *fakeAuthCommandHost) Response(_ int, _ map[string][]string, value any) error {
	h.mutex.Lock()
	defer h.mutex.Unlock()
	h.response = value
	return nil
}

func (h *fakeAuthCommandHost) ConfigRead(_, profile, _ string) (*plugin.ConfigReadResponseMsg, error) {
	if baseURL, ok := h.profiles[profile]; ok {
		return &plugin.ConfigReadResponseMsg{BaseURL: baseURL}, nil
	}
	return &plugin.ConfigReadResponseMsg{BaseURL: h.baseURL}, nil
}

func (h *fakeAuthCommandHost) ListProfiles(_ string) (*plugin.ListProfilesResponseMsg, error) {
	profiles := make([]string, 0, len(h.profiles))
	for profile := range h.profiles {
		profiles = append(profiles, profile)
	}
	return &plugin.ListProfilesResponseMsg{Profiles: profiles}, nil
}

func (h *fakeAuthCommandHost) Prompt(_ string, _ bool) (*plugin.PromptResponseMsg, error) {
	return &plugin.PromptResponseMsg{Value: h.promptValue}, nil
}

func testTarget(origin string, runtime string) agentTarget {
	return agentTarget{
		API: "realmroot", Profile: "default", Runtime: runtime,
		Origin: origin, Issuer: origin + "/api/auth",
	}
}

func createAuthenticatedState(
	t *testing.T,
	states *fileStateStore,
	target agentTarget,
	identityID string,
	subject string,
) {
	t.Helper()
	platformPrivate, err := newDPoPPrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	expiresAt := time.Now().Add(time.Hour)
	createAgentState(
		t,
		states,
		target,
		&stableIdentity{ID: identityID, Issuer: target.Issuer, Subject: subject, Name: "Build Agent"},
		&dpopCredential{
			ResourceHref: target.Origin + "/api", ResourceIndicator: target.Origin + "/api",
			CredentialEndpoint: target.Issuer + "/oauth2/token", ProofTarget: target.Issuer + "/oauth2/token",
			PrivateKey: platformPrivate, AccessToken: "platform-token", ExpiresAt: &expiresAt,
		},
	)
}

func createAgentState(
	t *testing.T,
	states *fileStateStore,
	target agentTarget,
	identity *stableIdentity,
	platformCredential *dpopCredential,
) {
	t.Helper()
	_, agentPrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	_, hostPrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	_, err = states.Create(target, agentState{
		Name: "Build Agent", AgentID: "protocol-agent", HostID: "host-agent",
		AgentKeyID: "agent-key", HostKeyID: "host-key",
		AgentPrivateKey: encodePrivateKey(agentPrivate), HostPrivateKey: encodePrivateKey(hostPrivate),
		Identity: identity, PlatformCredential: platformCredential,
	})
	if err != nil {
		t.Fatal(err)
	}
}

type loginTestServer struct {
	*httptest.Server
	mutex                        sync.Mutex
	registrationCount            int
	installationEnrollmentCount  int
	failNextStatus               bool
	installationEnrollmentStatus string
	identityID                   string
}

func newLoginTestServer(t *testing.T) *loginTestServer {
	t.Helper()
	fixture := &loginTestServer{}
	fixture.Server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		fixture.handle(writer, request)
	}))
	return fixture
}

func (s *loginTestServer) handle(writer http.ResponseWriter, request *http.Request) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	writer.Header().Set("content-type", "application/json")
	switch {
	case request.Method == http.MethodGet && request.URL.Path == "/.well-known/agent-configuration":
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"version": "1.0-draft", "issuer": s.URL + "/api/auth", "agent_identity_issuer": s.URL + "/api/auth",
			"algorithms": []string{"Ed25519"}, "agent_enrollment_endpoint": s.URL + "/api/agent/enrollments",
			"agent_endpoint": s.URL + "/api/agent/status", "agent_token_endpoint": s.URL + "/api/auth/oauth2/token",
			"endpoints": map[string]string{"register": s.URL + "/api/auth/agent/register", "status": s.URL + "/api/auth/agent/status"},
		})
	case request.Method == http.MethodPost && request.URL.Path == "/api/auth/agent/register":
		s.registrationCount++
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"agent_id": "protocol-agent-" + string(rune('0'+s.registrationCount)), "host_id": "host-1",
			"approval": map[string]any{"verification_uri_complete": s.URL + "/approve", "expires_in": 600, "interval": 1},
		})
	case request.Method == http.MethodGet && request.URL.Path == "/api/auth/agent/status":
		if s.failNextStatus {
			s.failNextStatus = false
			writer.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(writer).Encode(map[string]any{"error": "offline"})
			return
		}
		_ = json.NewEncoder(writer).Encode(map[string]any{"status": "active"})
	case request.Method == http.MethodPost && request.URL.Path == "/api/agent/enrollments":
		s.installationEnrollmentCount++
		status := s.installationEnrollmentStatus
		if status == "" {
			status = "approved"
		}
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"enrollment": map[string]any{
				"id": "enrollment-1", "kind": "additional_host", "status": status,
				"expiresAt": time.Now().Add(time.Minute).Format(time.RFC3339),
			},
			"verificationUri": s.URL + "/agent/enrollments/approve#intent=enrollment-1",
		})
	case request.Method == http.MethodPost && request.URL.Path == "/api/auth/oauth2/token":
		_ = json.NewEncoder(writer).Encode(map[string]any{"access_token": "platform-token", "token_type": "DPoP", "expires_in": 300})
	case request.Method == http.MethodGet && request.URL.Path == "/api/agent/status":
		identityID := s.identityID
		if identityID == "" {
			identityID = "identity-1"
		}
		_ = json.NewEncoder(writer).Encode(map[string]any{"agent": map[string]any{
			"id": identityID, "issuer": s.URL + "/api/auth", "subject": "agt-stable", "name": "Build Agent",
		}})
	default:
		writer.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(writer).Encode(map[string]any{"error": request.Method + " " + request.URL.Path})
	}
}

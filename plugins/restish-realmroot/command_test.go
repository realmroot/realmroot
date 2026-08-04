package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rest-sh/restish/v2/plugin"
)

func TestAuthCommandProfilesStatusAndList(t *testing.T) {
	t.Log("[spec: agent-identity/restish-agent-auth-profiles]")
	host, states, profiles, server := commandFixture(t)
	defer server.Close()

	if err := runAuthCommand([]string{"login", "work", "--agent-name", "Build Agent"}, host, states, profiles); err != nil {
		t.Fatal(err)
	}
	if err := runAuthCommand([]string{"status"}, host, states, profiles); err != nil {
		t.Fatal(err)
	}
	status := host.lastResponse.(map[string]any)
	if status["profile"] != "work" || status["issuer"] != server.URL+"/api/auth" {
		t.Fatalf("status = %#v", status)
	}
	encodedStatus, err := json.Marshal(status)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"platform-token", "private_key", "access_token", "agent_private_key"} {
		if strings.Contains(string(encodedStatus), secret) {
			t.Fatalf("status exposed credential material %q: %s", secret, encodedStatus)
		}
	}
	if err := runAuthCommand([]string{"list"}, host, states, profiles); err != nil {
		t.Fatal(err)
	}
	list := host.lastResponse.(map[string]any)
	if list["current"] != "work" || len(list["installations"].([]agentInstallationView)) != 2 {
		t.Fatalf("list = %#v", list)
	}
	encodedList, err := json.Marshal(list)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encodedList), "server-secret") {
		t.Fatalf("list exposed an unknown server field: %s", encodedList)
	}
	if err := runAuthCommand([]string{"use", "work"}, host, states, profiles); err != nil {
		t.Fatal(err)
	}
	if host.lastResponse.(map[string]any)["selected"] != true ||
		host.lastResponse.(map[string]any)["restishProfileFlag"] != "--rsh-profile default" {
		t.Fatalf("use = %#v", host.lastResponse)
	}
}

func TestLifecycleProfileMutationsPreserveConcurrentWriters(t *testing.T) {
	t.Setenv(stateDirectoryEnv, t.TempDir())
	profiles := newLifecycleProfileStore(newFileStateStore())
	errors := make(chan error, 8)
	var group sync.WaitGroup
	for index := range 8 {
		group.Add(1)
		go func() {
			defer group.Done()
			name := fmt.Sprintf("profile-%d", index)
			errors <- profiles.Put(lifecycleProfile{
				Name: name, API: "realmroot", APIProfile: name,
				Origin: fmt.Sprintf("https://%s.example.com", name),
				Issuer: fmt.Sprintf("https://%s.example.com/api/auth", name), Runtime: defaultAgentRuntime,
			})
		}()
	}
	group.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	stored, err := profiles.Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(stored.Profiles) != 8 {
		t.Fatalf("profiles = %d", len(stored.Profiles))
	}
}

func TestAuthLogoutRemovesOnlySelectedLocalState(t *testing.T) {
	t.Log("[spec: agent-identity/restish-agent-local-logout]")
	host, states, profiles, server := commandFixture(t)
	defer server.Close()
	if err := runAuthCommand([]string{"login", "default"}, host, states, profiles); err != nil {
		t.Fatal(err)
	}
	if err := runAuthCommand([]string{"logout"}, host, states, profiles); err != nil {
		t.Fatal(err)
	}
	if _, err := states.Load(lifecycleProfile{
		API: "realmroot", APIProfile: "default", Origin: server.URL,
		Issuer: server.URL + "/api/auth", Runtime: defaultAgentRuntime,
	}.target()); !os.IsNotExist(err) {
		t.Fatalf("local state still exists: %v", err)
	}
	if server.State.remoteMutations != 0 {
		t.Fatalf("logout changed remote state %d times", server.State.remoteMutations)
	}
}

func TestAuthLogoutReconcilesAStaleProfileAfterStateRemoval(t *testing.T) {
	host, states, profiles, server := commandFixture(t)
	defer server.Close()
	if err := runAuthCommand([]string{"login", "default"}, host, states, profiles); err != nil {
		t.Fatal(err)
	}
	profile, err := profiles.Selected("")
	if err != nil {
		t.Fatal(err)
	}
	if err := states.Delete(profile.target()); err != nil {
		t.Fatal(err)
	}
	if err := runAuthCommand([]string{"logout"}, host, states, profiles); err != nil {
		t.Fatal(err)
	}
	if _, err := profiles.Selected(""); err == nil {
		t.Fatal("stale lifecycle profile was not removed")
	}
}

func TestRemoteLifecycleCommandsDoNotClaimSuccessWhenLocalStateIsMissing(t *testing.T) {
	host, states, profiles, server := commandFixture(t)
	defer server.Close()
	if err := runAuthCommand([]string{"login", "default"}, host, states, profiles); err != nil {
		t.Fatal(err)
	}
	profile, err := profiles.Selected("")
	if err != nil {
		t.Fatal(err)
	}
	if err := states.Delete(profile.target()); err != nil {
		t.Fatal(err)
	}
	for _, command := range [][]string{{"revoke", "installation-current"}, {"retire", "--confirm", "agt-stable"}} {
		err := runAuthCommand(command, host, states, profiles)
		if err == nil || !strings.Contains(err.Error(), "remote") || !strings.Contains(err.Error(), "unknown") {
			t.Fatalf("%v error = %v", command, err)
		}
	}
	if server.State.remoteMutations != 0 {
		t.Fatalf("remote lifecycle mutations = %d", server.State.remoteMutations)
	}
}

func TestRemoteLifecycleCompletionMarkerFinishesLocalCleanupBeforeRetryingRemote(t *testing.T) {
	for _, test := range []struct {
		name       string
		completion lifecycleCompletion
		command    []string
	}{
		{
			name: "revocation", completion: lifecycleCompletion{
				Kind: "installation_revocation", ResourceID: "identity-1", Installation: "installation-current",
			},
			command: []string{"revoke", "installation-current"},
		},
		{
			name: "retirement", completion: lifecycleCompletion{
				Kind: "identity_retirement", ResourceID: "identity-1",
			},
			command: []string{"retire", "--confirm", "agt-stable"},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			host, states, profiles, server := commandFixture(t)
			defer server.Close()
			if err := runAuthCommand([]string{"login", "default"}, host, states, profiles); err != nil {
				t.Fatal(err)
			}
			if err := profiles.Complete("default", test.completion); err != nil {
				t.Fatal(err)
			}
			if err := runAuthCommand(test.command, host, states, profiles); err != nil {
				t.Fatal(err)
			}
			if server.State.remoteMutations != 0 {
				t.Fatalf("remote lifecycle mutations = %d", server.State.remoteMutations)
			}
			if _, err := profiles.Selected("default"); err == nil {
				t.Fatal("completed lifecycle profile was not removed")
			}
			if _, err := states.Load(lifecycleProfile{
				Name: "default", API: "realmroot", APIProfile: "default", Origin: server.URL,
				Issuer: server.URL + "/api/auth", Runtime: defaultAgentRuntime,
			}.target()); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("completed lifecycle state still exists: %v", err)
			}
		})
	}
}

func TestAuthRevokeRemovesCurrentInstallationWithoutRetiringIdentity(t *testing.T) {
	t.Log("[spec: agent-identity/restish-agent-installation-revocation]")
	host, states, profiles, server := commandFixture(t)
	defer server.Close()
	if err := runAuthCommand([]string{"login", "default"}, host, states, profiles); err != nil {
		t.Fatal(err)
	}
	if err := runAuthCommand([]string{"revoke", "installation-current"}, host, states, profiles); err != nil {
		t.Fatal(err)
	}
	result := host.lastResponse.(installationRevocationView)
	if result.Status != "revoked" || result.LocalState != "removed" {
		t.Fatalf("revoke = %#v", result)
	}
	if server.State.retired || server.State.recovered {
		t.Fatal("installation revocation changed the stable identity lifecycle")
	}
}

func TestAuthRecoverPreservesStableSubjectAndBindsFreshInstallation(t *testing.T) {
	t.Log("[spec: agent-identity/restish-agent-recovery]")
	host, states, profiles, server := commandFixture(t)
	defer server.Close()
	if err := runAuthCommand([]string{"login", "default"}, host, states, profiles); err != nil {
		t.Fatal(err)
	}
	if err := runAuthCommand([]string{"recover", "--yes"}, host, states, profiles); err != nil {
		t.Fatal(err)
	}
	profile, state, err := selectedState(states, profiles, "")
	if err != nil {
		t.Fatal(err)
	}
	if state.Identity == nil || state.Identity.Subject != "agt-stable" || state.RecoveryIdentity != nil {
		t.Fatalf("recovered state = %#v", state)
	}
	if profile.Issuer != server.URL+"/api/auth" || !server.State.recovered || server.State.registrationCount != 2 {
		t.Fatalf("recovery server state = %#v", server.State)
	}
}

func TestAuthRecoverRequiresDedicatedHostedApproval(t *testing.T) {
	t.Log("[spec: agent-identity/restish-agent-recovery]")
	host, states, profiles, server := commandFixture(t)
	defer server.Close()
	if err := runAuthCommand([]string{"login", "default"}, host, states, profiles); err != nil {
		t.Fatal(err)
	}
	server.State.recoveryStartsPending = true
	if err := runAuthCommand([]string{"recover", "--yes"}, host, states, profiles); err != nil {
		t.Fatal(err)
	}
	approval, err := os.ReadFile(os.Getenv("REALMROOT_PLUGIN_APPROVAL_FILE"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(approval)) != server.URL+"/recover" {
		t.Fatalf("recovery approval URL = %q", approval)
	}
}

func TestAuthRecoverResumesAfterCommittedResponseIsInterrupted(t *testing.T) {
	t.Log("[spec: agent-identity/restish-agent-recovery]")
	host, states, profiles, server := commandFixture(t)
	defer server.Close()
	if err := runAuthCommand([]string{"login", "default"}, host, states, profiles); err != nil {
		t.Fatal(err)
	}
	server.State.failRecoveryResponseOnce = true
	if err := runAuthCommand([]string{"recover", "--yes"}, host, states, profiles); err == nil {
		t.Fatal("interrupted recovery unexpectedly succeeded")
	}
	if err := runAuthCommand([]string{"recover", "--yes"}, host, states, profiles); err != nil {
		t.Fatal(err)
	}
	_, state, err := selectedState(states, profiles, "")
	if err != nil {
		t.Fatal(err)
	}
	if state.Identity == nil || state.Identity.Subject != "agt-stable" || state.RecoveryIdentity != nil {
		t.Fatalf("resumed recovery state = %#v", state)
	}
	if server.State.registrationCount != 2 || server.State.recoveryMutations != 1 {
		t.Fatalf("recovery was not resumed idempotently: %#v", server.State)
	}
}

func TestAuthRecoverRestartsDeniedReplacementApproval(t *testing.T) {
	host, states, profiles, server := commandFixture(t)
	defer server.Close()
	if err := runAuthCommand([]string{"login", "default"}, host, states, profiles); err != nil {
		t.Fatal(err)
	}
	server.State.approvalStatus = "rejected"
	if err := runAuthCommand([]string{"recover", "--yes"}, host, states, profiles); err == nil ||
		!strings.Contains(err.Error(), "rejected") {
		t.Fatalf("recovery error = %v", err)
	}
	server.State.approvalStatus = "active"
	if err := runAuthCommand([]string{"recover", "--yes"}, host, states, profiles); err != nil {
		t.Fatal(err)
	}
	if server.State.registrationCount != 3 {
		t.Fatalf("replacement registration count = %d", server.State.registrationCount)
	}
}

func TestAuthRecoverRestartsExpiredReplacementApproval(t *testing.T) {
	host, states, profiles, server := commandFixture(t)
	defer server.Close()
	if err := runAuthCommand([]string{"login", "default"}, host, states, profiles); err != nil {
		t.Fatal(err)
	}
	profile, state, err := selectedState(states, profiles, "")
	if err != nil {
		t.Fatal(err)
	}
	expired := time.Now().Add(-time.Minute)
	state.RecoveryIdentity = state.Identity
	state.Identity = nil
	state.RegistrationApproval = &pendingApproval{ExpiresAt: &expired, IntervalSeconds: 1}
	if err := states.Update(profile.target(), state); err != nil {
		t.Fatal(err)
	}
	if err := runAuthCommand([]string{"recover", "--yes"}, host, states, profiles); err != nil {
		t.Fatal(err)
	}
	if server.State.registrationCount != 2 {
		t.Fatalf("replacement registration count = %d", server.State.registrationCount)
	}
}

func TestAuthRetireRequiresExactSubjectAndRemovesLocalState(t *testing.T) {
	t.Log("[spec: agent-identity/restish-agent-retirement]")
	host, states, profiles, server := commandFixture(t)
	defer server.Close()
	if err := runAuthCommand([]string{"login", "default"}, host, states, profiles); err != nil {
		t.Fatal(err)
	}
	host.promptValue = "wrong-subject"
	if err := runAuthCommand([]string{"retire"}, host, states, profiles); err != nil {
		t.Fatal(err)
	}
	if server.State.retired || host.lastResponse.(map[string]any)["status"] != "cancelled" {
		t.Fatal("retirement was not cancelled")
	}
	if err := runAuthCommand([]string{"retire", "--confirm", "agt-stable"}, host, states, profiles); err != nil {
		t.Fatal(err)
	}
	if !server.State.retired {
		t.Fatal("stable Agent was not retired")
	}
	if _, err := profiles.Selected(""); err == nil {
		t.Fatal("retired lifecycle profile remained selected")
	}
}

func TestAuthCommandHelpDocumentsLifecycleDistinctions(t *testing.T) {
	host := &fakeAuthCommandHost{}
	if err := runAuthCommand([]string{"--help"}, host, nil, nil); err != nil {
		t.Fatal(err)
	}
	help := host.stdout.String()
	for _, expected := range []string{"auth status", "auth logout", "auth revoke", "auth recover", "auth retire", "permanent"} {
		if !strings.Contains(help, expected) {
			t.Fatalf("help is missing %q:\n%s", expected, help)
		}
	}
}

func TestLifecycleProfilesRejectIdentityAliasingAndIsolateIssuers(t *testing.T) {
	t.Log("[spec: agent-identity/restish-agent-auth-profiles]")
	t.Setenv(stateDirectoryEnv, t.TempDir())
	profiles := newLifecycleProfileStore(newFileStateStore())
	work := lifecycleProfile{
		Name: "work", API: "realmroot", APIProfile: "default", Origin: "https://id.example.com",
		Issuer: "https://id.example.com/api/auth", Runtime: "codex",
	}
	if err := profiles.Put(work); err != nil {
		t.Fatal(err)
	}
	alias := work
	alias.Name = "alias"
	if err := profiles.Put(alias); err == nil {
		t.Fatal("one stable identity was aliased by two lifecycle profiles")
	}
	wrongIdentity := work
	wrongIdentity.Issuer = "https://other.example.com/api/auth"
	wrongIdentity.Origin = "https://other.example.com"
	if err := profiles.Put(wrongIdentity); err == nil {
		t.Fatal("an existing lifecycle profile switched stable identities")
	}
	staging := wrongIdentity
	staging.Name = "staging"
	if err := profiles.Put(staging); err != nil {
		t.Fatal(err)
	}
	selected, err := profiles.Use("work")
	if err != nil {
		t.Fatal(err)
	}
	if selected.Issuer != work.Issuer {
		t.Fatalf("selected issuer = %q", selected.Issuer)
	}
}

func TestAuthStatusSurfacesStaleRemoteCredentialWithoutDeletingLocalIdentity(t *testing.T) {
	host, states, profiles, server := commandFixture(t)
	defer server.Close()
	if err := runAuthCommand([]string{"login", "default"}, host, states, profiles); err != nil {
		t.Fatal(err)
	}
	server.State.rejectPlatformCredential = true
	err := runAuthCommand([]string{"status"}, host, states, profiles)
	if err == nil || !strings.Contains(err.Error(), "HTTP 401") {
		t.Fatalf("status error = %v", err)
	}
	_, state, loadErr := selectedState(states, profiles, "")
	if loadErr != nil || state.Identity == nil {
		t.Fatalf("local identity changed after stale credential: state=%#v err=%v", state, loadErr)
	}
}

type fakeAuthCommandHost struct {
	baseURL      string
	lastResponse any
	promptValue  string
	confirmValue bool
	stdout       bytes.Buffer
}

func (h *fakeAuthCommandHost) WriteStdout(value []byte) error {
	_, err := h.stdout.Write(value)
	return err
}

func (h *fakeAuthCommandHost) Response(_ int, _ map[string][]string, body any) error {
	h.lastResponse = body
	return nil
}

func (h *fakeAuthCommandHost) ConfigRead(_, _, _ string) (*plugin.ConfigReadResponseMsg, error) {
	return &plugin.ConfigReadResponseMsg{BaseURL: h.baseURL + "/api"}, nil
}

func (h *fakeAuthCommandHost) Prompt(_ string, _ bool) (*plugin.PromptResponseMsg, error) {
	return &plugin.PromptResponseMsg{Value: h.promptValue}, nil
}

func (h *fakeAuthCommandHost) Confirm(_ string) (*plugin.ConfirmResponseMsg, error) {
	return &plugin.ConfirmResponseMsg{Value: h.confirmValue}, nil
}

func (h *fakeAuthCommandHost) Do(message *plugin.HTTPRequestMsg) (*plugin.HTTPResponseMsg, error) {
	var body io.Reader
	if message.Body != nil {
		encoded, err := json.Marshal(message.Body)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequest(message.Method, message.URI, body)
	if err != nil {
		return nil, err
	}
	for name, value := range message.Headers {
		request.Header.Set(name, value)
	}
	if message.ContentType != "" && message.Body != nil {
		request.Header.Set("Content-Type", message.ContentType)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	var responseBody any
	if err := json.NewDecoder(response.Body).Decode(&responseBody); err != nil && err != io.EOF {
		return nil, err
	}
	return &plugin.HTTPResponseMsg{Status: response.StatusCode, Body: responseBody}, nil
}

type lifecycleServerState struct {
	mu                       sync.Mutex
	serverURL                string
	registrationCount        int
	approvalStatus           string
	remoteMutations          int
	recoveryMutations        int
	recoveryStartsPending    bool
	failRecoveryResponseOnce bool
	rejectPlatformCredential bool
	recovered                bool
	retired                  bool
}

type commandTestServer struct {
	*httptest.Server
	State *lifecycleServerState
}

func commandFixture(t *testing.T) (*fakeAuthCommandHost, *fileStateStore, *lifecycleProfileStore, *commandTestServer) {
	t.Helper()
	state := &lifecycleServerState{}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		state.handle(writer, request)
	}))
	t.Cleanup(server.Close)
	stateDir := t.TempDir()
	t.Setenv(stateDirectoryEnv, stateDir)
	t.Setenv("AGENT", defaultAgentRuntime)
	t.Setenv("REALMROOT_PLUGIN_APPROVAL_FILE", filepath.Join(stateDir, "approval.url"))
	state.serverURL = server.URL
	host := &fakeAuthCommandHost{baseURL: server.URL}
	states := &fileStateStore{root: stateDir}
	return host, states, newLifecycleProfileStore(states), &commandTestServer{Server: server, State: state}
}

func (s *lifecycleServerState) handle(writer http.ResponseWriter, request *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	writer.Header().Set("Content-Type", "application/json")
	switch {
	case request.Method == http.MethodGet && request.URL.Path == "/.well-known/agent-configuration":
		writeCommandJSON(writer, map[string]any{
			"version": "1.0-draft", "issuer": s.serverURL + "/api/auth", "algorithms": []string{"Ed25519"},
			"agent_identity_issuer":     s.serverURL + "/api/auth",
			"agent_enrollment_endpoint": s.serverURL + "/api/agent/enrollments",
			"agent_endpoint":            s.serverURL + "/api/agent/status",
			"agent_token_endpoint":      s.serverURL + "/api/auth/oauth2/token",
			"endpoints": map[string]string{
				"register": s.serverURL + "/api/auth/agent/register",
				"status":   s.serverURL + "/api/auth/agent/status",
			},
		})
	case request.Method == http.MethodPost && request.URL.Path == "/api/auth/agent/register":
		s.registrationCount++
		writeCommandJSON(writer, map[string]any{
			"agent_id": fmt.Sprintf("protocol-agent-%d", s.registrationCount),
			"host_id":  fmt.Sprintf("host-%d", s.registrationCount),
			"approval": map[string]any{
				"verification_uri_complete": s.serverURL + "/approve", "expires_in": 60, "interval": 1,
			},
		})
	case request.Method == http.MethodGet && request.URL.Path == "/api/auth/agent/status":
		status := s.approvalStatus
		if status == "" {
			status = "active"
		}
		writeCommandJSON(writer, map[string]any{"status": status})
	case request.Method == http.MethodPost && request.URL.Path == "/api/auth/oauth2/token":
		if err := request.ParseForm(); err != nil || request.Form.Get("scope") != platformScopes {
			http.Error(writer, `{"error":{"message":"invalid scope"}}`, http.StatusBadRequest)
			return
		}
		writeCommandJSON(writer, map[string]any{"access_token": "platform-token", "token_type": "DPoP", "expires_in": 300})
	case request.Method == http.MethodGet && request.URL.Path == "/api/agent/status":
		if s.rejectPlatformCredential {
			writer.WriteHeader(http.StatusUnauthorized)
			writeCommandJSON(writer, map[string]any{"error": map[string]any{"message": "installation is stale"}})
			return
		}
		writeCommandJSON(writer, map[string]any{
			"enrollment": map[string]any{"state": "enrolled", "pending": nil},
			"agent": map[string]any{
				"id": "identity-1", "issuer": s.serverURL + "/api/auth", "subject": "agt-stable", "name": "Build Agent",
			},
			"installation": map[string]any{"id": "installation-current", "status": "active"},
		})
	case request.Method == http.MethodGet && request.URL.Path == "/api/agents/identity-1/installations":
		writeCommandJSON(writer, map[string]any{"items": []map[string]any{
			{"id": "installation-current", "name": "Current", "status": "active", "credentialType": "public_key", "boundAt": "2026-08-04T00:00:00.000Z", "lastSeenAt": nil, "access_token": "server-secret"},
			{"id": "installation-other", "name": "Other", "status": "active", "credentialType": "remote_jwks", "boundAt": "2026-08-04T00:00:00.000Z", "lastSeenAt": nil, "private_key": "server-secret"},
		}, "pagination": map[string]any{"limit": 100, "offset": 0, "total": 2, "hasMore": false, "nextOffset": nil}})
	case request.Method == http.MethodPut && strings.HasSuffix(request.URL.Path, "/revocation"):
		s.remoteMutations++
		installationID := strings.Split(request.URL.Path, "/")[5]
		writeCommandJSON(writer, map[string]any{
			"agentId": "identity-1", "installationId": installationID, "status": "revoked", "revokedAt": "2026-08-04T00:00:00.000Z",
		})
	case request.Method == http.MethodPost && request.URL.Path == "/api/agent/enrollments":
		if !s.recovered {
			s.remoteMutations++
			s.recoveryMutations++
			s.recovered = true
		}
		if s.failRecoveryResponseOnce {
			s.failRecoveryResponseOnce = false
			http.Error(writer, `{"error":{"message":"response interrupted"}}`, http.StatusServiceUnavailable)
			return
		}
		writer.WriteHeader(http.StatusCreated)
		status := "approved"
		if s.recoveryStartsPending {
			status = "pending"
		}
		writeCommandJSON(writer, map[string]any{
			"enrollment": map[string]any{
				"id": "enrollment-1", "kind": "recovery", "status": status,
				"expiresAt": time.Now().Add(time.Minute).UTC().Format(time.RFC3339),
			},
			"verificationUri": s.serverURL + "/recover",
		})
	case request.Method == http.MethodGet && request.URL.Path == "/api/agent/enrollments/enrollment-1":
		writeCommandJSON(writer, map[string]any{
			"id": "enrollment-1", "kind": "recovery", "status": "approved",
			"expiresAt": time.Now().Add(time.Minute).UTC().Format(time.RFC3339),
		})
	case request.Method == http.MethodPut && request.URL.Path == "/api/agents/identity-1/retirement":
		s.remoteMutations++
		s.retired = true
		writer.WriteHeader(http.StatusNoContent)
	default:
		http.NotFound(writer, request)
	}
}

func writeCommandJSON(writer http.ResponseWriter, value any) {
	_ = json.NewEncoder(writer).Encode(value)
}

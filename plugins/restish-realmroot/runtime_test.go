package main

import (
	"errors"
	"strings"
	"testing"
)

func TestDetectAgentRuntimeUsesExplicitAgentRuntime(t *testing.T) {
	runtime, err := detectAgentRuntime(testEnvironment(map[string]string{
		"AGENT":      "Custom-Runtime",
		"CLAUDECODE": "",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if runtime != "custom-runtime" {
		t.Fatalf("runtime = %q", runtime)
	}
}

func TestDetectAgentRuntimeRecognizesAgentTools(t *testing.T) {
	for _, test := range []struct {
		environment map[string]string
		expected    string
	}{
		{environment: map[string]string{"ANTIGRAVITY_AGENT": ""}, expected: "antigravity"},
		{environment: map[string]string{"OPENCODE": ""}, expected: "opencode"},
		{environment: map[string]string{"GOOSE_TERMINAL": ""}, expected: "goose"},
		{environment: map[string]string{"QWEN_CODE": ""}, expected: "qwen"},
		{environment: map[string]string{"CURSOR_AGENT": ""}, expected: "cursor"},
		{environment: map[string]string{"AGENT_DISPLAY_OUT": "", "AGENT_CONTEXT_OUT": ""}, expected: "kiro"},
		{environment: map[string]string{"PI_CODING_AGENT": ""}, expected: "pi"},
		{environment: map[string]string{"CODEX_CI": ""}, expected: "codex"},
		{environment: map[string]string{"CODEX_THREAD_ID": "thread-1"}, expected: "codex"},
		{environment: map[string]string{"COPILOT_CLI": ""}, expected: "copilot"},
		{environment: map[string]string{"GEMINI_CLI": ""}, expected: "gemini"},
		{environment: map[string]string{"CLAUDECODE": ""}, expected: "claude"},
		{environment: map[string]string{"HERMES_SESSION_KEY": ""}, expected: "hermes"},
	} {
		runtime, err := detectAgentRuntime(testEnvironment(test.environment))
		if err != nil {
			t.Fatal(err)
		}
		if runtime != test.expected {
			t.Fatalf("environment %#v resolved runtime %q", test.environment, runtime)
		}
	}
}

func TestDetectAgentRuntimeDoesNotGuess(t *testing.T) {
	if _, err := detectAgentRuntime(testEnvironment(nil)); !errors.Is(err, errUnknownAgentRuntime) {
		t.Fatalf("error = %v", err)
	}
}

func TestDetectAgentRuntimeRejectsInvalidExplicitRuntime(t *testing.T) {
	if _, err := detectAgentRuntime(testEnvironment(map[string]string{"AGENT": "../codex"})); err == nil {
		t.Fatal("expected invalid AGENT runtime to fail")
	}
}

func TestDetectAgentSessionIsolatesConcurrentSessionsWithoutPersistingRawIdentifiers(t *testing.T) {
	first := detectAgentSession(testEnvironment(map[string]string{"CODEX_THREAD_ID": "thread-secret-1"}))
	again := detectAgentSession(testEnvironment(map[string]string{"CODEX_THREAD_ID": "thread-secret-1"}))
	second := detectAgentSession(testEnvironment(map[string]string{"CODEX_THREAD_ID": "thread-secret-2"}))
	if first != again || first == second {
		t.Fatalf("session keys are not stable and isolated: %q %q %q", first, again, second)
	}
	if strings.Contains(first, "thread-secret") {
		t.Fatalf("session key contains the raw external identifier: %q", first)
	}
	if fallback := detectAgentSession(testEnvironment(nil)); fallback != "default" {
		t.Fatalf("fallback session = %q", fallback)
	}
}

func TestCredentialSelectionUsesOnlyTheCurrentAgentSession(t *testing.T) {
	resourceURL := "https://api.example.com/v1"
	t.Setenv("AGENT_SESSION_ID", "")
	t.Setenv("HERMES_SESSION_KEY", "")
	t.Setenv("CODEX_THREAD_ID", "thread-1")
	firstKey := credentialSelectionKey(resourceURL)
	t.Setenv("CODEX_THREAD_ID", "thread-2")
	secondKey := credentialSelectionKey(resourceURL)
	if _, _, selected := selectedResourceURL(firstKey); selected {
		t.Fatal("credential from another Agent session was selected")
	}
	selectedURL, _, selected := selectedResourceURL(secondKey)
	if !selected || selectedURL != resourceURL {
		t.Fatalf("current session selection = %q, %v", selectedURL, selected)
	}
}

func testEnvironment(values map[string]string) environmentLookup {
	return func(name string) (string, bool) {
		value, ok := values[name]
		return value, ok
	}
}

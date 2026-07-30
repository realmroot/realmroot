package main

import "testing"

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

func TestDetectAgentRuntimeFallsBackToRestish(t *testing.T) {
	runtime, err := detectAgentRuntime(testEnvironment(nil))
	if err != nil {
		t.Fatal(err)
	}
	if runtime != defaultAgentRuntime {
		t.Fatalf("runtime = %q", runtime)
	}
}

func TestDetectAgentRuntimeRejectsInvalidExplicitRuntime(t *testing.T) {
	if _, err := detectAgentRuntime(testEnvironment(map[string]string{"AGENT": "../codex"})); err == nil {
		t.Fatal("expected invalid AGENT runtime to fail")
	}
}

func testEnvironment(values map[string]string) environmentLookup {
	return func(name string) (string, bool) {
		value, ok := values[name]
		return value, ok
	}
}

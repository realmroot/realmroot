package main

import (
	"errors"
	"os"
	"strings"
)

const defaultAgentRuntime = "restish"

type environmentLookup func(string) (string, bool)

type runtimeDetector struct {
	name    string
	matches func(environmentLookup) bool
}

var runtimeDetectors = []runtimeDetector{
	{name: "antigravity", matches: hasEnvironment("ANTIGRAVITY_AGENT")},
	{name: "opencode", matches: hasEnvironment("OPENCODE")},
	{name: "goose", matches: hasEnvironment("GOOSE_TERMINAL")},
	{name: "qwen", matches: hasEnvironment("QWEN_CODE")},
	{name: "cursor", matches: hasEnvironment("CURSOR_AGENT")},
	{name: "kiro", matches: hasEnvironments("AGENT_DISPLAY_OUT", "AGENT_CONTEXT_OUT")},
	{name: "pi", matches: hasEnvironment("PI_CODING_AGENT")},
	{name: "codex", matches: hasEnvironment("CODEX_CI")},
	{name: "copilot", matches: hasEnvironment("COPILOT_CLI")},
	{name: "gemini", matches: hasEnvironment("GEMINI_CLI")},
	{name: "claude", matches: hasEnvironment("CLAUDECODE")},
	{name: "hermes", matches: hasAnyEnvironment("HERMES_INTERACTIVE", "HERMES_SESSION_KEY")},
}

func agentRuntime() (string, error) {
	return detectAgentRuntime(os.LookupEnv)
}

func detectAgentRuntime(lookup environmentLookup) (string, error) {
	if value, ok := lookup("AGENT"); ok && strings.TrimSpace(value) != "" {
		return normalizeAgentRuntime(value)
	}
	for _, detector := range runtimeDetectors {
		if detector.matches(lookup) {
			return detector.name, nil
		}
	}
	return defaultAgentRuntime, nil
}

func normalizeAgentRuntime(value string) (string, error) {
	runtime := strings.ToLower(strings.TrimSpace(value))
	if runtime == "" || len(runtime) > 64 {
		return "", errors.New("AGENT must name a runtime with 1 to 64 characters")
	}
	for index, char := range runtime {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '.' || char == '_' || char == '-' {
			if index > 0 || (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') {
				continue
			}
		}
		return "", errors.New("AGENT must contain only letters, numbers, dots, underscores, or hyphens")
	}
	return runtime, nil
}

func hasEnvironment(name string) func(environmentLookup) bool {
	return func(lookup environmentLookup) bool {
		_, ok := lookup(name)
		return ok
	}
}

func hasEnvironments(names ...string) func(environmentLookup) bool {
	return func(lookup environmentLookup) bool {
		for _, name := range names {
			if _, ok := lookup(name); !ok {
				return false
			}
		}
		return true
	}
}

func hasAnyEnvironment(names ...string) func(environmentLookup) bool {
	return func(lookup environmentLookup) bool {
		for _, name := range names {
			if _, ok := lookup(name); ok {
				return true
			}
		}
		return false
	}
}

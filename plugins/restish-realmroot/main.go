package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/rest-sh/restish/v2/plugin"
)

const pluginVersion = "0.12.0"

func main() {
	manifest := plugin.Manifest{
		Name:              "realmroot",
		Version:           pluginVersion,
		Description:       "Authenticate a stable Realmroot Agent identity and supply proof-bound target credentials to Restish",
		RestishAPIVersion: 2,
		AuthAPINames:      []string{"realmroot"},
		Hooks:             []string{"auth-resolver", "auth", "credential-source", "response-middleware"},
		RequiredFeatures:  []string{"auth.operation_security", "auth.dpop_credential_source", "auth.dpop_operation_scopes"},
		HookTimeouts: map[string]time.Duration{
			"auth-resolver":       30 * time.Second,
			"auth":                10 * time.Minute,
			"credential-source":   10 * time.Minute,
			"response-middleware": 10 * time.Minute,
		},
	}
	if plugin.HandleStartupFlags(os.Stdout, manifest, nil) {
		return
	}

	raw, messageType, err := readHookMessage(os.Stdin)
	if err != nil {
		exitWithError(fmt.Errorf("read hook input: %w", err))
	}

	switch messageType {
	case "auth-resolver":
		var input authResolverInput
		if err := plugin.DecMode.Unmarshal(raw, &input); err != nil {
			exitWithError(fmt.Errorf("decode auth resolver input: %w", err))
		}
		output, err := resolveProtocolAuthentication(input, newHTTPClient())
		if err != nil {
			exitWithError(err)
		}
		if err := plugin.WriteMessage(os.Stdout, output); err != nil {
			exitWithError(fmt.Errorf("write auth resolver output: %w", err))
		}
	case "auth":
		var input authHookEnvelope
		if err := plugin.DecMode.Unmarshal(raw, &input); err != nil {
			exitWithError(fmt.Errorf("decode auth hook input: %w", err))
		}
		output, err := authenticateHookRequest(input, newFileStateStore(), newHTTPClient(), systemPromptWriter{})
		if err != nil {
			exitWithError(err)
		}
		if err := plugin.WriteMessage(os.Stdout, output); err != nil {
			exitWithError(fmt.Errorf("write auth hook output: %w", err))
		}
	case "credential-source":
		var input credentialSourceInput
		if err := plugin.DecMode.Unmarshal(raw, &input); err != nil {
			exitWithError(fmt.Errorf("decode credential source input: %w", err))
		}
		output, err := handleCredentialSource(context.Background(), input, newFileStateStore(), newHTTPClient())
		if err != nil {
			exitWithError(err)
		}
		if err := plugin.WriteMessage(os.Stdout, output); err != nil {
			exitWithError(fmt.Errorf("write credential source output: %w", err))
		}
	case "response-middleware":
		var input plugin.ResponseMiddlewareInput
		if err := responseMiddlewareDecMode.Unmarshal(raw, &input); err != nil {
			exitWithError(fmt.Errorf("decode response hook input: %w", err))
		}
		output, err := handleProfiledResponse(
			input,
			systemBrowserOpener{},
			newFileStateStore(),
			newHTTPClient(),
		)
		if err != nil {
			exitWithError(err)
		}
		if err := plugin.WriteMessage(os.Stdout, output); err != nil {
			exitWithError(fmt.Errorf("write response hook output: %w", err))
		}
	}
}

func exitWithError(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}

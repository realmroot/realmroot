package main

import (
	"fmt"
	"os"
	"time"

	"github.com/rest-sh/restish/v2/plugin"
)

const pluginVersion = "0.10.0"

var commands = []plugin.CommandDecl{{
	Name:  "auth",
	Short: "Manage Realmroot Agent identity lifecycle",
	Long:  authCommandHelp,
}}

func main() {
	manifest := plugin.Manifest{
		Name:              "realmroot",
		Version:           pluginVersion,
		Description:       "Authenticate Realmroot and DPoP-bound target API requests as a stable Agent identity",
		RestishAPIVersion: 2,
		Hooks:             []string{"auth", "response-middleware", "command"},
		HookTimeouts: map[string]time.Duration{
			"auth":                10 * time.Minute,
			"response-middleware": 10 * time.Minute,
		},
	}
	if plugin.HandleStartupFlags(os.Stdout, manifest, commands) {
		return
	}

	raw, messageType, err := readHookMessage(os.Stdin)
	if err != nil {
		exitWithError(fmt.Errorf("read hook input: %w", err))
	}

	switch messageType {
	case plugin.MsgTypeInit:
		var input plugin.InitMsg
		if err := plugin.DecMode.Unmarshal(raw, &input); err != nil {
			exitWithError(fmt.Errorf("decode command input: %w", err))
		}
		// The command host sends no further frames until the plugin makes its
		// first request, so a fresh decoder cannot lose buffered reply bytes.
		client := plugin.NewCommandClient(os.Stdin, os.Stdout)
		states := newFileStateStore()
		err := runAuthCommand(input.Args, client, states, newLifecycleProfileStore(states))
		if err != nil {
			if writeErr := client.WriteStderr([]byte(err.Error() + "\n")); writeErr != nil {
				exitWithError(writeErr)
			}
			if doneErr := client.Done(1); doneErr != nil {
				exitWithError(doneErr)
			}
			return
		}
		if err := client.Done(0); err != nil {
			exitWithError(err)
		}
	case "auth":
		var input plugin.AuthHookInput
		if err := plugin.DecMode.Unmarshal(raw, &input); err != nil {
			exitWithError(fmt.Errorf("decode auth hook input: %w", err))
		}
		output, err := authenticateRequest(input, newFileStateStore(), newHTTPClient(), systemPromptWriter{})
		if err != nil {
			exitWithError(err)
		}
		if err := plugin.WriteMessage(os.Stdout, output); err != nil {
			exitWithError(fmt.Errorf("write auth hook output: %w", err))
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

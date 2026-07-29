package main

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

type browserOpener interface {
	Open(string) error
}

type systemBrowserOpener struct{}

func (systemBrowserOpener) Open(rawURL string) error {
	parsed, err := url.Parse(rawURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return errors.New("approval URL must be an absolute HTTP(S) URL")
	}
	writeApprovalURLToTerminal(rawURL)
	if path := strings.TrimSpace(os.Getenv("FLAREAUTH_PLUGIN_APPROVAL_FILE")); path != "" {
		if err := os.WriteFile(path, []byte(rawURL+"\n"), 0o600); err != nil {
			return fmt.Errorf("write approval handoff: %w", err)
		}
		return nil
	}

	var command *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		command = exec.Command("open", "--", rawURL)
	case "windows":
		command = exec.Command("rundll32", "url.dll,FileProtocolHandler", rawURL)
	default:
		command = exec.Command("xdg-open", rawURL)
	}
	if err := command.Start(); err != nil {
		return fmt.Errorf("open approval URL: %w", err)
	}
	return nil
}

func writeApprovalURLToTerminal(rawURL string) {
	terminal, err := os.OpenFile("/dev/tty", os.O_WRONLY, 0)
	if err != nil {
		return
	}
	defer terminal.Close()
	_, _ = terminal.WriteString("Approval URL:\n" + rawURL + "\n")
}

//go:build darwin

package main

import (
	"fmt"
	"os/exec"
)

func hostDisplayName() (string, error) {
	return readMacOSComputerName(func(name string, args ...string) ([]byte, error) {
		return exec.Command(name, args...).Output()
	})
}

func readMacOSComputerName(run func(string, ...string) ([]byte, error)) (string, error) {
	output, err := run("/usr/sbin/scutil", "--get", "ComputerName")
	if err != nil {
		return "", fmt.Errorf("read macOS computer name: %w", err)
	}
	name, err := normalizeDeviceDisplayName(string(output))
	if err != nil {
		return "", fmt.Errorf("read macOS computer name: %w", err)
	}
	return name, nil
}

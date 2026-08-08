//go:build !darwin

package main

import (
	"fmt"
	"os"
)

func hostDisplayName() (string, error) {
	hostName, err := os.Hostname()
	if err != nil {
		return "", fmt.Errorf("read device hostname: %w", err)
	}
	name, err := normalizeDeviceDisplayName(hostName)
	if err != nil {
		return "", fmt.Errorf("read device hostname: %w", err)
	}
	return name, nil
}

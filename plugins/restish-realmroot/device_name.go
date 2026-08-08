package main

import (
	"errors"
	"strings"
)

func normalizeDeviceDisplayName(value string) (string, error) {
	name := strings.TrimSpace(value)
	if name == "" {
		return "", errors.New("device display name is empty")
	}
	return name, nil
}

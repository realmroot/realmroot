package main

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"strings"
)

const credentialSourceReferencePrefix = "rrcs_"

type credentialSourceReferenceGenerator func() (string, error)

func newCredentialSourceReference() (string, error) {
	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		return "", fmt.Errorf("generate credential source reference: %w", err)
	}
	return credentialSourceReferencePrefix + base64.RawURLEncoding.EncodeToString(random), nil
}

func isCredentialSourceReference(reference string) bool {
	encoded, ok := strings.CutPrefix(reference, credentialSourceReferencePrefix)
	if !ok {
		return false
	}
	random, err := base64.RawURLEncoding.DecodeString(encoded)
	return err == nil && len(random) == 16
}

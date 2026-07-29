package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestSignAgentJWTProducesVerifiablePossessionProof(t *testing.T) {
	publicKey, privateKey, keyID, err := newSigningKey("agent")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_800_000_000, 0)
	state := agentState{
		Origin:          "https://auth.example.com",
		AgentID:         "agent-123",
		HostID:          "host-123",
		AgentKeyID:      keyID,
		AgentPrivateKey: encodePrivateKey(privateKey),
	}

	token, err := signAgentJWT(state, now)
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("JWT has %d segments", len(parts))
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		t.Fatal(err)
	}
	if !ed25519.Verify(publicKey, []byte(parts[0]+"."+parts[1]), signature) {
		t.Fatal("JWT signature did not verify")
	}

	var header map[string]any
	decodeJWTPart(t, parts[0], &header)
	if header["typ"] != "agent+jwt" || header["kid"] != keyID {
		t.Fatalf("unexpected JWT header: %#v", header)
	}
	var claims map[string]any
	decodeJWTPart(t, parts[1], &claims)
	if claims["iss"] != "host-123" || claims["sub"] != "agent-123" {
		t.Fatalf("unexpected JWT subject claims: %#v", claims)
	}
	if claims["aud"] != "https://auth.example.com/api/auth" {
		t.Fatalf("unexpected JWT audience: %#v", claims["aud"])
	}
	if claims["iat"] != float64(now.Unix()) || claims["exp"] != float64(now.Add(2*time.Minute).Unix()) {
		t.Fatalf("unexpected JWT lifetime: %#v", claims)
	}
}

func decodeJWTPart(t *testing.T, value string, target any) {
	t.Helper()
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(decoded, target); err != nil {
		t.Fatal(err)
	}
}

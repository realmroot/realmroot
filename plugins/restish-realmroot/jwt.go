package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

func newSigningKey(prefix string) (ed25519.PublicKey, ed25519.PrivateKey, string, error) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, nil, "", fmt.Errorf("generate %s key: %w", prefix, err)
	}
	id, err := randomID()
	if err != nil {
		return nil, nil, "", err
	}
	return publicKey, privateKey, prefix + "-" + id, nil
}

func signRegistrationJWT(
	issuer string,
	hostPrivateKey ed25519.PrivateKey,
	hostKeyID string,
	hostPublicKey ed25519.PublicKey,
	agentKeyID string,
	agentPublicKey ed25519.PublicKey,
	hostName string,
	now time.Time,
) (string, error) {
	claims := map[string]any{
		"host_public_key":  publicJWK(hostKeyID, hostPublicKey),
		"agent_public_key": publicJWK(agentKeyID, agentPublicKey),
		"host_name":        hostName,
		"iss":              hostKeyID,
		"aud":              issuer,
	}
	return signJWT(hostPrivateKey, hostKeyID, "host+jwt", claims, now)
}

func signAgentJWT(state agentState, issuer string, now time.Time) (string, error) {
	privateKey, err := decodePrivateKey(state.AgentPrivateKey)
	if err != nil {
		return "", err
	}
	return signJWT(privateKey, state.AgentKeyID, "agent+jwt", map[string]any{
		"iss": state.HostID,
		"sub": state.AgentID,
		"aud": issuer,
	}, now)
}

func signHostJWT(state agentState, issuer string, now time.Time) (string, error) {
	privateKey, err := decodePrivateKey(state.HostPrivateKey)
	if err != nil {
		return "", err
	}
	return signJWT(privateKey, state.HostKeyID, "host+jwt", map[string]any{
		"iss": state.HostID,
		"aud": issuer,
	}, now)
}

func signJWT(
	privateKey ed25519.PrivateKey,
	keyID string,
	typ string,
	claims map[string]any,
	now time.Time,
) (string, error) {
	jti, err := randomID()
	if err != nil {
		return "", err
	}
	header := map[string]any{"alg": "EdDSA", "typ": typ, "kid": keyID}
	payload := make(map[string]any, len(claims)+4)
	for key, value := range claims {
		payload[key] = value
	}
	payload["iat"] = now.Unix()
	payload["exp"] = now.Add(2 * time.Minute).Unix()
	payload["jti"] = jti

	headerJSON, err := json.Marshal(header)
	if err != nil {
		return "", fmt.Errorf("encode JWT header: %w", err)
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("encode JWT payload: %w", err)
	}
	unsigned := encodeSegment(headerJSON) + "." + encodeSegment(payloadJSON)
	signature := ed25519.Sign(privateKey, []byte(unsigned))
	return unsigned + "." + encodeSegment(signature), nil
}

func publicJWK(keyID string, publicKey ed25519.PublicKey) map[string]string {
	return map[string]string{
		"kty": "OKP",
		"crv": "Ed25519",
		"x":   base64.RawURLEncoding.EncodeToString(publicKey),
		"kid": keyID,
		"alg": "EdDSA",
		"use": "sig",
	}
}

func encodePrivateKey(privateKey ed25519.PrivateKey) string {
	return base64.RawURLEncoding.EncodeToString(privateKey)
}

func decodePrivateKey(encoded string) (ed25519.PrivateKey, error) {
	value, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(value) != ed25519.PrivateKeySize {
		return nil, errors.New("invalid Ed25519 private key")
	}
	return ed25519.PrivateKey(value), nil
}

func encodeSegment(value []byte) string {
	return base64.RawURLEncoding.EncodeToString(value)
}

func randomID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("generate random identifier: %w", err)
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(value)
	return strings.Join([]string{encoded[:8], encoded[8:12], encoded[12:16], encoded[16:20], encoded[20:]}, "-"), nil
}

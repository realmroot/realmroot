package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/url"
	"strings"
	"time"
)

func newDPoPPrivateKey() (string, error) {
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", fmt.Errorf("generate DPoP key: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(privateKey.D.FillBytes(make([]byte, 32))), nil
}

func decodeDPoPPrivateKey(encoded string) (*ecdsa.PrivateKey, error) {
	scalar, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(scalar) != 32 {
		return nil, errors.New("DPoP private key is invalid")
	}
	d := new(big.Int).SetBytes(scalar)
	curve := elliptic.P256()
	if d.Sign() <= 0 || d.Cmp(curve.Params().N) >= 0 {
		return nil, errors.New("DPoP private key is invalid")
	}
	x, y := curve.ScalarBaseMult(scalar)
	return &ecdsa.PrivateKey{PublicKey: ecdsa.PublicKey{Curve: curve, X: x, Y: y}, D: d}, nil
}

func signDPoPProof(
	encodedPrivateKey string,
	method string,
	requestURL string,
	accessToken string,
	now time.Time,
) (string, error) {
	privateKey, err := decodeDPoPPrivateKey(encodedPrivateKey)
	if err != nil {
		return "", err
	}
	normalizedURL, err := normalizedDPoPURL(requestURL)
	if err != nil {
		return "", err
	}
	jti, err := randomID()
	if err != nil {
		return "", err
	}
	header := map[string]any{
		"alg": "ES256",
		"typ": "dpop+jwt",
		"jwk": map[string]string{
			"kty": "EC",
			"crv": "P-256",
			"x":   base64.RawURLEncoding.EncodeToString(privateKey.X.FillBytes(make([]byte, 32))),
			"y":   base64.RawURLEncoding.EncodeToString(privateKey.Y.FillBytes(make([]byte, 32))),
		},
	}
	payload := map[string]any{
		"htm": strings.ToUpper(method),
		"htu": normalizedURL,
		"iat": now.Unix(),
		"jti": jti,
	}
	if accessToken != "" {
		digest := sha256.Sum256([]byte(accessToken))
		payload["ath"] = base64.RawURLEncoding.EncodeToString(digest[:])
	}
	headerJSON, err := json.Marshal(header)
	if err != nil {
		return "", fmt.Errorf("encode DPoP header: %w", err)
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("encode DPoP claims: %w", err)
	}
	unsigned := encodeSegment(headerJSON) + "." + encodeSegment(payloadJSON)
	signingDigest := sha256.Sum256([]byte(unsigned))
	r, s, err := ecdsa.Sign(rand.Reader, privateKey, signingDigest[:])
	if err != nil {
		return "", fmt.Errorf("sign DPoP proof: %w", err)
	}
	signature := append(r.FillBytes(make([]byte, 32)), s.FillBytes(make([]byte, 32))...)
	return unsigned + "." + encodeSegment(signature), nil
}

func normalizedDPoPURL(value string) (string, error) {
	parsed, err := validatedAbsoluteURL(value)
	if err != nil {
		return "", fmt.Errorf("DPoP request URL is invalid: %w", err)
	}
	parsed.Fragment = ""
	parsed.RawQuery = ""
	parsed.ForceQuery = false
	return parsed.String(), nil
}

func validatedAbsoluteURL(value string) (*url.URL, error) {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil {
		return nil, errors.New("an absolute URL without userinfo is required")
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && isLoopbackHost(parsed.Hostname())) {
		return nil, errors.New("HTTPS is required except for loopback development URLs")
	}
	return parsed, nil
}

func isLoopbackHost(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func resourceURLMatches(configured string, requested string) bool {
	resource, err := validatedAbsoluteURL(configured)
	if err != nil {
		return false
	}
	target, err := validatedAbsoluteURL(requested)
	if err != nil || resource.Scheme != target.Scheme || resource.Host != target.Host {
		return false
	}
	resourcePath := strings.TrimSuffix(resource.EscapedPath(), "/")
	targetPath := strings.TrimSuffix(target.EscapedPath(), "/")
	return targetPath == resourcePath || strings.HasPrefix(targetPath, resourcePath+"/")
}

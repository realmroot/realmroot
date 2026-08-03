package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/rest-sh/restish/v2/plugin"
)

func TestResponseMiddlewareDecodesDeepResourceDocument(t *testing.T) {
	t.Run("[spec: agent-identity/restish-deep-resource-response]", func(t *testing.T) {
		input := plugin.ResponseMiddlewareInput{
			Type: "response-middleware",
			Request: plugin.HookRequest{
				Method: "GET",
				URI:    "https://api.example.com/openapi.json",
			},
			Response: plugin.HookResponse{
				Status: 200,
				Body:   nestedDocument(24),
			},
		}
		var encoded bytes.Buffer
		if err := plugin.WriteMessage(&encoded, input); err != nil {
			t.Fatal(err)
		}

		raw, messageType, err := readHookMessage(&encoded)
		if err != nil {
			t.Fatal(err)
		}
		if messageType != "response-middleware" {
			t.Fatalf("message type = %q", messageType)
		}
		var decoded plugin.ResponseMiddlewareInput
		if err := responseMiddlewareDecMode.Unmarshal(raw, &decoded); err != nil {
			t.Fatal(err)
		}
		output, err := handleProfiledResponse(
			decoded,
			&browserRecorder{},
			&memoryStateStore{},
			roundTripFunc(nil),
		)
		if err != nil {
			t.Fatal(err)
		}
		if output.Response != nil || output.Follow != nil || output.Drop {
			t.Fatalf("deep resource response was changed: %#v", output)
		}
	})
}

func TestResponseMiddlewareDecoderRetainsStructuralLimits(t *testing.T) {
	defaultOptions := plugin.DecMode.DecOptions()
	responseOptions := responseMiddlewareDecMode.DecOptions()
	if responseOptions.MaxNestedLevels != maxResponseMiddlewareNestedLevels {
		t.Fatalf("MaxNestedLevels = %d", responseOptions.MaxNestedLevels)
	}
	if responseOptions.MaxArrayElements != defaultOptions.MaxArrayElements {
		t.Fatalf("MaxArrayElements = %d, want %d", responseOptions.MaxArrayElements, defaultOptions.MaxArrayElements)
	}
	if responseOptions.MaxMapPairs != defaultOptions.MaxMapPairs {
		t.Fatalf("MaxMapPairs = %d, want %d", responseOptions.MaxMapPairs, defaultOptions.MaxMapPairs)
	}
}

func TestResponseMiddlewareDecoderRejectsExcessiveNesting(t *testing.T) {
	input := plugin.ResponseMiddlewareInput{
		Type: "response-middleware",
		Response: plugin.HookResponse{
			Status: 200,
			Body:   nestedDocument(maxResponseMiddlewareNestedLevels + 1),
		},
	}
	var encoded bytes.Buffer
	if err := plugin.WriteMessage(&encoded, input); err != nil {
		t.Fatal(err)
	}

	_, _, err := readHookMessage(&encoded)
	if err == nil || !strings.Contains(err.Error(), "nested") {
		t.Fatalf("error = %v, want nesting limit", err)
	}
}

func nestedDocument(levels int) any {
	var value any = "leaf"
	for range levels {
		value = map[string]any{"schema": value}
	}
	return value
}

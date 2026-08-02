package main

import (
	"fmt"
	"io"

	"github.com/fxamacker/cbor/v2"
	"github.com/rest-sh/restish/v2/plugin"
)

const maxResponseMiddlewareNestedLevels = 64

// Response middleware receives untrusted API bodies inside the trusted Restish
// hook envelope. OpenAPI documents commonly exceed the generic hook nesting
// limit, so allow deeper responses while retaining every allocation limit from
// the Restish decoder and keeping the nesting itself bounded.
var responseMiddlewareDecMode = func() cbor.DecMode {
	options := plugin.DecMode.DecOptions()
	options.MaxNestedLevels = maxResponseMiddlewareNestedLevels
	mode, err := options.DecMode()
	if err != nil {
		panic("create response middleware CBOR decoder: " + err.Error())
	}
	return mode
}()

func readHookMessage(reader io.Reader) (cbor.RawMessage, string, error) {
	var raw cbor.RawMessage
	if err := responseMiddlewareDecMode.NewDecoder(reader).Decode(&raw); err != nil {
		return nil, "", fmt.Errorf("decode CBOR message: %w", err)
	}
	var envelope struct {
		Type string `cbor:"type"`
	}
	if err := responseMiddlewareDecMode.Unmarshal(raw, &envelope); err != nil {
		return nil, "", fmt.Errorf("decode hook envelope: %w", err)
	}
	return raw, envelope.Type, nil
}

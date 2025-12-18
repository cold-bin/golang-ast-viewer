//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"
)

type Result struct {
	*Ast   `json:"ast"`
	Source string `json:"source"`
	Dump   string `json:"dump"`
}

func main() {
	// Expose a callable function so the Go WASM runtime can stay alive.
	// JS side sets window.source / window.goastOptions, then calls window.parseGoSource().
	js.Global().Set("parseGoSource", js.FuncOf(func(this js.Value, args []js.Value) any {
		// From global: source
		src := js.Global().Get("source")
		if src.IsUndefined() {
			errorResult := map[string]interface{}{
				"error": "Source code not found. Please set window.source before calling.",
			}
			body, _ := json.Marshal(errorResult)
			out := string(body)
			js.Global().Set("output", out)
			return out
		}

		source := src.String()
		if source == "" {
			errorResult := map[string]interface{}{
				"error": "Source code is empty.",
			}
			body, _ := json.Marshal(errorResult)
			out := string(body)
			js.Global().Set("output", out)
			return out
		}

		// Options from global: goastOptions
		opt := DefaultParseOptionsForSource(source)
		if o := js.Global().Get("goastOptions"); o.Truthy() && o.Type() == js.TypeObject {
			applyParseOptionsFromJS(&opt, o)
		}

		// Parse
		ast, dump, err := ParseWithOptions("foo", source, opt)
		if err != nil {
			errorResult := map[string]interface{}{
				"error":  err.Error(),
				"source": source,
			}
			body, _ := json.Marshal(errorResult)
			out := string(body)
			js.Global().Set("output", out)
			return out
		}

		result := Result{Ast: ast, Source: source, Dump: dump}
		body, err := json.Marshal(result)
		if err != nil {
			errorResult := map[string]interface{}{
				"error": "Failed to marshal result: " + err.Error(),
			}
			errorBody, _ := json.Marshal(errorResult)
			out := string(errorBody)
			js.Global().Set("output", out)
			return out
		}

		out := string(body)
		js.Global().Set("output", out)
		return out
	}))

	js.Global().Set("wasmParseReady", true)

	// Keep Go runtime alive. parseGoSource is invoked from JS.
	select {}
}

func applyParseOptionsFromJS(opt *ParseOptions, o js.Value) {
	if v := o.Get("includeDump"); v.Type() == js.TypeBoolean {
		opt.IncludeDump = v.Bool()
	}
	if v := o.Get("includeComments"); v.Type() == js.TypeBoolean {
		opt.IncludeComments = v.Bool()
	}
	if v := o.Get("maxNodes"); v.Type() == js.TypeNumber {
		opt.MaxNodes = v.Int()
	}
	if v := o.Get("maxDepth"); v.Type() == js.TypeNumber {
		opt.MaxDepth = v.Int()
	}
	if v := o.Get("maxChildren"); v.Type() == js.TypeNumber {
		opt.MaxChildren = v.Int()
	}
	if v := o.Get("maxAttrLen"); v.Type() == js.TypeNumber {
		opt.MaxAttrLen = v.Int()
	}
}

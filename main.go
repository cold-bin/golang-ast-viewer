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
	// 从全局变量读取源代码
	src := js.Global().Get("source")
	if src.IsUndefined() {
		// 如果 source 不存在，设置错误输出
		errorResult := map[string]interface{}{
			"error": "Source code not found. Please set window.source before calling.",
		}
		body, _ := json.Marshal(errorResult)
		js.Global().Set("output", string(body))
		return
	}

	source := src.String()
	if source == "" {
		errorResult := map[string]interface{}{
			"error": "Source code is empty.",
		}
		body, _ := json.Marshal(errorResult)
		js.Global().Set("output", string(body))
		return
	}

	// 解析源代码
	ast, dump, err := Parse("foo", source)
	if err != nil {
		// 解析错误，返回错误信息
		errorResult := map[string]interface{}{
			"error":  err.Error(),
			"source": source,
		}
		body, _ := json.Marshal(errorResult)
		js.Global().Set("output", string(body))
		return
	}

	// 成功解析，返回结果
	result := Result{Ast: ast, Source: source, Dump: dump}
	body, err := json.Marshal(result)
	if err != nil {
		errorResult := map[string]interface{}{
			"error": "Failed to marshal result: " + err.Error(),
		}
		errorBody, _ := json.Marshal(errorResult)
		js.Global().Set("output", string(errorBody))
		return
	}

	js.Global().Set("output", string(body))
}

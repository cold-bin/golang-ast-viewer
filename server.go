//go:build !js || !wasm

package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
)

func main() {
	port := flag.Int("port", 8080, "port to serve on")
	flag.Parse()

	// 设置静态文件服务
	fs := http.FileServer(http.Dir("."))

	// 自定义处理器，确保根路径返回 index.html，并设置正确的 MIME 类型
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// 设置 CORS 头
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		// 处理 OPTIONS 预检请求
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		// 如果访问根路径，直接返回 index.html
		if r.URL.Path == "/" {
			http.ServeFile(w, r, "index.html")
			return
		}

		// 设置 WASM 文件的正确 MIME 类型
		if filepath.Ext(r.URL.Path) == ".wasm" {
			w.Header().Set("Content-Type", "application/wasm")
		}

		// 设置 JS 文件的正确 MIME 类型
		if filepath.Ext(r.URL.Path) == ".js" {
			w.Header().Set("Content-Type", "application/javascript")
		}

		fs.ServeHTTP(w, r)
	})

	addr := fmt.Sprintf(":%d", *port)
	fmt.Printf("Server starting on http://localhost%s\n", addr)

	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatal(err)
	}
}

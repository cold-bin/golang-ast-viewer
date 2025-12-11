build:
	GO111MODULE=on GOARCH=wasm GOOS=js go build -o lib.wasm

serve: build
	go run server.go

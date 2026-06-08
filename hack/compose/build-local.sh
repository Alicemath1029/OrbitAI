#!/bin/sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="${1:-all}"
GO_BUILD_CACHE="$ROOT_DIR/backend/.cache/go-build"

arch="$(uname -m)"
case "$arch" in
  arm64|aarch64)
    goarch="arm64"
    ;;
  x86_64|amd64)
    goarch="amd64"
    ;;
  *)
    echo "unsupported architecture: $arch" >&2
    exit 1
    ;;
esac

build_backend() {
  echo "Building backend binaries for linux/$goarch..."
  cd "$ROOT_DIR/backend"
  mkdir -p bin/compose
  mkdir -p "$GO_BUILD_CACHE"
  env -u GOROOT GOCACHE="$GO_BUILD_CACHE" CGO_ENABLED=0 GOOS=linux GOARCH="$goarch" go build -ldflags="-w -s" -o bin/compose/orbit ./cmd/orbit/main.go
  env -u GOROOT GOCACHE="$GO_BUILD_CACHE" CGO_ENABLED=0 GOOS=linux GOARCH="$goarch" go build -ldflags="-w -s" -o bin/compose/storage-server ./cmd/storage-server/main.go
  env -u GOROOT GOCACHE="$GO_BUILD_CACHE" CGO_ENABLED=0 GOOS=linux GOARCH="$goarch" go build -ldflags="-w -s" -o bin/compose/checkpoint-scanner ./cmd/checkpoint-scanner/main.go
  env -u GOROOT GOCACHE="$GO_BUILD_CACHE" CGO_ENABLED=0 GOOS=linux GOARCH="$goarch" go build -ldflags="-w -s" -o bin/compose/migrate ./cmd/gorm-gen/models/migrate.go
}

build_frontend() {
  echo "Building frontend dist..."
  cd "$ROOT_DIR/frontend"
  if command -v pnpm >/dev/null 2>&1; then
    pnpm build
  elif [ -x ./node_modules/.bin/vite ]; then
    ./node_modules/.bin/vite build
  else
    echo "pnpm is not installed and frontend/node_modules is missing. Run pnpm install first." >&2
    exit 1
  fi
}

case "$TARGET" in
  all)
    build_backend
    build_frontend
    ;;
  backend)
    build_backend
    ;;
  frontend)
    build_frontend
    ;;
  *)
    echo "usage: $0 [all|backend|frontend]" >&2
    exit 1
    ;;
esac

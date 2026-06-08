#!/bin/sh
set -eu

if [ -n "${KUBECONFIG:-}" ] && [ -f "$KUBECONFIG" ]; then
  patched="${KUBECONFIG}.container"
  cp "$KUBECONFIG" "$patched"
  if grep -Eq 'server: https://(127\.0\.0\.1|localhost):' "$patched"; then
    sed -i \
      -e 's#server: https://127\.0\.0\.1:#server: https://host.docker.internal:#g' \
      -e 's#server: https://localhost:#server: https://host.docker.internal:#g' \
      "$patched"
    if ! grep -Eq '^[[:space:]]*tls-server-name:' "$patched"; then
      tmp="${patched}.tmp"
      awk '
        /^[[:space:]]*server: https:\/\/host\.docker\.internal:/ {
          print
          match($0, /^[[:space:]]*/)
          print substr($0, RSTART, RLENGTH) "tls-server-name: localhost"
          next
        }
        { print }
      ' "$patched" > "$tmp"
      mv "$tmp" "$patched"
    fi
  fi
  export KUBECONFIG="$patched"
fi

exec "$@"

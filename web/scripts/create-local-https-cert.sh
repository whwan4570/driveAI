#!/usr/bin/env bash
set -euo pipefail

ip_address="${1:-}"
if [[ ! "$ip_address" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: $0 <Mac LAN IPv4 address>" >&2
  exit 1
fi

cert_dir="$(cd "$(dirname "$0")/.." && pwd)/.local-https"
mkdir -p "$cert_dir"
chmod 700 "$cert_dir"

if [[ ! -f "$cert_dir/ca.key" || ! -f "$cert_dir/ca.crt" ]]; then
  openssl req -x509 -newkey rsa:3072 -sha256 -days 365 -nodes \
    -keyout "$cert_dir/ca.key" -out "$cert_dir/ca.crt" \
    -subj "/CN=Carmori Local Development CA" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" >/dev/null 2>&1
fi

openssl req -new -newkey rsa:2048 -sha256 -nodes \
  -keyout "$cert_dir/server.key" -out "$cert_dir/server.csr" \
  -subj "/CN=$ip_address" >/dev/null 2>&1

cat > "$cert_dir/server.ext" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=IP:$ip_address,IP:127.0.0.1,DNS:localhost
EOF

openssl x509 -req -in "$cert_dir/server.csr" \
  -CA "$cert_dir/ca.crt" -CAkey "$cert_dir/ca.key" -CAcreateserial \
  -out "$cert_dir/server.crt" -days 30 -sha256 \
  -extfile "$cert_dir/server.ext" >/dev/null 2>&1

chmod 600 "$cert_dir/ca.key" "$cert_dir/server.key"
rm -f "$cert_dir/server.csr" "$cert_dir/server.ext"

echo "Certificate for https://$ip_address is ready."
echo "Install and fully trust this PUBLIC CA certificate on the phone: $cert_dir/ca.crt"
echo "Keep ca.key and server.key private."
echo "Start Vite with:"
echo "CARMORI_HTTPS_CERT=$cert_dir/server.crt CARMORI_HTTPS_KEY=$cert_dir/server.key pnpm dev -- --port 5174"

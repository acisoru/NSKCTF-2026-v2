#!/bin/sh
# Issue the lab C2 material (CA, server, client) into build/c2-material.
set -e
DIR="$(dirname "$0")/../build/c2-material"
mkdir -p "$DIR"
cd "$DIR"

openssl genpkey -algorithm ED25519 -out ca.key 2>/dev/null
openssl req -x509 -new -key ca.key -subj "/CN=chaotic-ca" -days 730 \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" -out ca.crt

for pair in "control:c2-control:serverAuth" "client:gw-07:clientAuth"; do
    name="${pair%%:*}"; rest="${pair#*:}"
    cn="${rest%%:*}"; usage="${rest##*:}"
    openssl genpkey -algorithm ED25519 -out "$name.key" 2>/dev/null
    openssl req -new -key "$name.key" -subj "/CN=$cn" -out "$name.csr"
    printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=%s\n' "$usage" > "$name.ext"
    openssl x509 -req -in "$name.csr" -CA ca.crt -CAkey ca.key -CAcreateserial \
        -days 730 -sha256 -extfile "$name.ext" -out "$name.crt" 2>/dev/null
done
chmod 600 client.key control.key
openssl x509 -in client.crt -noout -subject -dates

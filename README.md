# wasmer-vless

VLESS-over-WebSocket server (TCP only) for Wasmer Edge. Replaces the 3x-ui + BackPack stack.

## Deploy
1. Put these 3 files (package.json, index.js, README.md) in a NEW GitHub repo root.
2. Import the repo in Wasmer (Node.js provider is detected from package.json).
3. Set environment variables: UUID (e.g. from https://www.uuidgenerator.net), optional WS_PATH.

## Client link
vless://<UUID>@<your-app>.wasmer.app:443?encryption=none&security=tls&sni=<your-app>.wasmer.app&type=ws&host=<your-app>.wasmer.app&path=%2Fws#wasmer

## Test
Open https://<your-app>.wasmer.app/ -> should print "OK".

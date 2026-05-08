#!/usr/bin/env bash
set -e

DB_DRIVER=firestore \
FIRESTORE_EMULATOR_HOST=localhost:8080 \
GOOGLE_CLOUD_PROJECT=demo-test \
PORT=3001 \
node src/backend/server.js &

SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null || true" EXIT

sleep 2

EMAIL="smoke-$(date +%s)@example.com"
RESULT=$(curl -s -X POST http://localhost:3001/auth/signup \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"password123\",\"display_name\":\"smoke\"}")

echo "$RESULT" | grep -q '"id"' || { echo "FAIL: signup did not return id. Response: $RESULT"; exit 1; }
echo "smoke OK"

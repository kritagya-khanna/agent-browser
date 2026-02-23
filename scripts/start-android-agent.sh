#!/bin/bash
set -e

export AGENT_BROWSER_SOCKET_DIR=/tmp/agent-browser
mkdir -p $AGENT_BROWSER_SOCKET_DIR

echo "[Agent] Starting Agent Browser Service"

# Resolve IP of android-service via Docker's built-in DNS
echo "[Agent] Resolving android-service IP via DNS..."
ANDROID_IP=""
until [ -n "$ANDROID_IP" ]; do
  ANDROID_IP=$(node -e 'require("dns").lookup("android-service", (err, addr) => { if(!err) console.log(addr) })' 2>/dev/null)
  
  if [ -z "$ANDROID_IP" ]; then
    echo "[Agent] Waiting for Docker DNS resolution of 'android-service'..."
    sleep 2
  fi
done
echo "[Agent] Resolved Android IP: $ANDROID_IP"

# Wait for CDP Bridge (Port 9224)
echo "[Agent] Waiting for Android CDP at http://$ANDROID_IP:9224..."
until curl -s http://$ANDROID_IP:9224/json/version > /dev/null; do
  echo "[Agent] Waiting for CDP..."
  sleep 5
done
echo "[Agent] CDP Bridge is ready!"

# Start Daemon (Direct TCP Mode)
echo "[Agent] Starting Daemon on port 3000..."
export AGENT_BROWSER_CDP_URL=http://$ANDROID_IP:9224
export AGENT_BROWSER_TCP_PORT=3000

# Run daemon in foreground (it manages its own lifecycle)
exec node dist/daemon.js

#!/bin/bash
set -e

export AGENT_BROWSER_SOCKET_DIR=/tmp/agent-browser
mkdir -p $AGENT_BROWSER_SOCKET_DIR

echo "[Agent] Starting Agent Browser Service"

# Resolve IP of android-service to avoid Chrome Host header security block
echo "[Agent] Resolving android-service IP..."
ANDROID_IP=""
until [ -n "$ANDROID_IP" ]; do
  ANDROID_IP=$(getent hosts android-service | awk '{ print $1 }' | head -n 1)
  if [ -z "$ANDROID_IP" ]; then
    echo "[Agent] Waiting for DNS resolution..."
    sleep 2
  fi
done
echo "[Agent] Android IP: $ANDROID_IP"

# Wait for CDP Bridge (Port 9224)
echo "[Agent] Waiting for Android CDP at http://$ANDROID_IP:9224..."
until curl -s http://$ANDROID_IP:9224/json/version > /dev/null; do
  echo "[Agent] Waiting for CDP..."
  sleep 5
done
echo "[Agent] CDP Bridge is ready!"

# Start Daemon
echo "[Agent] Starting Daemon..."
export AGENT_BROWSER_CDP_URL=http://$ANDROID_IP:9224
node dist/daemon.js &
DAEMON_PID=$!

# Start Socat Bridge for CLI
SOCKET_FILE="$AGENT_BROWSER_SOCKET_DIR/default.sock"
TCP_PORT=3000

echo "[Agent] Waiting for socket..."
while [ ! -S "$SOCKET_FILE" ]; do
  if ! kill -0 $DAEMON_PID 2>/dev/null; then
    echo "[Agent] Daemon crashed!"
    exit 1
  fi
  sleep 0.5
done

echo "[Agent] Ready on port $TCP_PORT"
exec socat TCP-LISTEN:$TCP_PORT,bind=0.0.0.0,reuseaddr,fork UNIX-CONNECT:$SOCKET_FILE

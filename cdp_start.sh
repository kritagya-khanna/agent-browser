#!/bin/bash
# setup_cdp_connection.sh - Setup CDP connection for WootzApp browser

set -e

INTERNAL_PORT=9223
PACKAGE_NAME="org.chromium.chrome"
ACTIVITY_NAME="org.chromium.chrome.browser.ChromeTabbedActivity"

log() { echo "[CDP-Setup] $(date '+%H:%M:%S') $*"; }

# Check if ADB is available
if ! command -v adb &> /dev/null; then
    log "ERROR: adb not found. Please install Android SDK platform-tools."
    exit 1
fi

# Check if device is connected
if ! adb devices | grep -q "device$"; then
    log "ERROR: No Android device/emulator connected."
    log "Please start your emulator and try again."
    exit 1
fi

log "Device connected: $(adb devices | grep 'device$' | head -1 | awk '{print $1}')"

# Wait for emulator to be ready
log "Waiting for emulator to be ready..."
count=0
while [ $count -lt 30 ]; do
    if adb -s emulator-5554 shell getprop sys.boot_completed 2>/dev/null | grep -q "1"; then
        log "Emulator is ready"
        break
    fi
    count=$((count + 1))
    sleep 1
done

if [ $count -eq 30 ]; then
    log "WARNING: Emulator may not be fully booted, continuing anyway..."
fi

# Step 1: Stop Chrome to ensure clean start
log "Stopping Chrome..."
adb -s emulator-5554 shell "am force-stop $PACKAGE_NAME" 2>/dev/null || true
sleep 1

# Step 2: Set Chrome command line flags
log "Setting Chrome command line flags..."
CHROME_FLAGS="_ --disable-fre --no-default-browser-check --no-first-run --remote-debugging-port=$INTERNAL_PORT"
adb -s emulator-5554 shell "echo '$CHROME_FLAGS' > /data/local/tmp/chrome-command-line"
adb -s emulator-5554 shell "chmod 666 /data/local/tmp/chrome-command-line"

# Step 3: Launch Chrome
log "Launching Chrome..."
adb -s emulator-5554 shell am start -n $PACKAGE_NAME/$ACTIVITY_NAME -d about:blank
log "Waiting for Chrome to initialize..."
sleep 5

# Step 4: Setup ADB forward
log "Setting up ADB port forwarding..."

# Remove existing forward
adb -s emulator-5554 forward --remove tcp:$INTERNAL_PORT 2>/dev/null || true
sleep 1

# Wait for DevTools socket to appear
log "Waiting for DevTools socket..."
socket_found=false
for i in {1..20}; do
    if adb -s emulator-5554 shell cat /proc/net/unix 2>/dev/null | grep -q wootzapp_devtools_remote; then
        socket_found=true
        break
    fi
    sleep 1
done

if [ "$socket_found" = false ]; then
    log "WARNING: DevTools socket not found, attempting forward anyway..."
fi

# Create forward
log "Creating ADB forward: tcp:$INTERNAL_PORT -> localabstract:wootzapp_devtools_remote"
if ! adb -s emulator-5554 forward tcp:$INTERNAL_PORT localabstract:wootzapp_devtools_remote; then
    log "ERROR: Failed to create ADB forward"
    exit 1
fi

log "ADB forward established"

# Step 5: Verify CDP connection
log "Verifying CDP connection..."
sleep 2

if command -v curl &> /dev/null; then
    if curl -s --max-time 5 http://localhost:$INTERNAL_PORT/json/version >/dev/null 2>&1; then
        log "✅ CDP connection successful!"
        log ""
        log "CDP endpoint: http://localhost:$INTERNAL_PORT"
        log ""
        log "Testing connection..."
        echo ""
        curl -s http://localhost:$INTERNAL_PORT/json/version | python3 -m json.tool 2>/dev/null || curl -s http://localhost:$INTERNAL_PORT/json/version
        echo ""
        log "✅ Setup complete! You can now use CDP commands."
    else
        log "WARNING: CDP endpoint not responding yet. It may take a few more seconds."
        log "Try running: curl http://localhost:$INTERNAL_PORT/json/version"
    fi
else
    log "curl not found. Skipping verification."
    log "CDP endpoint should be available at: http://localhost:$INTERNAL_PORT"
fi

log "Setup script completed."

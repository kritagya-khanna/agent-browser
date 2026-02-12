#!/bin/bash
set -e

#============================================
# FAIL-FAST VALIDATION
# Check required files BEFORE starting emulator
#============================================

echo "========================================"
echo "W8-RL Pre-flight Checks"
echo "========================================"

# Check WootzApp APK
WOOTZAPP_APK="/app/docker_setup/apks/WootzApp-x86_64.apk"
if [ ! -f "$WOOTZAPP_APK" ]; then
    echo ""
    echo "ERROR: WootzApp APK not found!"
    echo "Expected: $WOOTZAPP_APK"
    echo ""
    echo "Please download WootzApp APK and place it at:"
    echo "  android_world/docker_setup/apks/WootzApp-x86_64.apk"
    echo ""
    exit 1
fi
echo "[OK] WootzApp APK found: $WOOTZAPP_APK"

# Check GCP Service Account (for Gemini API)
GCP_CREDS="/app/secrets/gcp-service-account.json"
if [ ! -f "$GCP_CREDS" ]; then
    echo ""
    echo "ERROR: GCP Service Account JSON not found!"
    echo "Expected: $GCP_CREDS"
    echo ""
    echo "Gemini API requires a GCP service account with Vertex AI access."
    echo "Please place your service account JSON at:"
    echo "  secrets/gcp-service-account.json"
    echo ""
    exit 1
fi

# Validate JSON structure and extract project ID
PROJECT_ID=$(python3 -c "import json; print(json.load(open('$GCP_CREDS')).get('project_id', ''))" 2>/dev/null || echo "")
if [ -z "$PROJECT_ID" ]; then
    echo ""
    echo "ERROR: Invalid GCP Service Account JSON!"
    echo "File exists but missing 'project_id' field."
    echo "Please ensure you have a valid service account JSON."
    echo ""
    exit 1
fi
echo "[OK] GCP credentials found (project: $PROJECT_ID)"

echo "========================================"
echo "Pre-flight checks passed!"
echo "========================================"
echo ""

# Start Emulator
#============================================
./docker_setup/start_emu_headless.sh && \
adb root && \
python3 -m server.android_server

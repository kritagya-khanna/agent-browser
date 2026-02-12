#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}=================================================${NC}"
echo -e "${BLUE}   Agent Browser - Android Environment Setup     ${NC}"
echo -e "${BLUE}=================================================${NC}"

# 1. Pre-flight Checks
echo -e "\n${YELLOW}[1/4] Checking System Requirements...${NC}"

if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed.${NC}"
    exit 1
fi

if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    if [ -e /dev/kvm ]; then
        echo -e "${GREEN}✓ KVM Acceleration detected (/dev/kvm)${NC}"
    else
        echo -e "${YELLOW}⚠ Warning: No KVM detected. Emulator will be slow.${NC}"
    fi
fi

# 2. Start Services
echo -e "\n${YELLOW}[2/4] Starting Docker Stack...${NC}"
echo "      (First run may take a few minutes to download images)"

docker compose -f docker-compose.prod.yml up -d --build --remove-orphans > /dev/null 2>&1

# 3. Wait for Readiness
echo -e "\n${YELLOW}[3/4] Waiting for Initialization...${NC}"

wait_for_log() {
    local container=$1
    local pattern=$2
    local label=$3
    
    echo -n "      Waiting for $label... "
    until docker logs "$container" 2>&1 | grep -q "$pattern"; do
        sleep 2
    done
    echo -e "${GREEN}Done!${NC}"
}

# Find actual container names
ANDROID_CONTAINER=$(docker compose -f docker-compose.prod.yml ps -q android-service)
AGENT_CONTAINER=$(docker compose -f docker-compose.prod.yml ps -q agent-service)

wait_for_log "$ANDROID_CONTAINER" "Emulator boot complete" "Android Emulator Boot"
wait_for_log "$ANDROID_CONTAINER" "APK installation complete" "WootzApp Installation"
wait_for_log "$ANDROID_CONTAINER" "CDP Bridge ready" "CDP Bridge"
wait_for_log "$AGENT_CONTAINER" "Ready on port 3000" "Agent Daemon Connection"

# 4. Success
echo -e "\n${GREEN}[4/4] Environment Ready!${NC}"
echo -e "${BLUE}=================================================${NC}"
echo -e "You can now control the Android browser."
echo -e ""
echo -e "Try these commands:"
echo -e "  ${GREEN}./agent open https://google.com${NC}"
echo -e "  ${GREEN}./agent snapshot${NC}"
echo -e "  ${GREEN}./agent click @e1${NC}"
echo -e ""
echo -e "See COMMANDS.md for full reference."
echo -e "${BLUE}=================================================${NC}"

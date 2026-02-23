#!/bin/bash
# Script to build and push WootzApp Agent Browser images to Docker Hub.
#
# Usage:
#   ./scripts/publish_images.sh [version]
#
# If no version is provided, it defaults to 'latest'.

set -e

VERSION="${1:-latest}"
ORG="kritchoff"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}Building and Pushing WootzApp Agent Browser images (version: $VERSION)...${NC}"

# 1. Build Android Image (Force AMD64)
echo -e "\n${BLUE}Building Android Image (linux/amd64)...${NC}"
# We use buildx to ensure platform is set correctly and push directly
docker buildx build --platform linux/amd64 -t "$ORG/agent-android:$VERSION" --push ./android_world

# 2. Build Daemon Image (Force AMD64)
echo -e "\n${BLUE}Building Daemon Image (linux/amd64)...${NC}"
docker buildx build --platform linux/amd64 -t "$ORG/agent-daemon:$VERSION" -f docker/Dockerfile.agent-prod --push .

# 3. Tag latest (if needed)
if [ "$VERSION" != "latest" ]; then
    echo -e "\n${BLUE}Tagging and Pushing latest...${NC}"
    # Rebuild/push with latest tag (layers cached)
    docker buildx build --platform linux/amd64 -t "$ORG/agent-android:latest" --push ./android_world
    docker buildx build --platform linux/amd64 -t "$ORG/agent-daemon:latest" -f docker/Dockerfile.agent-prod --push .
fi

echo -e "
${GREEN}Successfully published images to $ORG repository!${NC}"

#!/bin/bash
# Benchmark Script for Agent Browser

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

LOG_FILE="benchmark.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo -e "${BLUE}=======================================${NC}"
echo -e "${BLUE}   Agent Browser Performance Test      ${NC}"
echo -e "${BLUE}=======================================${NC}"

# Helper to measure time
measure_start() {
    START_TIME=$(date +%s%3N)
}

measure_end() {
    END_TIME=$(date +%s%3N)
    DURATION=$((END_TIME - START_TIME))
    echo -e "${GREEN}Time: ${DURATION}ms${NC}"
}

wait_for_ready() {
    echo -n "Waiting for stack to be fully ready... "
    local container=$(docker compose -f docker-compose.prod.yml ps -q agent-service)
    until docker logs "$container" 2>&1 | grep -q "Ready on port 3000"; do
        sleep 1
    done
    echo "Done."
}

# 1. Reset
echo -e "
${BLUE}[1/3] Resetting Environment (Cold State)...${NC}"
docker compose -f docker-compose.prod.yml down -v --remove-orphans
docker volume rm agent-browser_avd-data 2>/dev/null || true

# 2. Cold Start
echo -e "
${BLUE}[2/3] Test 1: Cold Start Boot Time${NC}"
echo "Starting stack (Build + Boot + APK Install + Snapshot Save)..."
measure_start
docker compose -f docker-compose.prod.yml up -d --build
wait_for_ready
measure_end

# 3. Warm Start
echo -e "
${BLUE}[3/3] Test 2: Warm Start Boot Time${NC}"
echo "Stopping stack..."
docker compose -f docker-compose.prod.yml down
echo "Starting stack (Snapshot Boot)..."
measure_start
docker compose -f docker-compose.prod.yml up -d
wait_for_ready
measure_end

# 4. Snapshot Latency
echo -e "
${BLUE}[4/4] Test 3: Snapshot Latency${NC}"
echo "Navigating to Wikipedia..."
./agent open https://en.wikipedia.org/wiki/Main_Page

echo "Measuring 5 snapshots..."
total=0
for i in {1..5}; do
    echo -n "Run $i: "
    measure_start
    ./agent snapshot > /dev/null
    END_TIME=$(date +%s%3N)
    DURATION=$((END_TIME - START_TIME))
    echo "${DURATION}ms"
    total=$((total + DURATION))
done

avg=$((total / 5))
echo -e "${GREEN}Average Snapshot Latency: ${avg}ms${NC}"

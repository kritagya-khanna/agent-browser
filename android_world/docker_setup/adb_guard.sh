#!/bin/bash
set -euo pipefail

ADB_LOCK_DIR="${ADB_LOCK_DIR:-/tmp/adb-lock}"
ADB_LOCK_TIMEOUT="${ADB_LOCK_TIMEOUT:-120}"
ADB_LOCK_STALE_SECONDS="${ADB_LOCK_STALE_SECONDS:-90}"
ADB_READY_TIMEOUT="${ADB_READY_TIMEOUT:-60}"

ensure_adb_ready() {
    local start_ts
    start_ts=$(date +%s)

    while ! mkdir "${ADB_LOCK_DIR}" 2>/dev/null; do
        if [ -d "${ADB_LOCK_DIR}" ] && [ -n "${ADB_LOCK_STALE_SECONDS}" ]; then
            local lock_age
            lock_age=$(($(date +%s) - $(stat -c "%Y" "${ADB_LOCK_DIR}" 2>/dev/null || echo 0)))
            if [ "${lock_age}" -ge "${ADB_LOCK_STALE_SECONDS}" ]; then
                echo "[adb-guard] Removing stale ADB lock (age ${lock_age}s)"
                rm -rf "${ADB_LOCK_DIR}" || true
                continue
            fi
        fi

        if [ $(( $(date +%s) - start_ts )) -ge "${ADB_LOCK_TIMEOUT}" ]; then
            echo "[adb-guard] Failed to acquire ADB lock within ${ADB_LOCK_TIMEOUT}s" >&2
            return 1
        fi
        sleep 1
    done

    cleanup_lock() {
        rmdir "${ADB_LOCK_DIR}" 2>/dev/null || true
    }

    trap cleanup_lock EXIT

    if adb devices >/dev/null 2>&1; then
        cleanup_lock
        trap - EXIT
        return 0
    fi

    adb kill-server >/dev/null 2>&1 || true
    adb start-server >/dev/null 2>&1 || true

    local attempt
    for attempt in $(seq 1 "${ADB_READY_TIMEOUT}"); do
        if adb devices >/dev/null 2>&1; then
            cleanup_lock
            trap - EXIT
            return 0
        fi
        sleep 1
    done

    echo "[adb-guard] ADB server did not become ready within ${ADB_READY_TIMEOUT}s" >&2
    cleanup_lock
    trap - EXIT
    return 1
}

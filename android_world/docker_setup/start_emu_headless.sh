#!/bin/bash

# Configuration
emulator_name=${EMULATOR_NAME}

source /app/docker_setup/adb_guard.sh
ensure_adb_ready

DEVICE_READY_MARKER="/tmp/adb-device-ready"
rm -f "$DEVICE_READY_MARKER"

function check_hardware_acceleration() {
    if [ -e /dev/kvm ]; then
        echo "-accel on"
    else
        echo "-accel off"
    fi
}

hw_accel_flag=$(check_hardware_acceleration)
fast_flags="-no-audio -no-metrics -netfast -camera-back none -camera-front none"
extra_flags="${EMULATOR_EXTRA_FLAGS:-}"
snapshot_enable="${EMULATOR_SNAPSHOT_ENABLE:-1}"
snapshot_name="${EMULATOR_SNAPSHOT_NAME:-w8rl_clean}"
snapshot_after_install="${EMULATOR_SNAPSHOT_AFTER_INSTALL:-1}"
snapshot_wait_timeout="${EMULATOR_SNAPSHOT_WAIT_TIMEOUT:-300}"
rehydrate_enable="${EMULATOR_REHYDRATE_AVD:-1}"
wipe_data="${EMULATOR_WIPE_DATA:-0}"
avd_home="${ANDROID_AVD_HOME:-$HOME/.android/avd}"
avd_dir="${avd_home}/${emulator_name}.avd"

rehydrate_avd() {
    if [ "$rehydrate_enable" -ne 1 ]; then
        return 0
    fi

    if [ -f "${avd_home}/${emulator_name}.ini" ]; then
        return 0
    fi

    if [ -d "/opt/avd-base" ]; then
        echo "Rehydrating AVD definition into ${avd_home}"
        mkdir -p "${avd_home}"
        cp -a /opt/avd-base/. "${avd_home}/"
    fi
}

# Validate a snapshot directory has all required files and is not corrupt
validate_snapshot() {
    local snapshot_dir="$1"
    local required_files=("ram.bin" "snapshot.pb" "hardware.ini")

    if [ ! -d "$snapshot_dir" ]; then
        echo "Snapshot validation failed: directory does not exist"
        return 1
    fi

    for file in "${required_files[@]}"; do
        if [ ! -f "${snapshot_dir}/${file}" ]; then
            echo "Snapshot validation failed: missing ${file}"
            return 1
        fi
    done

    # Check ram.bin is non-empty (corruption check)
    # Valid ram.bin is typically ~1GB; anything < 1MB is definitely corrupt
    local ram_size
    ram_size=$(stat -c%s "${snapshot_dir}/ram.bin" 2>/dev/null || echo 0)
    if [ "$ram_size" -lt 1000000 ]; then
        echo "Snapshot validation failed: ram.bin too small (${ram_size} bytes, expected >= 1MB)"
        return 1
    fi

    echo "Snapshot validation passed (ram.bin: ${ram_size} bytes)"
    return 0
}

# 1. Launch Emulator
echo "Launching Emulator ($emulator_name)..."
# Ensure the AVD definition exists even when snapshots are on a volume.
rehydrate_avd

if [ "$rehydrate_enable" -ne 1 ] && [ ! -f "${avd_home}/${emulator_name}.ini" ]; then
    echo "AVD definition missing and rehydration disabled. Enable EMULATOR_REHYDRATE_AVD or seed ${avd_home}."
    exit 1
fi

# Safe kill of any prior emulator sessions without tripping -e/pipefail.
adb devices | awk '/emulator/{print $1}' | while read -r emu_id; do
    [ -n "$emu_id" ] && adb -s "$emu_id" emu kill || true
done

snapshot_flags="-no-snapshot-save -no-snapshot-load"
if [ "$snapshot_enable" -eq 1 ]; then
    snapshot_dir="${avd_dir}/snapshots/${snapshot_name}"
    if [ -d "$snapshot_dir" ]; then
        if validate_snapshot "$snapshot_dir"; then
            echo "Using validated snapshot ${snapshot_name} from ${avd_dir}"
            snapshot_flags="-snapshot ${snapshot_name} -no-snapshot-save"
        else
            echo "Snapshot ${snapshot_name} validation failed; cold boot with save enabled"
            # Remove invalid snapshot so it can be recreated
            rm -rf "$snapshot_dir"
            snapshot_flags="-no-snapshot-load"
        fi
    else
        echo "Snapshot ${snapshot_name} not found; cold boot with save enabled"
        snapshot_flags="-no-snapshot-load"
    fi
fi

wipe_flags=""
if [ "$wipe_data" -eq 1 ]; then
    echo "Cold boot enabled: wiping emulator data"
    wipe_flags="-wipe-data"
fi

options="@${emulator_name} -no-window -no-boot-anim -memory 2048 ${hw_accel_flag} -grpc 8554 ${snapshot_flags} ${wipe_flags} ${fast_flags} ${extra_flags}"

emulator $options -gpu off &
EMULATOR_PID=$!

echo "Emulator PID: $EMULATOR_PID"

# 2. Wait for Boot
echo "Waiting for boot..."
start_time=$(date +%s)
timeout=${EMULATOR_TIMEOUT:-300}

while true; do
    if ! kill -0 "$EMULATOR_PID" 2>/dev/null; then
        echo "Emulator process exited before boot completed"
        exit 1
    fi

    result=$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)
    
    if [ "$result" == "1" ]; then
        touch "$DEVICE_READY_MARKER"
        echo "Emulator boot complete - marker created (${DEVICE_READY_MARKER})"
        echo "Emulator is ready!"
        break
    fi

    if [ $(( $(date +%s) - start_time )) -ge "$timeout" ]; then
        echo "Emulator boot timeout after ${timeout}s"
        exit 1
    fi

    sleep 4
done

# 3. Setup Environment
echo "Disabling animations..."
adb shell "settings put global window_animation_scale 0.0"
adb shell "settings put global transition_animation_scale 0.0"
adb shell "settings put global animator_duration_scale 0.0"

save_snapshot() {
    local max_retries=3
    local retry_delay=5

    if [ "$snapshot_enable" -ne 1 ]; then
        return 0
    fi

    # Skip if snapshot already exists and is valid
    local snapshot_dir="${avd_dir}/snapshots/${snapshot_name}"
    if [ -d "$snapshot_dir" ]; then
        if validate_snapshot "$snapshot_dir"; then
            echo "Valid snapshot ${snapshot_name} already exists"
            return 0
        else
            echo "Existing snapshot invalid, will recreate"
            rm -rf "$snapshot_dir"
        fi
    fi

    # Wait for APK install if configured
    if [ "$snapshot_after_install" -eq 1 ]; then
        local waited=0
        while [ ! -f "/tmp/install-apks-done" ] && [ $waited -lt "$snapshot_wait_timeout" ]; do
            if [ -f "/tmp/install-apks-failed" ]; then
                echo "Snapshot skipped: APK install failed"
                return 1
            fi
            sleep 2
            waited=$((waited + 2))
        done
    fi

    local emu_serial
    emu_serial=$(adb devices | awk '/emulator/{print $1; exit}')
    if [ -z "$emu_serial" ]; then
        echo "Snapshot skipped: no emulator serial found"
        return 1
    fi

    # Retry loop for snapshot save
    local attempt
    for attempt in $(seq 1 $max_retries); do
        echo "Saving snapshot ${snapshot_name} (attempt ${attempt}/${max_retries}, serial: ${emu_serial})"

        if adb -s "$emu_serial" emu avd snapshot save "$snapshot_name" 2>/dev/null; then
            # Allow filesystem sync
            sleep 2

            if validate_snapshot "$snapshot_dir"; then
                echo "Snapshot ${snapshot_name} saved and validated successfully"
                return 0
            else
                echo "Snapshot save produced invalid result"
                rm -rf "$snapshot_dir"
            fi
        else
            echo "Snapshot save command failed"
        fi

        if [ "$attempt" -lt "$max_retries" ]; then
            echo "Retrying in ${retry_delay}s..."
            sleep "$retry_delay"
        fi
    done

    echo "ERROR: Failed to save snapshot after ${max_retries} attempts"
    return 1
}

save_snapshot &
SNAPSHOT_PID=$!

# Cleanup function to kill background jobs on exit
cleanup_on_exit() {
    if [ -n "$SNAPSHOT_PID" ] && kill -0 "$SNAPSHOT_PID" 2>/dev/null; then
        echo "Cleaning up snapshot job (PID $SNAPSHOT_PID)..."
        kill "$SNAPSHOT_PID" 2>/dev/null || true
    fi
}
trap cleanup_on_exit EXIT

# NOTE: CDP setup (browser launch, adb forward, socat bridge) is now handled
# by the cdp-bridge s6 service to ensure proper sequencing and health checks.

echo "Emulator Setup Complete. Keeping process alive..."
wait $EMULATOR_PID

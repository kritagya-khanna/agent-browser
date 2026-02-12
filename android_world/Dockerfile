# syntax=docker/dockerfile:1.7
FROM budtmo/docker-android:emulator_14.0

# Switch to root to install packages and s6
USER root

ENV DEBIAN_FRONTEND=noninteractive
ENV S6_KEEP_ENV=1
ENV S6_BEHAVIOUR_IF_STAGE2_FAILS=2
ENV VIRTUAL_ENV=/opt/py311
ENV PATH="${VIRTUAL_ENV}/bin:/root/.local/bin:${PATH}"

#=============================
# 1. Install s6-overlay
#=============================
ARG S6_OVERLAY_VERSION=3.1.6.2

# Install system packages with cache mounts (kernel-images pattern)
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    xz-utils curl socat bc

# Download and install s6-overlay with cache
RUN --mount=type=cache,target=/tmp/s6-cache \
    S6_NOARCH="/tmp/s6-cache/s6-overlay-noarch-${S6_OVERLAY_VERSION}.tar.xz" && \
    S6_X86="/tmp/s6-cache/s6-overlay-x86_64-${S6_OVERLAY_VERSION}.tar.xz" && \
    if [ ! -f "$S6_NOARCH" ]; then \
        curl -L -o "$S6_NOARCH" \
            "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz"; \
    fi && \
    if [ ! -f "$S6_X86" ]; then \
        curl -L -o "$S6_X86" \
            "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-x86_64.tar.xz"; \
    fi && \
    tar -C / -Jxpf "$S6_NOARCH" && \
    tar -C / -Jxpf "$S6_X86"

#=============================
# 2. Install uv & Python 3.11
#=============================
RUN set -eux; \
    curl -LsSf https://astral.sh/uv/install.sh | sh

RUN set -eux; \
    uv python install 3.11; \
    PY311="$(uv python find 3.11)"; \
    uv venv -p "$PY311" --seed /opt/py311

# Define emulator environment variables - Using Android 14 (API 34)
# Note: Android 15 (API 35) has issues with Chrome command-line flags for remote debugging
ENV EMULATOR_NAME="Pixel_6_API_34"
ENV EMULATOR_DEVICE="pixel_6"
ENV ANDROID_API_LEVEL=34
# Ensure AVD is created in root's home and visible
ENV HOME=/root
ENV ANDROID_SDK_HOME=/root/.android
ENV ANDROID_AVD_HOME=/root/.android/avd

#=============================
# 3. Android SDK (BEFORE source code - cached)
#=============================
# Symlink SDK for internal tools
RUN mkdir -p /opt && \
    if [ -d "$ANDROID_SDK_ROOT" ]; then \
        if [ ! -d "/opt/android" ]; then ln -s "$ANDROID_SDK_ROOT" /opt/android; fi \
    elif [ -d "/opt/android-sdk" ]; then \
        ln -s /opt/android-sdk /opt/android; \
    fi

# Install Android 14 (API 34) system image and create AVD
# This layer is cached - only rebuilds if base image or above layers change
# Retry logic for flaky Google SDK servers
RUN yes | sdkmanager --licenses && \
    for i in 1 2 3 4 5; do \
        sdkmanager "system-images;android-34;google_apis;x86_64" && break || \
        echo "Retry $i/5 failed, waiting 10s..." && sleep 10; \
    done && \
    echo "no" | avdmanager create avd --force --name "${EMULATOR_NAME}" --device "${EMULATOR_DEVICE}" --package "system-images;android-34;google_apis;x86_64"

# Preserve a copy of the baked AVD so volumes can be rehydrated at runtime.
RUN AVD_INI="$(find / -name "${EMULATOR_NAME}.ini" -print -quit)" && \
    if [ -z "$AVD_INI" ]; then \
        echo "AVD ini not found for ${EMULATOR_NAME}" >&2; \
        exit 1; \
    fi && \
    AVD_HOME_DIR="$(dirname "$AVD_INI")" && \
    mkdir -p /opt/avd-base && \
    cp -a "${AVD_HOME_DIR}/." /opt/avd-base/

#=============================
# 4. Python Dependencies (Cached)
#=============================
WORKDIR /app
COPY pyproject.toml requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install -U pip setuptools wheel && \
    uv pip install --only-binary=:all: -r requirements.txt

#=============================
# 4.5. Strip Unused Components
#=============================
# Remove noVNC, websockify, Xvfb (inherited from budtmo, not needed for headless CDP)
RUN apt-get remove -y \
      xvfb x11vnc novnc websockify xterm openbox menu 2>/dev/null || true && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# Remove device skins (saves ~100MB)
RUN rm -rf ${ANDROID_HOME}/skins/* 2>/dev/null || true

# Remove unused SDK components (saves ~300MB+)
RUN rm -rf \
    ${ANDROID_HOME}/extras \
    ${ANDROID_HOME}/patcher \
    ${ANDROID_HOME}/build-tools \
    ${ANDROID_HOME}/sources \
    ${ANDROID_HOME}/ndk* \
    ${ANDROID_HOME}/cmake \
    2>/dev/null || true

#=============================
# 5. Copy Application Code
#=============================
WORKDIR /app
COPY . /app
# Skip installing the package itself to avoid build hangs.
# We just add /app to PYTHONPATH so imports work.
ENV PYTHONPATH="/app:${PYTHONPATH}"

# Fix permissions for scripts (Critical Fix)
RUN chmod a+x /app/docker_setup/*.sh

#=============================
# 6. S6 Service Setup
#=============================
COPY docker_setup/s6/emulator/run /etc/services.d/emulator/run
COPY docker_setup/s6/android_world/run /etc/services.d/android_world/run
COPY docker_setup/s6/cdp-bridge/run /etc/services.d/cdp-bridge/run
COPY docker_setup/s6/install-apks/run /etc/services.d/install-apks/run
COPY docker_setup/s6/install-apks/type /etc/services.d/install-apks/type
# Vaccine service (auto-permissions)
COPY docker_setup/vaccine-run /etc/services.d/vaccine/run

RUN chmod +x /etc/services.d/emulator/run \
             /etc/services.d/android_world/run \
             /etc/services.d/cdp-bridge/run \
             /etc/services.d/install-apks/run \
             /etc/services.d/vaccine/run

#=============================
# 7. APKs (LAST layer - baked into image)
#=============================
# APK changes only rebuild this layer, not the SDK
COPY docker_setup/apks/ /android/apks/

#=============================
# 8. Health Check
#=============================
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD curl -sf http://localhost:5000/health || exit 1

ENTRYPOINT ["/init"]

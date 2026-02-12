# APKs Directory

Place APK files in this directory to have them automatically installed when the Android emulator boots.

## Usage

1. Copy your `.apk` files to this directory
2. Rebuild the Docker image: `docker compose build android`
3. Start the container: `docker compose up -d android`

The `install-apks` s6 service will:
- Wait for the emulator to fully boot
- Install each APK using `adb install -r` (replace existing)
- Log installation results

## Example

```bash
# Download an APK
wget -O docker_setup/apks/myapp.apk https://example.com/myapp.apk

# Rebuild and restart
docker compose build android
docker compose up -d android

# Check installation logs
docker logs android-world 2>&1 | grep install-apks
```

## Notes

- APKs are installed with `-r` flag (replace if exists)
- Installation happens after emulator boot but before CDP bridge starts
- Failed installations are logged but don't stop the container
- Large APKs may take time to install; check logs for status

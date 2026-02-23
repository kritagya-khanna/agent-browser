import { spawn, spawnSync, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

export class Orchestrator {
  private composeFile: string;

  constructor(distMode: boolean) {
    this.composeFile = path.join(
      PROJECT_ROOT,
      distMode ? 'docker-compose.sdk.yml' : 'docker-compose.prod.yml'
    );
  }

  private log(msg: string, level: 'info' | 'success' | 'warn' | 'error' = 'info') {
    const colors = {
      info: '\x1b[34m', // Blue
      success: '\x1b[32m', // Green
      warn: '\x1b[33m', // Yellow
      error: '\x1b[31m', // Red
      reset: '\x1b[0m',
    };
    console.log(`${colors[level]}[SDK]${colors.reset} ${msg}`);
  }

  private runCommand(cmd: string, env: Record<string, string> = {}): boolean {
    try {
      execSync(cmd, {
        stdio: 'inherit',
        env: { ...process.env, ...env },
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  private getContainerId(serviceName: string): string | null {
    try {
      const output = execSync(`docker compose -f "${this.composeFile}" ps -q ${serviceName}`, {
        encoding: 'utf-8',
      });
      return output.trim() || null;
    } catch {
      return null;
    }
  }

  private isPortMapped(containerId: string, port: number): boolean {
    try {
      const output = execSync(`docker port "${containerId}" ${port}`, { encoding: 'utf-8' });
      return output.includes('0.0.0.0:') || output.includes(':::');
    } catch {
      return false;
    }
  }

  private async pullImagesWithRetry(): Promise<void> {
    if (!this.composeFile.endsWith('docker-compose.sdk.yml')) return;

    this.log('Please wait while we get things ready...', 'info');
    const maxRetries = 10;

    for (let count = 0; count < maxRetries; count++) {
      if (this.runCommand(`docker compose -f "${this.composeFile}" pull`)) {
        return;
      }
      this.log(
        `Download failed/interrupted. Retrying (${count + 1}/${maxRetries}) in 10s...`,
        'warn'
      );
      await new Promise((r) => setTimeout(r, 10000));
    }

    this.log(
      `Failed to download images after ${maxRetries} attempts. Check internet connection.`,
      'error'
    );
    process.exit(1);
  }

  private async hasSnapshot(): Promise<boolean> {
    try {
      // 1. Check if volume exists
      execSync(`docker volume inspect agent-snapshots`, { stdio: 'ignore' });

      // 2. Check if volume contains the 'quickboot' directory
      // We use a tiny helper container to look inside the managed volume
      const output = execSync(`docker run --rm -v agent-snapshots:/data busybox ls /data`, {
        encoding: 'utf-8',
      });
      return output.includes('quickboot');
    } catch {
      return false;
    }
  }

  public async start(): Promise<void> {
    this.log(`Initializing Agent Environment...`, 'info');

    await this.pullImagesWithRetry();

    this.log('Cleaning up previous container state...', 'info');
    this.runCommand(`docker compose -f "${this.composeFile}" down -v --remove-orphans`);

    const hasSnapshot = await this.hasSnapshot();

    if (hasSnapshot) {
      // === WARM START ===
      this.log('Found cached baseline snapshot. Performing HYPER-SPEED WARM BOOT...', 'success');

      const success = this.runCommand(`docker compose -f "${this.composeFile}" up -d`, {
        EMULATOR_SNAPSHOT_NAME: 'quickboot',
      });

      if (!success) throw new Error('Startup failed during docker compose up.');

      const agentCont = this.getContainerId('agent-service');
      const androidCont = this.getContainerId('android-service');

      // Verify Port Mapping
      if (agentCont && !this.isPortMapped(agentCont, 3000)) {
        this.log('Port 3000 (Host 32001) is not mapped! Container config is stale.', 'warn');
        this.log('Forcing full restart to apply network settings...', 'info');
        this.runCommand(`docker compose -f "${this.composeFile}" down -v --remove-orphans`);
        await new Promise((r) => setTimeout(r, 5000));
        this.runCommand(`docker compose -f "${this.composeFile}" up -d`, {
          EMULATOR_SNAPSHOT_NAME: 'quickboot',
        });
      }

      if (androidCont) {
        this.log('Rehydrating Android network connection...', 'info');
        try {
          execSync(`docker exec "${androidCont}" adb shell cmd connectivity airplane-mode enable`, {
            stdio: 'ignore',
          });
          await new Promise((r) => setTimeout(r, 2000));
          execSync(
            `docker exec "${androidCont}" adb shell cmd connectivity airplane-mode disable`,
            { stdio: 'ignore' }
          );
          await new Promise((r) => setTimeout(r, 3000));
        } catch (e) {
          this.log(`Network rehydration warning: ${e}`, 'warn');
        }
      }

      this.log('Waiting for Daemon Connection...');
      if (agentCont) await this.waitForLog(agentCont, 'Daemon listening on TCP', 180000);
    } else {
      // === COLD START ===
      this.log('No baseline found. Performing FIRST RUN SETUP (Cold Boot)...', 'warn');
      this.log('This will take ~60-90 seconds, but only once.', 'warn');

      const success = this.runCommand(`docker compose -f "${this.composeFile}" up -d`, {
        EMULATOR_SNAPSHOT_NAME: '',
      });

      if (!success) throw new Error('Startup failed during docker compose up.');

      let androidCont = this.getContainerId('android-service');
      const agentCont = this.getContainerId('agent-service');

      if (!androidCont) throw new Error('Error: Android container not found.');

      // Verify Port Mapping
      if (agentCont && !this.isPortMapped(agentCont, 3000)) {
        this.log('Port 3000 (Host 32001) is not mapped! Container config is stale.', 'warn');
        this.log('Forcing full restart to apply network settings...', 'info');
        this.runCommand(`docker compose -f "${this.composeFile}" down -v --remove-orphans`);
        await new Promise((r) => setTimeout(r, 5000));
        this.runCommand(`docker compose -f "${this.composeFile}" up -d`, {
          EMULATOR_SNAPSHOT_NAME: '',
        });
        androidCont = this.getContainerId('android-service') || androidCont;
      }

      this.log('Waiting for Android OS to boot (this takes a moment)...', 'info');
      await this.waitForLog(androidCont, 'Emulator boot complete');

      this.log('Waiting for Browser Installation...', 'info');
      await this.waitForLog(androidCont, 'APK installation complete');

      this.log('Waiting for CDP Bridge...', 'info');
      await this.waitForLog(androidCont, 'CDP Bridge ready');

      this.log('Waiting for Agent Daemon Connection...');
      if (agentCont) await this.waitForLog(agentCont, 'Daemon listening on TCP');

      // Save Snapshot
      this.log('Saving emulator state (quickboot)...', 'info');
      const saved = this.runCommand(
        `docker exec "${androidCont}" adb emu avd snapshot save quickboot`
      );
      if (saved) {
        this.log('Snapshot saved to host volume.', 'success');
        this.log('Setup Complete! Future runs will launch instantly.', 'success');
      } else {
        throw new Error('Failed to save snapshot inside emulator.');
      }
    }
  }

  public async stop(): Promise<void> {
    this.log('Stopping environment...', 'info');
    this.runCommand(`docker compose -f "${this.composeFile}" down -v --remove-orphans`);
    this.log('Environment cleaned and stopped.', 'success');
  }

  public async reset(): Promise<void> {
    this.log('Performing Fast Browser Reset...', 'info');
    const androidCont = this.getContainerId('android-service');
    if (!androidCont) {
      this.log('Android container not running.', 'error');
      return;
    }

    this.log('Initiating fast reset (userspace reboot)...', 'info');
    try {
      execSync(`docker exec "${androidCont}" adb shell reboot userspace`, { stdio: 'ignore' });
    } catch {
      // Ignored
    }

    this.log('Waiting for device to come online...', 'info');
    const start = Date.now();
    let online = false;

    while (Date.now() - start < 30000) {
      try {
        const state = execSync(`docker exec "${androidCont}" adb get-state`, {
          encoding: 'utf-8',
        }).trim();
        if (state === 'device') {
          execSync(`docker exec "${androidCont}" adb shell echo ok`, { stdio: 'ignore' });
          online = true;
          break;
        }
      } catch {
        // Still offline
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (!online) throw new Error('Timeout waiting for device after reboot');
    this.log('Device online', 'success');

    this.log('Waiting for browser CDP...', 'info');
    const cdpStart = Date.now();
    let cdpReady = false;

    while (Date.now() - cdpStart < 30000) {
      try {
        execSync(
          `docker exec "${androidCont}" curl -s --connect-timeout 2 http://localhost:9224/json/version`,
          { stdio: 'ignore' }
        );
        cdpReady = true;
        break;
      } catch {
        if (Date.now() - cdpStart > 15000) {
          try {
            execSync(
              `docker exec "${androidCont}" adb shell am start -n com.wootzapp.web/com.aspect.chromium.ChromiumMain -a android.intent.action.VIEW -d 'about:blank'`,
              { stdio: 'ignore' }
            );
          } catch {}
        }
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (!cdpReady) throw new Error('Timeout waiting for CDP');
    this.log('Fast reset complete!', 'success');
  }

  private waitForLog(container: string, pattern: string, timeoutMs = 120000): Promise<void> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tail = spawn('docker', ['logs', '-f', container]);

      const timer = setTimeout(() => {
        tail.kill();
        reject(new Error(`Timeout waiting for log pattern "${pattern}" in container ${container}`));
      }, timeoutMs);

      tail.stdout.on('data', (data) => {
        if (data.toString().includes(pattern)) {
          clearTimeout(timer);
          tail.kill();
          resolve();
        }
      });

      tail.stderr.on('data', (data) => {
        if (data.toString().includes(pattern)) {
          clearTimeout(timer);
          tail.kill();
          resolve();
        }
      });

      tail.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
}

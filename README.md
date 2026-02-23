# @kritchoff/agent-browser

<p align="center">
  <strong>The Ultimate Headless Android Browser SDK & CLI for AI Agents</strong>
</p>

This package provides a **Real Android Browser** (WootzApp) wrapped in a Docker container, controlled by a high-speed, Playwright-like TypeScript daemon. 

It is specifically designed for AI Agents to navigate the mobile web, bypass bot detection, and generate LLM-friendly semantic trees (`AXTree`).

---

## 🌟 Key Features

- **Cross-Platform**: Works natively on **Windows, macOS (Intel & Apple Silicon), and Linux** using a pure Node.js Orchestrator (No WSL or bash required).
- **Bundled CLI**: Control the browser directly from your terminal (`agent-browser start`).
- **Zero-Config Setup**: Automatically downloads and orchestrates the required Docker containers.
- **Hyper-Speed Warm Boots**: Uses advanced VDI Volume Mounting to boot the Android environment in **< 5 seconds** after the first run.
- **Fast Resets**: Cleans the browser state via Android userspace reboot in **~15 seconds**.
- **Playwright Parity**: Control the mobile browser using standard Playwright commands (`click`, `type`, `waitForSelector`).
- **Semantic AXTree**: Built-in `snapshot()` method generates a clean, text-based UI tree optimized for LLM reasoning.

---

## 🛠️ Prerequisites

1.  **Docker Engine**: Must be installed and running.
    - *Windows/Mac Users*: Install [Docker Desktop](https://www.docker.com/products/docker-desktop/).
    - *Linux Users*: Ensure your user is in the `docker` group (`sudo usermod -aG docker $USER`).
2.  **Node.js**: v18+ is required.

---

## 💻 Global CLI Usage (Recommended for Testing)

The easiest way to use the Agent Browser is via the global Command Line Interface.

```bash
# 1. Install globally
npm install -g @kritchoff/agent-browser

# 2. Start the environment (Takes ~90s first time, ~5s after)
agent-browser start

# 3. Run commands interactively
agent-browser navigate https://news.ycombinator.com
agent-browser click ".titleline a"

# 4. Get the Semantic UI Tree printed to your terminal
agent-browser snapshot

# 5. Clean the browser state for a new session (~15s)
agent-browser reset

# 6. Completely stop and tear down containers
agent-browser stop
```

---

## 📦 Node.js SDK Usage (For your AI Agents)

Install the SDK locally in your project:

```bash
npm install @kritchoff/agent-browser
```

*(Optional but recommended)* Install `tsx` to run TypeScript files natively:
```bash
npm install -D tsx
```

### Quick Start Code (`agent.ts`)

```typescript
import { WootzAgent } from '@kritchoff/agent-browser';

async function main() {
  // 1. Initialize the controller
  const agent = new WootzAgent();

  console.log('🚀 Booting Environment...');
  // First run: Downloads 3GB image and cold boots (~90s).
  // Next run: Instant Hyper-Speed Warm Boot (~5s).
  await agent.start();

  console.log('🌐 Navigating to Google...');
  await agent.navigate('https://google.com');

  console.log('📸 Capturing Semantic Tree for LLM...');
  const uiTree = await agent.snapshot();
  console.log(uiTree); 

  console.log('⌨️ Typing and Searching...');
  await agent.type('textarea[name="q"]', 'WootzApp AI');
  await agent.press('Enter');

  console.log('🧹 Fast Reset for next task...');
  // Wipes all tabs, cookies, and cache in ~15s
  await agent.reset(); 

  console.log('🛑 Shutting down...');
  // Completely destroys containers and releases ports
  await agent.stop();
}

main().catch(console.error);
```

Run your agent:
```bash
npx tsx agent.ts
```

---

## 📖 Complete API Reference

For a complete list of all available commands (clicking, typing, tabbing, network interception, storage), please read the **[COMMANDS.md](./COMMANDS.md)** file.

---

## ❓ Troubleshooting

### `Error: Timed out waiting for Agent Daemon on port 32001`
- **Cause**: The Android container took too long to download or boot, or your machine is slow. (We wait 3 minutes by default).
- **Fix**: Run `agent-browser stop` and try `agent-browser start` again. The Docker images might still be downloading in the background.

### `net::ERR_NAME_NOT_RESOLVED`
- **Cause**: The Android Emulator temporarily lost its internet connection after a Warm Boot.
- **Fix**: The SDK automatically toggles Airplane Mode to fix this DHCP issue. If it persists, ensure your host machine has a stable internet connection and your VPN/Firewall isn't blocking Docker bridge networks.

### `Selector "..." matched X elements (Strict Mode Violation)`
- **Cause**: Playwright requires selectors to point to exactly one element.
- **Fix**: Use more specific selectors, or use Playwright's `>> nth=0` pseudo-selector to pick the first match (e.g., `agent.click('a >> nth=0')`).

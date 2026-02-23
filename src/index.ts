import * as net from 'net';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { Orchestrator } from './orchestrator.js';

const DAEMON_PORT = 32001;

export interface AgentOptions {
  /**
   * Use distribution mode (pull images from Docker Hub instead of building locally)
   * Default: true
   */
  dist?: boolean;
}

export class WootzAgent {
  private options: AgentOptions;
  private orchestrator: Orchestrator;

  constructor(options: AgentOptions = {}) {
    this.options = {
      dist: true, // Default to distribution mode for end users
      ...options,
    };
    this.orchestrator = new Orchestrator(this.options.dist!);
  }

  // --- Lifecycle Management (Infrastructure) ---

  async start(): Promise<void> {
    await this.orchestrator.start();
    // Ensure daemon is reachable before returning
    await this.waitForDaemon();
  }

  /**
   * Polls the daemon port until it accepts connections.
   */
  private async waitForDaemon(timeoutMs = 180000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        await this.sendCommand({ action: 'tab_list' }); // Health check
        return; // Success
      } catch (e) {
        // Wait 1s and retry
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    throw new Error(
      `Timed out waiting for Agent Daemon on port ${DAEMON_PORT} after ${timeoutMs / 1000}s`
    );
  }

  async stop(): Promise<void> {
    await this.orchestrator.stop();
  }

  async reset(): Promise<void> {
    await this.orchestrator.reset();
  }

  // --- Core Browser Actions (Direct Daemon) ---

  async navigate(
    url: string,
    waitUntil: 'load' | 'domcontentloaded' | 'networkidle' = 'load'
  ): Promise<string> {
    return await this.sendCommand({ action: 'navigate', url, waitUntil });
  }

  async click(selector: string): Promise<string> {
    return await this.sendCommand({ action: 'click', selector });
  }

  async doubleClick(selector: string): Promise<string> {
    return await this.sendCommand({ action: 'dblclick', selector });
  }

  async type(selector: string, text: string, delay?: number): Promise<string> {
    return await this.sendCommand({ action: 'type', selector, text, delay });
  }

  async fill(selector: string, value: string): Promise<string> {
    return await this.sendCommand({ action: 'fill', selector, value });
  }

  async check(selector: string): Promise<string> {
    return await this.sendCommand({ action: 'check', selector });
  }

  async uncheck(selector: string): Promise<string> {
    return await this.sendCommand({ action: 'uncheck', selector });
  }

  async hover(selector: string): Promise<string> {
    return await this.sendCommand({ action: 'hover', selector });
  }

  async focus(selector: string): Promise<string> {
    return await this.sendCommand({ action: 'focus', selector });
  }

  async press(key: string, selector?: string): Promise<string> {
    return await this.sendCommand({ action: 'press', key, selector });
  }

  async selectOption(selector: string, value: string | string[]): Promise<string> {
    return await this.sendCommand({ action: 'select', selector, values: value });
  }

  // --- Introspection & State ---

  async snapshot(): Promise<string> {
    // We request the raw response data for the snapshot
    const result = await this.sendCommand({ action: 'snapshot' }, true);
    // The daemon returns { snapshot: "...", refs: ... }
    return result.snapshot || '';
  }

  async innerText(selector: string): Promise<string> {
    const res = await this.sendCommand({ action: 'innertext', selector }, true);
    return res.text;
  }

  async innerHTML(selector: string): Promise<string> {
    const res = await this.sendCommand({ action: 'innerhtml', selector }, true);
    return res.html;
  }

  async getAttribute(selector: string, attribute: string): Promise<string> {
    const res = await this.sendCommand({ action: 'getattribute', selector, attribute }, true);
    return res.value;
  }

  async inputValue(selector: string): Promise<string> {
    const res = await this.sendCommand({ action: 'inputvalue', selector }, true);
    return res.value;
  }

  async isVisible(selector: string): Promise<boolean> {
    const res = await this.sendCommand({ action: 'isvisible', selector }, true);
    return res.visible;
  }

  async isEnabled(selector: string): Promise<boolean> {
    const res = await this.sendCommand({ action: 'isenabled', selector }, true);
    return res.enabled;
  }

  async isChecked(selector: string): Promise<boolean> {
    const res = await this.sendCommand({ action: 'ischecked', selector }, true);
    return res.checked;
  }

  // --- Waiting & Navigation ---

  async waitForSelector(
    selector: string,
    state: 'attached' | 'detached' | 'visible' | 'hidden' = 'visible',
    timeout?: number
  ): Promise<string> {
    return await this.sendCommand({ action: 'wait', selector, state, timeout });
  }

  async waitForTimeout(ms: number): Promise<string> {
    return await this.sendCommand({ action: 'wait', timeout: ms });
  }

  async waitForLoadState(
    state: 'load' | 'domcontentloaded' | 'networkidle' = 'load'
  ): Promise<string> {
    return await this.sendCommand({ action: 'waitforloadstate', state });
  }

  async reload(): Promise<string> {
    return await this.sendCommand({ action: 'reload' });
  }

  async goBack(): Promise<string> {
    return await this.sendCommand({ action: 'back' });
  }

  async goForward(): Promise<string> {
    return await this.sendCommand({ action: 'forward' });
  }

  // --- Semantic Locators ---

  async getByRole(role: string, name?: string, exact: boolean = false): Promise<string> {
    throw new Error(
      'Locator builders (getByRole) are not fully supported in stateless mode yet. Use standard selectors.'
    );
  }

  // --- Utilities ---

  async screenshot(path?: string): Promise<string> {
    const res = await this.sendCommand({ action: 'screenshot', path }, true);
    return res.path;
  }

  async scroll(x: number, y: number): Promise<string> {
    return await this.sendCommand({ action: 'scroll', x, y });
  }

  async evaluate(script: string): Promise<any> {
    const res = await this.sendCommand({ action: 'evaluate', script }, true);
    return res.result;
  }

  // --- Tab Management ---

  async newTab(url?: string): Promise<string> {
    return await this.sendCommand({ action: 'tab_new', url });
  }

  async switchTab(index: number): Promise<string> {
    return await this.sendCommand({ action: 'tab_switch', index });
  }

  async closeTab(index?: number): Promise<string> {
    return await this.sendCommand({ action: 'tab_close', index });
  }

  async listTabs(): Promise<any[]> {
    const res = await this.sendCommand({ action: 'tab_list' }, true);
    return res.tabs;
  }

  // --- Generic Execution ---

  async command(action: string, ...args: string[]): Promise<string> {
    const cmd: any = { action };

    if (action === 'open' || action === 'navigate') {
      cmd.action = 'navigate';
      cmd.url = args[0];
    } else if (action === 'click') {
      cmd.selector = args[0];
    } else if (action === 'type') {
      cmd.selector = args[0];
      cmd.text = args[1];
    } else if (action === 'press') {
      cmd.key = args[0];
    } else if (action === 'scroll') {
      cmd.x = parseInt(args[0] || '0');
      cmd.y = parseInt(args[1] || '0');
    } else if (action === 'wait') {
      if (/^\d+$/.test(args[0])) cmd.timeout = parseInt(args[0]);
      else cmd.selector = args[0];
    } else {
      if (args[0]) cmd.selector = args[0];
      if (args[1]) cmd.text = args[1] || args[1]; // value/text
    }

    const res = await this.sendCommand(cmd, true);

    if (typeof res === 'object') {
      if (res.text) return res.text;
      if (res.url) return res.url;
      if (res.snapshot) return res.snapshot;
      return JSON.stringify(res);
    }
    return String(res);
  }

  private sendCommand(command: any, returnData = false): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!command.id) command.id = randomUUID();

      const client = new net.Socket();

      client.connect(DAEMON_PORT, '127.0.0.1', () => {
        client.write(JSON.stringify(command) + '\n');
      });

      let responseBuffer = '';

      client.on('data', (data) => {
        responseBuffer += data.toString();
        if (responseBuffer.includes('\n')) {
          client.end();
        }
      });

      client.on('end', () => {
        try {
          const response = JSON.parse(responseBuffer.trim());
          if (response.success) {
            resolve(returnData ? response.data : 'OK');
          } else {
            reject(new Error(response.error || 'Unknown error'));
          }
        } catch (e) {
          reject(new Error(`Invalid response from daemon: ${responseBuffer}`));
        }
      });

      client.on('error', (err) => {
        reject(new Error(`Failed to connect to agent daemon (is it running?): ${err.message}`));
      });
    });
  }
}

export default WootzAgent;

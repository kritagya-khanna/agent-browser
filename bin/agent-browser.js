#!/usr/bin/env node

/**
 * WootzApp Agent Browser CLI
 * 
 * Provides terminal-based control over the Android Agent environment.
 * Usage:
 *   agent-browser start      - Initialize environment (Warm/Cold boot)
 *   agent-browser stop       - Stop environment
 *   agent-browser reset      - Fast browser reset (15s)
 *   agent-browser open <url> - Open a URL in the browser
 */

import { WootzAgent } from '../dist/index.js';

const args = process.argv.slice(2);
// Find the first argument that doesn't start with '-' to be the command
const command = args.find(arg => !arg.startsWith('-'));

if (!command || command === 'help') {
  console.log(`
WootzApp Agent Browser CLI

Usage:
  agent-browser start      Initialize and start the environment
  agent-browser stop       Stop the environment
  agent-browser reset      Fast reset the browser state
  agent-browser <cmd>      Run an agent command (e.g. open https://google.com)

Options:
  --dist                   Use pre-built images from Docker Hub (default)
  --local                  Build images locally from source
`);
  process.exit(0);
}

// Check for mode flags
const isLocal = args.includes('--local');
// Filter out the --local/--dist flags before passing to command if necessary, 
// but currently our command() method handles raw args.
const filteredArgs = args.filter(arg => arg !== '--local' && arg !== '--dist');

const agent = new WootzAgent({ dist: !isLocal });

async function main() {
  try {
    switch (command) {
      case 'start':
        await agent.start();
        break;
      case 'stop':
        await agent.stop();
        break;
      case 'reset':
        await agent.reset();
        break;
      default:
        // Pass through arbitrary commands to the agent daemon
        // e.g. "agent-browser open https://google.com"
        const result = await agent.command(...filteredArgs);
        console.log(result);
        break;
    }
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();

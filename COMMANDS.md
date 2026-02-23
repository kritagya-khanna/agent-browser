# SDK & CLI Command Reference

The `@kritchoff/agent-browser` SDK exposes a comprehensive API inspired by Playwright. Every command is executed asynchronously and returns a string (or JSON) via the high-speed TCP socket connected to the Android Emulator.

You can execute these commands in two ways:
1. **Node.js SDK**: Using the `WootzAgent` class in your TypeScript/JavaScript code.
2. **Terminal CLI**: Using the global `agent-browser` command.

This reference covers the most common actions your AI Agent will use.

---

## 🏗️ Environment Management

These commands handle the infrastructure, booting, snapshots, and container lifecycle.

### `start()`
Initializes and boots the Android Emulator and Agent Daemon.
*   **Cold Boot**: If no baseline snapshot exists, downloads the Docker image (~3GB), boots the OS (~60s), and automatically creates a snapshot.
*   **Warm Boot (Hyper-Speed)**: If a snapshot exists, injects it into RAM instantly (< 5s).
*   **Self-Healing**: Automatically detects if port `32001` failed to bind and forces a container restart.

**Node.js:**
```typescript
await agent.start();
```
**CLI:**
```bash
agent-browser start
```

### `stop()`
Gracefully stops and removes the Docker containers (`docker compose down -v`), releasing all ports and network namespaces.

**Node.js:**
```typescript
await agent.stop();
```
**CLI:**
```bash
agent-browser stop
```

### `reset()`
Performs a "Fast Reset" without restarting the Docker container.
*   Uses Android's `userspace reboot` to kill all apps and clear the cache.
*   Reconnects the CDP bridge automatically.
*   Takes ~15 seconds.

**Node.js:**
```typescript
await agent.reset();
```
**CLI:**
```bash
agent-browser reset
```

---

## 👁️ Introspection & State (The "Eyes")

These commands allow your LLM to "see" the page structure and extract data.

### `snapshot()`
Captures the Semantic Accessibility Tree (AXTree) of the current page.
*   Filters out noisy `<div>` soup.
*   Assigns unique `[ref=e1]` identifiers to interactive elements.
*   Returns a clean, YAML-like string representation.

**Node.js:**
```typescript
const tree = await agent.snapshot();
console.log(tree);
```
**CLI:**
```bash
agent-browser snapshot
```

### `innerText(selector)`
Returns the visible text content of an element.

**Node.js:**
```typescript
const price = await agent.innerText('.price-tag');
```
**CLI:**
```bash
agent-browser innerText ".price-tag"
```

### `innerHTML(selector)`
Returns the raw HTML of an element.

**Node.js:**
```typescript
const html = await agent.innerHTML('#article-body');
```
**CLI:**
```bash
agent-browser innerHTML "#article-body"
```

### `getAttribute(selector, attribute)`
Extracts a specific HTML attribute from an element.

**Node.js:**
```typescript
const src = await agent.getAttribute('img.logo', 'src');
```
**CLI:**
```bash
agent-browser getAttribute "img.logo" "src"
```

### `inputValue(selector)`
Gets the current value of an `<input>`, `<textarea>`, or `<select>`.

**Node.js:**
```typescript
const currentSearch = await agent.inputValue('input[name="q"]');
```
**CLI:**
```bash
agent-browser inputValue 'input[name="q"]'
```

### `isVisible(selector)` / `isEnabled(selector)` / `isChecked(selector)`
Returns a boolean indicating the state of an element.

**Node.js:**
```typescript
const canClick = await agent.isEnabled('#submit-btn');
```
**CLI:**
```bash
agent-browser isEnabled "#submit-btn"
```

---

## 🖱️ Interaction (The "Hands")

These commands interact with the browser exactly as a human would.

### `navigate(url)` / `open(url)`
Goes to a URL and waits for it to load.

**Node.js:**
```typescript
await agent.navigate('https://google.com');
```
**CLI:**
```bash
agent-browser open https://google.com
# or
agent-browser navigate https://google.com
```

### `click(selector)`
Clicks an element.
*   **Playwright Strict Mode**: If the selector matches multiple elements, it will throw an error. Use `>> nth=0` to force clicking the first match.

**Node.js:**
```typescript
// Click a specific element
await agent.click('button:has-text("Accept All")');

// Click the first link in a list
await agent.click('.results a >> nth=0');
```
**CLI:**
```bash
agent-browser click 'button:has-text("Accept All")'
agent-browser click ".results a >> nth=0"
```

### `type(selector, text)`
Types text into a field sequentially (like a human typing).

**Node.js:**
```typescript
await agent.type('input[name="search"]', 'Hello World');
```
**CLI:**
```bash
agent-browser type 'input[name="search"]' 'Hello World'
```

### `fill(selector, value)`
Instantly pastes the value into an input field (faster than `type`).

**Node.js:**
```typescript
await agent.fill('#email', 'user@example.com');
```
**CLI:**
```bash
agent-browser fill "#email" "user@example.com"
```

### `press(key, selector?)`
Presses a keyboard key. If a selector is provided, it focuses that element first.

**Node.js:**
```typescript
await agent.press('Enter');
await agent.press('Escape', '.modal-dialog');
```
**CLI:**
```bash
agent-browser press Enter
```

### `check(selector)` / `uncheck(selector)`
Checks or unchecks a checkbox or radio button.

**Node.js:**
```typescript
await agent.check('#terms-and-conditions');
```
**CLI:**
```bash
agent-browser check "#terms-and-conditions"
```

### `hover(selector)`
Moves the mouse over an element (useful for triggering CSS dropdowns).

**Node.js:**
```typescript
await agent.hover('.menu-item');
```
**CLI:**
```bash
agent-browser hover ".menu-item"
```

---

## ⏳ Waiting & Flow Control

Because mobile networks and heavy websites can be slow, you must wait for elements before interacting with them.

### `wait(selector_or_timeout)`
Waits for an element to become visible, or pauses execution for a specific number of milliseconds.

**Node.js:**
```typescript
// Wait up to 30 seconds for the search results container
await agent.waitForSelector('#rso');

// Sleep for 2 seconds
await agent.waitForTimeout(2000); 
```
**CLI:**
```bash
# Wait for element
agent-browser wait "#rso"

# Sleep for 2 seconds (2000 ms)
agent-browser wait 2000
```

### Navigation History
Go back, forward, or reload the current page.

**Node.js:**
```typescript
await agent.goBack();
await agent.goForward();
await agent.reload();
```
**CLI:**
```bash
agent-browser goBack
agent-browser goForward
agent-browser reload
```

---

## 🛠️ Advanced Utilities

### `screenshot(path?)`
Takes a screenshot of the current viewport and saves it. If no path is provided, it saves to the internal temp directory and returns the path.

**Node.js:**
```typescript
const filePath = await agent.screenshot('./evidence.png');
```
**CLI:**
```bash
agent-browser screenshot ./evidence.png
```

### `scroll(x, y)`
Scrolls the window by a specific pixel amount. Positive numbers scroll right/down, negative numbers scroll left/up.

**Node.js:**
```typescript
// Scroll down 500 pixels
await agent.scroll(0, 500);
```
**CLI:**
```bash
agent-browser scroll 0 500
```

### `evaluate(script)`
Executes raw JavaScript inside the browser context and returns the result.

**Node.js:**
```typescript
const title = await agent.evaluate('document.title');
```
**CLI:**
```bash
agent-browser evaluate "document.title"
```

---

## 📑 Tab Management

Control multiple browser tabs natively.

### `newTab(url?)` / `tab_new`
Opens a new tab, optionally navigating to a URL immediately.

**Node.js:**
```typescript
await agent.newTab('https://bing.com');
```
**CLI:**
```bash
agent-browser tab_new https://bing.com
```

### `switchTab(index)` / `tab_switch`
Switches focus to a specific tab index (0 is the first tab).

**Node.js:**
```typescript
await agent.switchTab(1);
```
**CLI:**
```bash
agent-browser tab_switch 1
```

### `closeTab(index?)` / `tab_close`
Closes a specific tab. If no index is provided, it closes the currently active tab.

**Node.js:**
```typescript
await agent.closeTab(0);
```
**CLI:**
```bash
agent-browser tab_close 0
```

### `listTabs()` / `tab_list`
Returns an array of objects detailing all open tabs (`index`, `url`, `title`, `active`).

**Node.js:**
```typescript
const tabs = await agent.listTabs();
console.log(tabs);
```
**CLI:**
```bash
agent-browser tab_list
```

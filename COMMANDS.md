# Agent Browser Commands Reference

This guide documents the available commands for the `agent-browser` CLI when running in the Docker Android environment.

## Usage

Use the provided `./agent` wrapper script to execute commands inside the container.

```bash
./agent <command> [arguments]
```

---

## Core Commands

### `open` (Navigation)
Navigate to a URL.
**Playwright Equivalent:** `page.goto(url)`

```bash
./agent open https://google.com
```

### `snapshot` (Vision)
Get the **DualMode AXTree** (Accessibility Tree) representation of the current page.
This custom output merges semantic structure (XRay) with visual design data (DesignMode).

```bash
./agent snapshot
```

**Output Format:**
```text
- link "Learn more" [ref=e2] [xray=importance:1.00] [design=fg:blue]
```
*   `ref=e2`: The ID used to click or interact with this element.
*   `xray`: Semantic info (importance, intent, actions).
*   `design`: Visual info (colors, size, prominence).

### `click` (Interaction)
Click an element. You can use:
1.  **Ref ID** (Recommended): Hits exact coordinates from the AXTree.
2.  **Selector**: Standard CSS/Text selector.

**Playwright Equivalent:** `page.click(selector)` (but powered by CDP coordinates for refs)

```bash
# Click by Ref (Best)
./agent click @e2

# Click by Text
./agent click "Learn more"
```

### `fill` (Input)
Type text into an input field.

**Playwright Equivalent:** `page.fill(selector, value)`

```bash
./agent fill @e9 "Hello World"
```

### `press` (Keyboard)
Press a specific key.

**Playwright Equivalent:** `page.keyboard.press(key)`

```bash
./agent press Enter
```

---

## Advanced Commands

### Scroll
Scroll the viewport.

```bash
./agent scroll down
./agent scroll down 500  # Scroll 500px
```

### Back / Forward / Reload
Standard navigation controls.

```bash
./agent back
./agent forward
./agent reload
```

### Wait
Wait for time or element.

```bash
./agent wait 2000        # Wait 2 seconds
./agent wait @e5         # Wait for element @e5 to appear
```

### Screenshot
Take a visual screenshot (saved inside container, needs volume mount to extract).

```bash
./agent screenshot
```

---

## Troubleshooting

### "Action timed out"
The Android Emulator can be slow. If an action times out:
1.  Run `./agent snapshot` to see if the page loaded or changed.
2.  The element might be covered or moving. Try clicking again.

### "Daemon not running"
Ensure the docker stack is up:
```bash
./start.sh
```

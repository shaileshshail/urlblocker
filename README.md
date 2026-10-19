# URL Blocker

A Chrome extension (Manifest V3) that blocks URLs matching your patterns, in every tab and on every URL change. That includes in-app (single-page app) route changes and `#hash` changes. Blocked pages show Chrome's own error page (`ERR_BLOCKED_BY_CLIENT`), and the address bar keeps the original URL.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Click the toolbar icon to add patterns.

## Patterns

- `reddit.com` blocks any URL containing that text.
- `*youtube.com/shorts*` uses `*` as a wildcard. Matches can be anywhere in the URL and ignore case.
- `/^https?:\/\/(www\.)?x\.com\//i` is a regular expression. Wrap it in slashes and optionally add flags after the last slash.

**Built-in:** YouTube Shorts on any subdomain is always blocked and can't be removed from the popup. Built-ins are defined in `BUILTIN_PATTERNS` in [patterns.js](patterns.js).

## How it works

- **Full page loads** are blocked before the request is sent. Each pattern is turned into a `declarativeNetRequest` rule.
- **In-app route changes and `#hash` changes** don't send a request. The extension detects them with `webNavigation` and reloads the tab at the same URL, so the rule blocks it.
- **Regex patterns Chrome's rules can't express** (for example, lookaheads) are handled with a temporary rule for that exact URL.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Extension manifest |
| `background.js` | Service worker: rules and navigation listeners |
| `patterns.js` | Pattern parsing and built-in patterns, shared by all scripts |
| `options.html`, `options.js` | Popup and options UI |

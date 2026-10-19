importScripts("patterns.js");

// Blocking always goes through declarativeNetRequest "block" rules, so Chrome shows its own
// native error page (ERR_BLOCKED_BY_CLIENT) and the address bar keeps the original URL.
//
// - Full page loads: dynamic rules (one per pattern) block the request before it is sent.
// - SPA route changes / #hash changes: no request is made, so we re-navigate the tab to the
//   same URL, which the rule then blocks.
// - Patterns RE2 can't express (e.g. lookaheads): a session rule for that exact URL is added
//   before re-navigating, so those also end on the native error page.

// Compiled patterns: { re: RegExp, dnr: boolean }. null = not loaded yet (worker just woke up).
let matchers = null;

// Per-tab session rule for JS-only matches. Rule ids for these start at SESSION_BASE.
const SESSION_BASE = 1_000_000;
const forced = new Map(); // tabId -> URL we last forced a block for (loop guard)

async function loadMatchers() {
  const { patterns = [] } = await chrome.storage.sync.get("patterns");
  const regexes = allPatterns(patterns).map(compilePattern).filter(Boolean);

  const list = [];
  const rules = [];
  for (const re of regexes) {
    const isCaseSensitive = !re.flags.includes("i");
    const { isSupported } = await chrome.declarativeNetRequest.isRegexSupported({ regex: re.source, isCaseSensitive });
    if (isSupported) {
      rules.push({
        id: rules.length + 1,
        priority: 1,
        action: { type: "block" },
        condition: { regexFilter: re.source, isUrlFilterCaseSensitive: isCaseSensitive, resourceTypes: ["main_frame"] },
      });
    }
    list.push({ re, dnr: isSupported });
  }

  const old = await chrome.declarativeNetRequest.getDynamicRules();
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: old.map((r) => r.id), addRules: rules });
  } catch (e) {
    // e.g. too many regex rules: fall back to per-URL session rules for everything.
    console.warn("DNR update failed, using per-URL rules only", e);
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: old.map((r) => r.id) });
    list.forEach((m) => (m.dnr = false));
  }

  // Patterns changed: drop per-URL session rules so unblocked URLs work again.
  const session = await chrome.declarativeNetRequest.getSessionRules();
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: session.map((r) => r.id) });
  forced.clear();

  matchers = list;
  return matchers;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.patterns) {
    loadMatchers().then(checkAllTabs);
  }
});

const stripHash = (url) => url.split("#")[0];
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Returns the first matching matcher, or undefined.
// fullLoad: the URL is being loaded via a real request, which dynamic rules already block,
// so only JS-only patterns need handling.
async function findMatch(url, fullLoad) {
  if (!url || !/^(https?|ftp|file):/i.test(url)) return;
  const list = matchers ?? (await loadMatchers());
  return list.find((m) => !(fullLoad && m.dnr) && m.re.test(url));
}

async function check(tabId, url, fullLoad = false) {
  if (tabId < 0) return;
  const m = await findMatch(url, fullLoad);
  if (!m) return;

  const target = stripHash(url);
  if (forced.get(tabId) === target && fullLoad) return; // already showing the error page for it
  forced.set(tabId, target);

  if (!m.dnr) {
    // Block this exact URL so the re-navigation below lands on Chrome's error page.
    const id = SESSION_BASE + tabId;
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [id],
      addRules: [{
        id,
        priority: 1,
        action: { type: "block" },
        condition: { regexFilter: `^${escapeRegex(target)}(#.*)?$`, resourceTypes: ["main_frame"] },
      }],
    }).catch((e) => console.warn("session rule failed", e));
  }

  chrome.tabs.update(tabId, { url }).catch(() => {});
}

async function checkAllTabs() {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) check(t.id, t.url || t.pendingUrl);
}

// Full page loads (dynamic rules handle most; these catch JS-only patterns).
chrome.webNavigation.onBeforeNavigate.addListener((d) => {
  if (d.frameId === 0) check(d.tabId, d.url, true);
});
chrome.tabs.onCreated.addListener((tab) => {
  const url = tab.pendingUrl || tab.url;
  if (url) check(tab.id, url, true);
});

// Single-page-app route changes (pushState / replaceState / back-forward within the page)
// and #hash changes. These never hit the network, so force a real load that gets blocked.
chrome.webNavigation.onHistoryStateUpdated.addListener((d) => {
  if (d.frameId === 0) check(d.tabId, d.url);
});
chrome.webNavigation.onReferenceFragmentUpdated.addListener((d) => {
  if (d.frameId === 0) check(d.tabId, d.url);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  forced.delete(tabId);
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [SESSION_BASE + tabId] }).catch(() => {});
});

// Rebuild rules and sweep already-open tabs when the extension is installed / browser starts.
chrome.runtime.onInstalled.addListener(() => loadMatchers().then(checkAllTabs));
chrome.runtime.onStartup.addListener(() => loadMatchers().then(checkAllTabs));

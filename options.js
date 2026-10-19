const $ = (id) => document.getElementById(id);
const input = $("newPattern");
const hint = $("hint");
const DEFAULT_HINT = hint.innerHTML;

let patterns = [];
let lastRemoved = null; // { pattern, index } for undo

async function load() {
  ({ patterns = [] } = await chrome.storage.sync.get("patterns"));
  render();
}

async function save() {
  await chrome.storage.sync.set({ patterns });
  render();
}

function render() {
  const list = $("list");
  list.replaceChildren();
  const testUrl = $("testUrl").value.trim();

  const row = (p, index) => {
    const builtin = index === null;
    const re = compilePattern(p);
    const li = document.createElement("li");
    li.className = [builtin && "builtin", re && testUrl && re.test(testUrl) && "hit"].filter(Boolean).join(" ");

    const pat = document.createElement("span");
    pat.className = "pat";
    pat.textContent = p;
    pat.title = p;

    const tag = document.createElement("span");
    tag.className = "tag" + (re ? "" : " bad");
    tag.textContent = !re ? "invalid" : isRegexPattern(p) ? "regex" : "wildcard";

    let end;
    if (builtin) {
      end = document.createElement("span");
      end.className = "lock";
      end.textContent = "🔒";
      end.title = "Built-in pattern, can't be removed";
    } else {
      end = document.createElement("button");
      end.textContent = "✕";
      end.title = "Remove";
      end.setAttribute("aria-label", `Remove ${p}`);
      end.addEventListener("click", () => remove(index));
    }

    li.append(pat, tag, end);
    list.append(li);
  };

  BUILTIN_PATTERNS.forEach((p) => row(p, null));
  // Skip user entries that duplicate a built-in (indices stay valid for remove()).
  patterns.forEach((p, i) => !BUILTIN_PATTERNS.includes(p) && row(p, i));

  const total = allPatterns(patterns).length;
  $("empty").hidden = total > 0;
  list.hidden = total === 0;
  $("count").textContent = `${total} pattern${total === 1 ? "" : "s"}`;
  updateTest();
  updateCurrentButton();
}

function setHint(html, cls = "") {
  hint.innerHTML = html;
  hint.className = "hint " + cls;
}

function validate() {
  const v = input.value.trim();
  if (!v) return setHint(DEFAULT_HINT), false;
  if (allPatterns(patterns).includes(v)) return setHint("That pattern is already in the list.", "err"), false;
  if (!compilePattern(v)) return setHint("Invalid regular expression.", "err"), false;
  setHint(isRegexPattern(v) ? "Regular expression ✓" : "Wildcard pattern ✓", "ok");
  return true;
}

async function add(pattern) {
  pattern = pattern.trim();
  if (!pattern || allPatterns(patterns).includes(pattern) || !compilePattern(pattern)) return;
  patterns.unshift(pattern);
  await save();
  toast(`Blocked “${pattern}”`);
}

async function remove(index) {
  lastRemoved = { pattern: patterns[index], index };
  patterns.splice(index, 1);
  await save();
  toast(`Removed “${lastRemoved.pattern}”`, "Undo", async () => {
    if (!lastRemoved || patterns.includes(lastRemoved.pattern)) return;
    patterns.splice(lastRemoved.index, 0, lastRemoved.pattern);
    lastRemoved = null;
    await save();
  });
}

$("addForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!validate()) return;
  await add(input.value);
  input.value = "";
  validate();
  input.focus();
});
input.addEventListener("input", validate);

// --- URL tester ---
function updateTest() {
  const url = $("testUrl").value.trim();
  const out = $("testResult");
  if (!url) return (out.textContent = ""), (out.className = "hint");
  const hit = allPatterns(patterns).find((p) => compilePattern(p)?.test(url));
  out.className = "hint " + (hit ? "err" : "ok");
  out.textContent = hit ? `Blocked by “${hit}”` : "Not blocked";
}
$("testUrl").addEventListener("input", render);

// --- "Block this site" for the active tab (popup only shows it for normal web pages) ---
let currentPattern = null;

async function initCurrent() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/.test(tab.url)) return;
  const host = new URL(tab.url).hostname.replace(/^www\./, "");
  currentPattern = `*${host}*`;
  $("currentHost").textContent = host;
  $("current").hidden = false;
  updateCurrentButton();
}

function updateCurrentButton() {
  if (!currentPattern) return;
  const btn = $("blockCurrent");
  const already = patterns.includes(currentPattern);
  btn.disabled = already;
  btn.textContent = already ? "Blocked" : "Block this site";
}

$("blockCurrent").addEventListener("click", () => currentPattern && add(currentPattern));

// --- toast ---
let toastTimer;
function toast(msg, actionLabel, action) {
  const el = $("toast");
  el.replaceChildren(document.createTextNode(msg));
  el.style.pointerEvents = "none";
  if (actionLabel) {
    const a = document.createElement("button");
    a.textContent = actionLabel;
    a.style.cssText = "margin-left:10px;padding:2px 8px;border:0;background:transparent;color:inherit;text-decoration:underline;font-weight:600";
    a.addEventListener("click", () => { action(); el.classList.remove("show"); });
    el.append(a);
    el.style.pointerEvents = "auto";
  }
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4000);
}

// Keep in sync if patterns change elsewhere (e.g. options page open in another tab).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.patterns) {
    patterns = changes.patterns.newValue || [];
    render();
  }
});

load();
initCurrent();
input.focus();

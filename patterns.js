// Shared by background.js and options.js so matching behaves identically everywhere.
//
// Pattern syntax:
//   /regex/i      -> regular expression
//   anything else -> wildcard (* = any characters), matched anywhere in the URL, case-insensitive

// Always enforced, shown locked in the UI, and can't be removed.
const BUILTIN_PATTERNS = [
  // YouTube Shorts on any subdomain (www., m., ...): /shorts, /shorts/<id>, /shorts?...
  String.raw`/^https?:\/\/([a-z0-9-]+\.)?youtube\.com\/shorts(\/|\?|$)/i`,
];

// Built-ins first, then the user's patterns, without duplicates.
function allPatterns(userPatterns) {
  return [...new Set([...BUILTIN_PATTERNS, ...userPatterns])];
}

function compilePattern(pattern) {
  pattern = pattern.trim();
  if (!pattern) return null;
  try {
    const m = pattern.match(/^\/(.+)\/([a-z]*)$/);
    if (m) return new RegExp(m[1], m[2]);
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(escaped, "i");
  } catch {
    return null; // invalid pattern
  }
}

function isRegexPattern(pattern) {
  return /^\/.+\/[a-z]*$/.test(pattern.trim());
}

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(extensionRoot, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

const failures = [];
const warn = [];
const forbiddenPermissions = new Set([
  "tabs",
  "cookies",
  "history",
  "webRequest",
  "webRequestBlocking",
  "downloads",
  "bookmarks",
  "management"
]);
const forbiddenCodePatterns = [
  { pattern: /\beval\s*\(/, label: "eval()" },
  { pattern: /\bnew\s+Function\s*\(/, label: "new Function()" },
  { pattern: /document\.write\s*\(/, label: "document.write()" },
  { pattern: /importScripts\s*\(\s*['"]https?:\/\//i, label: "remote importScripts()" },
  { pattern: /<script[^>]+src=["']https?:\/\//i, label: "remote script tag" },
  { pattern: /chrome\.tabs\.query\(\s*\{\s*\}/, label: "unscoped tabs query" }
];
const requiredPolicyFiles = [
  "PRIVACY.md",
  "PERMISSIONS.md",
  "STORE_SUBMISSION.md"
];
const ignoredDirs = new Set(["dist", "node_modules", "scripts"]);

function assert(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

async function fileExists(relativePath) {
  try {
    await readFile(path.join(extensionRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function listSourceFiles(dir = extensionRoot) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listSourceFiles(fullPath));
    } else if ([".js", ".html", ".mjs"].includes(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

assert(manifest.manifest_version === 3, "manifest.json must use Manifest V3.");
assert(manifest.name === "Save to IScraper", "manifest name should remain store-ready.");
assert(Boolean(manifest.short_name), "manifest should include a short_name.");
assert(Boolean(manifest.description) && manifest.description.length <= 132, "manifest description must be present and 132 characters or fewer.");
assert(Boolean(manifest.homepage_url) && manifest.homepage_url.startsWith("https://"), "manifest homepage_url must use HTTPS.");
assert(Boolean(manifest.minimum_chrome_version), "manifest should declare minimum_chrome_version.");
assert(Boolean(manifest.action?.default_popup), "extension must define an action popup.");
assert(Boolean(manifest.background?.service_worker), "extension must define an MV3 service worker.");
assert(!manifest.content_security_policy || !/https?:\/\//i.test(JSON.stringify(manifest.content_security_policy)), "content_security_policy must not allow remote code.");

const allowedPermissions = new Set(["activeTab", "scripting", "storage"]);
for (const permission of manifest.permissions ?? []) {
  assert(allowedPermissions.has(permission), `unexpected permission: ${permission}`);
  assert(!forbiddenPermissions.has(permission), `forbidden permission: ${permission}`);
}

for (const host of manifest.host_permissions ?? []) {
  assert(host !== "<all_urls>", "extension must not request <all_urls> host permission.");
  assert(host.startsWith("https://iscraper.vercel.app/"), `unexpected host permission: ${host}`);
}

const requiredFiles = [
  manifest.action.default_popup,
  manifest.background.service_worker,
  manifest.options_page,
  "content/content.js",
  "content/content.css",
  "popup/popup.js",
  "popup/popup.css",
  "options/options.js",
  "options/options.css",
  ...requiredPolicyFiles
];

for (const iconPath of Object.values(manifest.icons ?? {})) {
  requiredFiles.push(iconPath);
}

for (const iconPath of Object.values(manifest.action?.default_icon ?? {})) {
  requiredFiles.push(iconPath);
}

for (const relativePath of [...new Set(requiredFiles)]) {
  assert(await fileExists(relativePath), `missing extension file: ${relativePath}`);
}

const sourceFiles = await listSourceFiles();

for (const filePath of sourceFiles) {
  const relativeFile = path.relative(extensionRoot, filePath).replaceAll(path.sep, "/");
  const source = await readFile(filePath, "utf8");
  assert(!/sk-[A-Za-z0-9_-]{20,}/.test(source), `${relativeFile} appears to contain an API key.`);
  assert(!/SUPABASE_(SERVICE_ROLE|ANON)_KEY/.test(source), `${relativeFile} references Supabase key material.`);
  for (const { pattern, label } of forbiddenCodePatterns) {
    assert(!pattern.test(source), `${relativeFile} uses ${label}, which is not store-safe.`);
  }
  if (path.extname(filePath) === ".html" && /<script\b/i.test(source)) {
    const scriptTags = source.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
    for (const tag of scriptTags) {
      assert(/\ssrc=["'][^"']+["']/.test(tag), `${relativeFile} must not use inline script tags.`);
      assert(!/https?:\/\//i.test(tag), `${relativeFile} must not load remote scripts.`);
    }
  }
}

const privacy = await readFile(path.join(extensionRoot, "PRIVACY.md"), "utf8");
assert(/Limited Use requirements/i.test(privacy), "PRIVACY.md must include Chrome Web Store Limited Use language.");
assert(/does not sell/i.test(privacy), "PRIVACY.md must clearly state that user data is not sold.");
assert(/HTTPS/i.test(privacy), "PRIVACY.md must describe secure transmission.");

const permissions = await readFile(path.join(extensionRoot, "PERMISSIONS.md"), "utf8");
for (const permission of manifest.permissions ?? []) {
  assert(permissions.includes(`\`${permission}\``), `PERMISSIONS.md must justify ${permission}.`);
}
for (const host of manifest.host_permissions ?? []) {
  assert(permissions.includes(host), `PERMISSIONS.md must justify host permission ${host}.`);
}

const submission = await readFile(path.join(extensionRoot, "STORE_SUBMISSION.md"), "utf8");
assert(/Single purpose/i.test(submission), "STORE_SUBMISSION.md must include single-purpose wording.");
assert(/No remotely hosted JavaScript/i.test(submission), "STORE_SUBMISSION.md must include remote-code review notes.");

if (failures.length > 0) {
  console.error("Extension validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

for (const message of warn) {
  console.warn(`Warning: ${message}`);
}

console.log("Extension validation passed.");

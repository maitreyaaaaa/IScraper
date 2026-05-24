import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(extensionRoot, "dist");

const entries = [
  "manifest.json",
  "background",
  "content",
  "options",
  "popup",
  "PRIVACY.md",
  "PERMISSIONS.md",
  "STORE_SUBMISSION.md",
  "icons"
];

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

for (const entry of entries) {
  await cp(path.join(extensionRoot, entry), path.join(distDir, entry), {
    recursive: true
  });
}

console.log(`Built unpacked extension at ${distDir}`);

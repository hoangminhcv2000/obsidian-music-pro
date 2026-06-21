#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const packagePath = path.join(root, "package.json");
const manifestPath = path.join(root, "manifest.json");
const stylesPath = path.join(root, "styles.css");
const mainPath = path.join(root, "dist", "main.js");
const versionsPath = path.join(root, "versions.json");
const readmePath = path.join(root, "README.md");
const licensePath = path.join(root, "LICENSE");
const noticePath = path.join(root, "NOTICE.md");

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hasEmojiOrSymbol(value) {
  return /[\p{Extended_Pictographic}]/u.test(value);
}

async function sha256(filePath) {
  const data = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

const packageJson = await readJson(packagePath);
const manifest = await readJson(manifestPath);
const versions = await readJson(versionsPath);
const readme = await readText(readmePath);
const license = await readText(licensePath);
const notice = await readText(noticePath);
const version = String(manifest.version || "");
const id = String(manifest.id || "");
const name = String(manifest.name || "");
const description = String(manifest.description || "");

assert(/^\d+\.\d+\.\d+$/.test(version), "manifest.version must use x.y.z semver for Obsidian releases.");
assert(packageJson.version === version, "package.json version must match manifest.json version.");
assert(/^\d+\.\d+\.\d+$/.test(String(manifest.minAppVersion || "")), "manifest.minAppVersion should use x.y.z format.");
assert(versions[version] === manifest.minAppVersion, `versions.json must map ${version} to ${manifest.minAppVersion}.`);
assert(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(id), "manifest.id must use lowercase letters, numbers, and hyphens.");
assert(!id.includes("obsidian") && !id.endsWith("plugin"), "manifest.id must not contain obsidian or end with plugin.");
assert(name.length > 0 && name.length <= 60, "manifest.name must be concise.");
assert(!hasEmojiOrSymbol(name), "manifest.name should not include emoji or pictographic symbols.");
assert(!/obsidian/i.test(name), "manifest.name should not include Obsidian.");
assert(description.length > 0 && description.length <= 250, "manifest.description must be present and <= 250 characters.");
assert(description.endsWith("."), "manifest.description should end with a period.");
assert(!hasEmojiOrSymbol(description), "manifest.description should not include emoji or pictographic symbols.");
assert(manifest.isDesktopOnly === false, "manifest.isDesktopOnly must be false so the in-app Mobile mode switch can control mobile behavior.");
assert(packageJson.author === "Minh Hoang" && manifest.author === "Minh Hoang", "release-facing author metadata should be Minh Hoang.");
assert(/## Privacy and Network Use/i.test(readme) && readme.includes("SoundCloud"), "README must disclose privacy and network use.");
assert(!/MVP|--category Focus|--target=50/.test(readme), "README still contains stale MVP/catalog examples.");
assert(packageJson.license === "GPL-3.0-only", "package.json license should be GPL-3.0-only.");
assert(license.includes("GNU GENERAL PUBLIC LICENSE") && license.includes("Version 3, 29 June 2007"), "LICENSE should contain GPL-3.0 text.");
assert(readme.includes("GPL-3.0-only") && readme.includes("GNU General Public License v3.0"), "README should disclose the GPL-3.0-only license.");
assert(readme.includes("Copyright © 2026 Minh Hoang") && notice.includes("Copyright (C) 2026 Minh Hoang"), "copyright notice should name Minh Hoang.");
assert(notice.includes("GNU General Public License version 3 only"), "NOTICE should point to GPL version 3 only.");
for (const staleFile of ["src/ui/AddSoundCloudModal.ts", "src/ui/AddToFolderModal.ts"]) {
  assert(!(await exists(path.join(root, staleFile))), `Remove stale legacy UI file: ${staleFile}`);
}
for (const filePath of [mainPath, manifestPath, stylesPath, versionsPath, readmePath, licensePath, noticePath]) {
  assert(await exists(filePath), `Missing release prerequisite: ${path.relative(root, filePath)}`);
}
const mainText = await readText(mainPath);
assert(!/Minh's Vault|Library\/Mobile Documents|30-39 Projects/.test(mainText), "dist/main.js should not include local vault paths.");

const releaseDir = path.join(root, "release", version);
await fs.rm(releaseDir, { recursive: true, force: true });
await fs.mkdir(releaseDir, { recursive: true });

const assets = [
  { from: mainPath, to: "main.js" },
  { from: manifestPath, to: "manifest.json" },
  { from: stylesPath, to: "styles.css" },
  { from: versionsPath, to: "versions.json" },
  { from: licensePath, to: "LICENSE" },
  { from: noticePath, to: "NOTICE.md" }
];

for (const asset of assets) {
  await fs.copyFile(asset.from, path.join(releaseDir, asset.to));
}

const checksumLines = [];
for (const asset of assets) {
  const filePath = path.join(releaseDir, asset.to);
  checksumLines.push(`${await sha256(filePath)}  ${asset.to}`);
}
await fs.writeFile(path.join(releaseDir, "SHA256SUMS.txt"), `${checksumLines.join("\n")}\n`);

console.log(`Prepared Music Pro ${version} release assets in ${path.relative(root, releaseDir)}`);
console.log("Upload main.js, manifest.json, and styles.css to the GitHub release whose tag exactly matches manifest.version.");

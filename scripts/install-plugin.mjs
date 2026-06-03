#!/usr/bin/env node
import { mkdir, copyFile, readFile, stat } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const manifest = JSON.parse(await readFile(path.join(projectRoot, "manifest.json"), "utf8"));

async function directoryExists(dir) {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

async function findVaultRoot(startDir) {
  let dir = startDir;
  while (true) {
    if (await directoryExists(path.join(dir, ".obsidian"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const envVault = process.env.OBSIDIAN_VAULT?.trim();
const vaultRoot = envVault ? path.resolve(envVault) : await findVaultRoot(projectRoot);
if (!vaultRoot) {
  console.error("Could not find an Obsidian vault. Run with OBSIDIAN_VAULT=/path/to/vault npm run install-plugin.");
  process.exit(1);
}
if (!(await directoryExists(path.join(vaultRoot, ".obsidian")))) {
  console.error(`Not an Obsidian vault: ${vaultRoot}`);
  process.exit(1);
}

const target = path.join(vaultRoot, ".obsidian", "plugins", manifest.id);
await mkdir(target, { recursive: true });
for (const [from, to] of [
  ["dist/main.js", "main.js"],
  ["manifest.json", "manifest.json"],
  ["styles.css", "styles.css"]
]) {
  await copyFile(path.join(projectRoot, from), path.join(target, to));
}
console.log(`Installed ${manifest.name} to ${target}`);

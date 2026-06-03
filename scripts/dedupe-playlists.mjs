#!/usr/bin/env node
import { hideDuplicatePlaylists, readCatalog, validateCatalog, writeCatalog } from "./catalog-utils.mjs";

const dryRun = process.argv.includes("--dry-run");

const catalog = await readCatalog();
const { catalog: nextCatalog, duplicateGroups, changed } = hideDuplicatePlaylists(catalog);

if (duplicateGroups.length === 0) {
  console.log("No duplicate Music Pro playlists found.");
  process.exit(0);
}

for (const group of duplicateGroups) {
  console.log(`Duplicate group: ${group.key}`);
  console.log(`  keep: ${group.keep.id} — ${group.keep.title}`);
  for (const item of group.duplicates) {
    console.log(`  hide: ${item.id} — ${item.title}`);
  }
}

if (dryRun) {
  console.log(`Dry run: ${duplicateGroups.reduce((sum, group) => sum + group.duplicates.length, 0)} duplicates would be hidden.`);
  process.exit(0);
}

if (changed) {
  const normalized = await writeCatalog(nextCatalog);
  const errors = validateCatalog(normalized);
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log(`Hidden ${duplicateGroups.reduce((sum, group) => sum + group.duplicates.length, 0)} duplicate playlists.`);
}

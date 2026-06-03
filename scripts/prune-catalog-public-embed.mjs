#!/usr/bin/env node
import { readCatalog, screenSoundCloudPlaylistAvailability, validateCatalog, writeCatalog } from "./catalog-utils.mjs";

const sampleArg = process.argv.find((arg) => arg.startsWith("--sample="))?.split("=")[1] || "all";
const sampleSize = sampleArg === "all" ? "all" : Math.max(1, Math.floor(Number(sampleArg) || 12));
const concurrency = Math.max(1, Math.min(12, Math.floor(Number(process.argv.find((arg) => arg.startsWith("--concurrency="))?.split("=")[1] || 8))));
const dryRun = process.argv.includes("--dry-run");

async function mapWithConcurrency(items, mapper) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await mapper(items[index], index);
      if ((index + 1) % 25 === 0 || index === items.length - 1) {
        process.stdout.write(`Screened ${index + 1}/${items.length}\r`);
      }
    }
  });
  await Promise.all(workers);
  return out;
}

const catalog = await readCatalog();
const results = await mapWithConcurrency(catalog.items, async (item) => {
  if (item.status !== "active" || item.provider !== "soundcloud" || item.type !== "playlist") {
    return { item, keep: true, screen: { ok: true, reason: "not-active-playlist" } };
  }
  const screen = await screenSoundCloudPlaylistAvailability(item.url, {
    sampleSize,
    minTrackCount: 1,
    minSampleTracks: 1,
    maxPreviewTracks: 0,
    maxRestrictedTracks: 0,
    maxShortTracks: 0,
    rejectOnUnknown: true,
    strictPolicy: true
  });
  return { item, keep: screen.ok, screen };
});

const rejected = results.filter((entry) => !entry.keep);
const reasonCounts = rejected.reduce((counts, { screen }) => {
  counts[screen.reason] = (counts[screen.reason] || 0) + 1;
  return counts;
}, {});
const keptItems = results.filter((entry) => entry.keep).map((entry) => entry.item);

console.log(`\nPublic embed prune (${sampleSize === "all" ? "all tracks" : `${sampleSize} tracks/sample`}): keep ${keptItems.length}/${catalog.items.length}.`);
if (rejected.length) {
  console.log("Rejected by reason:", reasonCounts);
  for (const { item, screen } of rejected.slice(0, 30)) {
    console.log(`- ${item.id}: ${screen.reason} (${item.displayTitle || item.title})`);
  }
}

if (!dryRun && rejected.length > 0) {
  const normalized = await writeCatalog({ ...catalog, items: keptItems });
  const errors = validateCatalog(normalized);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log(`Catalog pruned to ${normalized.items.length} public-embed-safe items.`);
}

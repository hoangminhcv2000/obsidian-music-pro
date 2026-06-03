#!/usr/bin/env node
import { readCatalog, screenSoundCloudPlaylistAvailability } from "./catalog-utils.mjs";

const sampleArg = process.argv.find((arg) => arg.startsWith("--sample="))?.split("=")[1] || "12";
const sampleSize = sampleArg === "all" ? "all" : Math.max(1, Math.floor(Number(sampleArg) || 12));
const concurrency = Math.max(1, Math.min(12, Math.floor(Number(process.argv.find((arg) => arg.startsWith("--concurrency="))?.split("=")[1] || 5))));
const failFast = process.argv.includes("--fail-fast");

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
const activePlaylists = catalog.items.filter((item) => item.status === "active" && item.provider === "soundcloud" && item.type === "playlist");
const results = await mapWithConcurrency(activePlaylists, async (item) => {
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
  return { item, screen };
});

const failed = results.filter(({ screen }) => !screen.ok);
const reasonCounts = failed.reduce((counts, { screen }) => {
  counts[screen.reason] = (counts[screen.reason] || 0) + 1;
  return counts;
}, {});

console.log(`\nPublic embed screen (${sampleSize === "all" ? "all tracks" : `${sampleSize} tracks/sample`}): ${activePlaylists.length - failed.length}/${activePlaylists.length} passed.`);
if (failed.length > 0) {
  console.log("Failures by reason:", reasonCounts);
  for (const { item, screen } of failed.slice(0, 30)) {
    console.log(`- ${item.id}: ${screen.reason} (${item.displayTitle || item.title})`);
  }
  if (failFast) process.exit(1);
}

#!/usr/bin/env node
import {
  extractFirstUsableTrackArtworkUrl,
  extractPageArtworkUrl,
  extractSoundCloudHydration,
  isSoundCloudPlaceholderArtworkUrl,
  normalizeSoundCloudArtworkUrl,
  normalizeCatalogCategoryLabel,
  readCatalog,
  validateCatalog,
  writeCatalog
} from "./catalog-utils.mjs";

const args = process.argv.slice(2);
const refreshAll = args.includes("--all");
const concurrency = Math.max(1, Math.min(16, Number(args.find((arg) => arg.startsWith("--concurrency="))?.split("=")[1] || 8)));
const limit = Number(args.find((arg) => arg.startsWith("--limit="))?.split("=")[1] || 0);
const categoryFilter = normalizeCatalogCategoryLabel(args.find((arg) => arg.startsWith("--category="))?.split("=")[1] || "");

async function fetchPageArtworkUrl(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "MusicProCatalogBot/0.2 (+Obsidian plugin artwork refresh)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });
  if (!response.ok) throw new Error(`SoundCloud page failed ${response.status}`);
  const html = await response.text();
  return extractPageArtworkUrl(html) || await fetchFirstTrackArtworkUrlFromHtml(html);
}

async function fetchFirstTrackArtworkUrlFromHtml(html) {
  const hydration = extractSoundCloudHydration(html);
  const playlist = hydration.find((entry) => entry?.hydratable === "playlist")?.data;
  const rawTracks = Array.isArray(playlist?.tracks) ? playlist.tracks : [];
  const directArtworkUrl = extractFirstUsableTrackArtworkUrl(rawTracks);
  if (directArtworkUrl) return directArtworkUrl;

  const clientId = String(hydration.find((entry) => entry?.hydratable === "apiClient")?.data?.id || "");
  const trackIds = rawTracks
    .map((track) => track?.id)
    .filter(Boolean)
    .slice(0, 12);
  if (!clientId || trackIds.length === 0) return "";

  try {
    const endpoint = `https://api-v2.soundcloud.com/tracks?ids=${encodeURIComponent(trackIds.join(","))}&client_id=${encodeURIComponent(clientId)}`;
    const response = await fetch(endpoint, {
      headers: {
        "User-Agent": "MusicProCatalogBot/0.2 (+Obsidian plugin artwork refresh)",
        "Accept": "application/json"
      }
    });
    if (!response.ok) return "";
    const hydratedTracks = await response.json();
    return extractFirstUsableTrackArtworkUrl(hydratedTracks);
  } catch {
    return "";
  }
}

async function mapConcurrent(items, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

const catalog = await readCatalog();
let candidates = catalog.items.filter((item) => item.status === "active" && (
  refreshAll
    ? true
    : !item.artworkUrl || isSoundCloudPlaceholderArtworkUrl(item.artworkUrl)
));
if (categoryFilter) {
  candidates = candidates.filter((item) => (item.categories || []).map(normalizeCatalogCategoryLabel).includes(categoryFilter));
}
if (limit > 0) candidates = candidates.slice(0, limit);

let checked = 0;
let updated = 0;
let unchanged = 0;
let failed = 0;

await mapConcurrent(candidates, async (item) => {
  const before = normalizeSoundCloudArtworkUrl(item.artworkUrl) || "";
  try {
    const fresh = await fetchPageArtworkUrl(item.url);
    checked++;
    if (fresh && fresh !== before) {
      item.artworkUrl = fresh;
      updated++;
      console.log(`Updated artwork: ${item.displayTitle || item.title} — ${item.artist}`);
    } else {
      unchanged++;
    }
  } catch (error) {
    checked++;
    failed++;
    if (!before) delete item.artworkUrl;
    console.warn(`Artwork refresh failed: ${item.displayTitle || item.title} — ${item.artist} (${error.message})`);
  }
});

const normalized = await writeCatalog(catalog);
const errors = validateCatalog(normalized);
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Artwork audit OK${categoryFilter ? ` (${categoryFilter})` : ""}: checked ${checked}, updated ${updated}, unchanged ${unchanged}, failed ${failed}.`);

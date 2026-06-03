#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { bundledPath, cleanTitle, makeDisplayTitle, normalizeCatalog, normalizeSoundCloudUrl, readCatalog, screenSoundCloudPlaylistAvailability, slugify, validateCatalog, writeCatalog } from "./catalog-utils.mjs";
import { compareCatalogItemsForCategory, getPlaylistSortProfile, inferPlaylistCategories, normalizePlaylistText } from "./playlist-category-rules.mjs";

const target = Number(process.argv.find((arg) => arg.startsWith("--target="))?.split("=")[1] || 1000);
const skipAvailabilityScreen = process.argv.includes("--skip-availability-screen");
const AVAILABILITY_SCREEN_SAMPLE_SIZE = 12;
const CATEGORY_TARGETS = new Map(Object.entries({
  "Ambience": 105,
  "Jazz & Blues": 110,
  "Orchestra": 105,
  "Piano": 90,
  "Movies/Games": 120,
  "Handpan & Kalimba": 45,
  "House": 80,
  "Acoustic": 55,
  "Fantasy Folk": 75,
  "Bossa": 90,
  "Asia": 65,
  "Middle East": 60
}));
const CATEGORIES = [...CATEGORY_TARGETS.keys()];
const CLASSIFIER_TAG_SLUGS = new Set([
  ...CATEGORIES.map(slugify),
  "ambience", "jazz-blues", "movies-games", "handpan-kalimba", "fantasy-folk", "middle-east",
  "bossa-nova", "rock-metal", "other", "editors-choice", "recent", "community", "duplicate-hidden"
]);
const GENERIC_DISPLAY_KEYS = new Set([
  "", "unknown", "playlist", "music", "track", "tracks", "song", "songs", "set", "mix", "album",
  "soundtrack", "movie", "classical", "piano", "guitar", "handpan", "kalimba", "jazz", "house",
  "bossa", "folk", "medieval", "viking", "ambient", "ambience", "my", "private", "com"
]);
const LOW_VALUE_ARTIST_PATTERN = /^(?:unknown|unknown artist|unknown curator|soundcloud|user(?:\s+\d+)?|\d{1,4}|[a-z])$/i;

function stripClassifierTags(tags = []) {
  return tags.filter((tag) => !CLASSIFIER_TAG_SLUGS.has(slugify(tag)));
}

async function readBundledCatalogCandidatePool() {
  try {
    const text = await readFile(bundledPath, "utf8");
    const match = text.match(/export const BUNDLED_CATALOG[^=]*=\s*([\s\S]*);\s*$/);
    if (!match?.[1]) return { version: 1, updatedAt: new Date().toISOString().slice(0, 10), items: [] };
    return normalizeCatalog(JSON.parse(match[1]));
  } catch {
    return { version: 1, updatedAt: new Date().toISOString().slice(0, 10), items: [] };
  }
}

function similarTitleKey(value = "") {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(?:official|full|complete|the|playlist|playlists|set|sets|music|songs?|tracks?|mix|radio|essentials?|soundtracks?|ost|score|theme|themes)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function exactTitleArtistKey(item) {
  return `${similarTitleKey(item.artist)}::${similarTitleKey(item.title)}`;
}

function primaryDisplayKey(item) {
  return normalizePlaylistText(item.displayTitle || item.title || "");
}

function candidateFromItem(sourceItem) {
  if (!sourceItem || sourceItem.provider !== "soundcloud" || sourceItem.status === "broken" || sourceItem.type !== "playlist") return null;
  const sourceTags = stripClassifierTags(Array.isArray(sourceItem.tags) ? sourceItem.tags : []);
  const categories = inferPlaylistCategories(
    { ...sourceItem, tags: sourceTags },
    { preserveExplicit: false, preserveEditorsChoice: false }
  ).filter((category) => CATEGORIES.includes(category));
  if (categories.length === 0) return null;
  const title = cleanTitle(sourceItem.title || "Untitled", sourceItem.artist || "");
  const artist = String(sourceItem.artist || "SoundCloud").trim();
  const artistKey = normalizePlaylistText(artist).replace(/\s+\d{1,4}$/, "");
  const tags = [...new Set([...sourceTags, ...categories.map((category) => slugify(category))])]
    .filter((tag) => !["editors-choice", "recent", "community", "duplicate-hidden"].includes(slugify(tag)));
  const displayTitle = makeDisplayTitle(title, artist, categories, tags);
  const item = {
    ...sourceItem,
    type: "playlist",
    title,
    displayTitle,
    artist,
    categories,
    tags,
    source: "curated",
    status: "active"
  };
  delete item.category;
  delete item.mood;
  const bestScore = Math.max(...categories.map((category) => getPlaylistSortProfile(item, category).totalScore)) - getAvailabilityRiskPenalty(title, artist, item.url);
  const displayKey = primaryDisplayKey(item);
  if (displayKey.length <= 2 && displayKey !== "f1") return null;
  if (LOW_VALUE_ARTIST_PATTERN.test(artistKey) && bestScore < 20) return null;
  if (GENERIC_DISPLAY_KEYS.has(displayKey) && bestScore < 20) return null;
  return { item, categories, score: bestScore, urlKey: normalizeSoundCloudUrl(item.url).toLowerCase() };
}

function getAvailabilityRiskPenalty(title = "", artist = "", url = "") {
  const text = normalizePlaylistText([title, artist, url].join(" "));
  let penalty = 0;
  if (/\b(?:official|album|release|releases|major|label|chart|charts|hits|top|essentials|radio)\b/.test(text)) penalty += 8;
  if (/\b(?:go plus|go\+|preview|30 sec|30 seconds|snippet|snip)\b/.test(text)) penalty += 40;
  if (/\b(?:lofi girl|soundcloud playlists|sc playlists)\b/.test(text)) penalty += 6;
  return penalty;
}

async function applyAvailabilityScreen(candidate) {
  if (skipAvailabilityScreen) return candidate;
  const screen = await screenSoundCloudPlaylistAvailability(candidate.item.url, {
    sampleSize: AVAILABILITY_SCREEN_SAMPLE_SIZE,
    minTrackCount: 1,
    minSampleTracks: 1,
    maxPreviewTracks: 0,
    maxRestrictedTracks: 0,
    maxShortTracks: 0,
    rejectOnUnknown: true,
    strictPolicy: true
  });
  if (!screen.ok) return null;
  candidate.item.soundcloudTrackCount = screen.trackCount;
  candidate.score += screen.qualityBonus;
  return candidate;
}

function sortForCategory(category, a, b) {
  return compareCatalogItemsForCategory(a.item, b.item, category) || b.score - a.score || primaryDisplayKey(a.item).localeCompare(primaryDisplayKey(b.item));
}

function canSelect(candidate, selected, seenUrls, seenExact, titleCounts, category) {
  if (seenUrls.has(candidate.urlKey)) return false;
  const exact = exactTitleArtistKey(candidate.item);
  if (seenExact.has(exact)) return false;
  const titleKey = `${category}::${similarTitleKey(candidate.item.title || candidate.item.displayTitle || "")}`;
  if ((titleCounts.get(titleKey) || 0) >= 2) return false;
  return true;
}

function selectCandidate(candidate, selected, seenUrls, seenExact, titleCounts, category) {
  const item = { ...candidate.item };
  item.categories = [category, ...item.categories.filter((value) => value !== category)];
  selected.push(item);
  seenUrls.add(candidate.urlKey);
  seenExact.add(exactTitleArtistKey(item));
  const titleKey = `${category}::${similarTitleKey(item.title || item.displayTitle || "")}`;
  titleCounts.set(titleKey, (titleCounts.get(titleKey) || 0) + 1);
}

const current = await readCatalog();
const bundled = await readBundledCatalogCandidatePool();
const byUrl = new Map();
for (const source of [...current.items, ...bundled.items]) {
  const candidate = candidateFromItem(source);
  if (!candidate) continue;
  const existing = byUrl.get(candidate.urlKey);
  if (!existing || candidate.score > existing.score) byUrl.set(candidate.urlKey, candidate);
}

const candidates = [];
for (const candidate of byUrl.values()) {
  const screened = await applyAvailabilityScreen(candidate);
  if (screened) candidates.push(screened);
}
const byCategory = new Map(CATEGORIES.map((category) => [category, []]));
for (const candidate of candidates) {
  for (const category of candidate.categories) byCategory.get(category)?.push(candidate);
}
for (const category of CATEGORIES) byCategory.get(category).sort((a, b) => sortForCategory(category, a, b));

const selected = [];
const seenUrls = new Set();
const seenExact = new Set();
const titleCounts = new Map();

for (const category of CATEGORIES) {
  const wanted = Math.min(CATEGORY_TARGETS.get(category) || 0, Math.max(0, target - selected.length));
  let picked = 0;
  for (const candidate of byCategory.get(category) || []) {
    if (picked >= wanted || selected.length >= target) break;
    if (!canSelect(candidate, selected, seenUrls, seenExact, titleCounts, category)) continue;
    selectCandidate(candidate, selected, seenUrls, seenExact, titleCounts, category);
    picked++;
  }
}

if (selected.length < target) {
  const remaining = candidates
    .slice()
    .sort((a, b) => b.score - a.score || primaryDisplayKey(a.item).localeCompare(primaryDisplayKey(b.item)));
  for (const candidate of remaining) {
    if (selected.length >= target) break;
    const category = candidate.categories.find((value) => CATEGORIES.includes(value)) || candidate.categories[0];
    if (!canSelect(candidate, selected, seenUrls, seenExact, titleCounts, category)) continue;
    selectCandidate(candidate, selected, seenUrls, seenExact, titleCounts, category);
  }
}

if (selected.length < target) {
  console.warn(`Warning: only selected ${selected.length}/${target} after screening.`);
}

const normalized = await writeCatalog({ version: 1, updatedAt: new Date().toISOString().slice(0, 10), items: selected.slice(0, target) });
const errors = validateCatalog(normalized);
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Fresh catalog rebalanced: ${normalized.items.length} items from ${candidates.length} screened candidates.`);
for (const category of CATEGORIES) {
  const count = normalized.items.filter((item) => item.status === "active" && item.categories.includes(category)).length;
  console.log(`${category}: ${count}`);
}

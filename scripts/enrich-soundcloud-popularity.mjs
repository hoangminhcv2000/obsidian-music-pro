#!/usr/bin/env node
import { readCatalog, writeCatalog, validateCatalog } from "./catalog-utils.mjs";

const DEFAULT_DELAY_MS = 900;
const STALE_DAYS = 30;

function parseArgs(argv) {
  const options = {
    limit: Number.POSITIVE_INFINITY,
    delayMs: DEFAULT_DELAY_MS,
    force: false,
    dryRun: false,
    category: "",
    id: "",
    staleDays: STALE_DAYS
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--limit") options.limit = Math.max(1, Number(argv[++i] || options.limit));
    else if (arg === "--delay-ms") options.delayMs = Math.max(0, Number(argv[++i] || options.delayMs));
    else if (arg === "--stale-days") options.staleDays = Math.max(1, Number(argv[++i] || options.staleDays));
    else if (arg === "--category") options.category = String(argv[++i] || "");
    else if (arg === "--id") options.id = String(argv[++i] || "");
    else if (arg === "--force") options.force = true;
    else if (arg === "--dry-run") options.dryRun = true;
  }
  return options;
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isStale(item, staleDays) {
  if (!item.popularityUpdatedAt) return true;
  const last = new Date(item.popularityUpdatedAt).getTime();
  if (!Number.isFinite(last)) return true;
  return Date.now() - last > staleDays * 24 * 60 * 60 * 1000;
}

function extractSoundCloudHydration(html) {
  // SoundCloud embeds catalog metadata in the page as window.__sc_hydration.
  const match = String(html || "").match(/window\.__sc_hydration\s*=\s*([\s\S]*?);<\/script>/);
  if (!match?.[1]) return [];
  try {
    const data = JSON.parse(match[1]);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function chunk(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function metric(raw, ...keys) {
  for (const key of keys) {
    const value = Number(raw?.[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function sumMetric(items, ...keys) {
  return items.reduce((sum, item) => sum + metric(item, ...keys), 0);
}

function maxMetric(items, ...keys) {
  return items.reduce((max, item) => Math.max(max, metric(item, ...keys)), 0);
}

function hasUsefulTrackMetrics(track) {
  return metric(track, "playback_count", "likes_count", "reposts_count", "comment_count") > 0;
}

function collectFollowers(playlist, tracks) {
  const values = [
    metric(playlist?.user, "followers_count", "followersCount"),
    ...tracks.map((track) => metric(track?.user, "followers_count", "followersCount"))
  ].filter((value) => value > 0);
  return values.length ? Math.max(...values) : 0;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "MusicProCatalogBot/1.0 (+Obsidian Music Pro)"
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "MusicProCatalogBot/1.0 (+Obsidian Music Pro)"
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

async function hydrateTracks(tracks, clientId) {
  if (!clientId) return tracks;
  const byId = new Map();
  const shallowIds = [];
  for (const track of tracks) {
    const id = String(track?.id || "");
    if (!id) continue;
    if (hasUsefulTrackMetrics(track)) byId.set(id, track);
    else shallowIds.push(id);
  }

  for (const ids of chunk(shallowIds, 50)) {
    if (ids.length === 0) continue;
    const endpoint = `https://api-v2.soundcloud.com/tracks?ids=${encodeURIComponent(ids.join(","))}&client_id=${encodeURIComponent(clientId)}`;
    try {
      const data = await fetchJson(endpoint);
      const fullTracks = Array.isArray(data) ? data : [];
      for (const track of fullTracks) {
        const id = String(track?.id || "");
        if (id) byId.set(id, track);
      }
    } catch {
      // Keep shallow SoundCloud rows. Hydration can be rate-limited independently of page fetch.
    }
  }

  return tracks.map((track) => {
    const id = String(track?.id || "");
    return (id && byId.get(id)) || track;
  });
}

async function enrichItem(item) {
  const html = await fetchText(item.url);
  const hydration = extractSoundCloudHydration(html);
  const playlist = hydration.find((entry) => entry?.hydratable === "playlist")?.data
    || hydration.find((entry) => Array.isArray(entry?.data?.tracks))?.data
    || null;
  const pageTrack = hydration.find((entry) => entry?.hydratable === "sound")?.data || null;
  const clientId = String(hydration.find((entry) => entry?.hydratable === "apiClient")?.data?.id || "");
  const rawTracks = Array.isArray(playlist?.tracks)
    ? playlist.tracks
    : pageTrack
      ? [pageTrack]
      : [];
  const tracks = await hydrateTracks(rawTracks, clientId);
  const trackCount = Math.max(Number(playlist?.track_count || 0), tracks.length);
  const playbackCount = Math.max(metric(playlist, "playback_count", "playbackCount"), sumMetric(tracks, "playback_count", "playbackCount"));
  const likesCount = Math.max(metric(playlist, "likes_count", "likesCount"), sumMetric(tracks, "likes_count", "likesCount"));
  const repostsCount = Math.max(metric(playlist, "reposts_count", "repostsCount"), sumMetric(tracks, "reposts_count", "repostsCount"));
  const commentCount = Math.max(metric(playlist, "comment_count", "commentCount"), sumMetric(tracks, "comment_count", "commentCount"));
  const followersCount = collectFollowers(playlist, tracks);
  const maxTrackPlayback = maxMetric(tracks, "playback_count", "playbackCount");
  const hasMetrics = playbackCount > 0 || likesCount > 0 || repostsCount > 0 || commentCount > 0 || followersCount > 0;
  const confidence = hasMetrics && trackCount > 0
    ? "high"
    : trackCount > 0
      ? "medium"
      : hydration.length > 0
        ? "low"
        : "none";

  return {
    playback_count: Math.floor(playbackCount),
    likes_count: Math.floor(likesCount),
    reposts_count: Math.floor(repostsCount),
    comment_count: Math.floor(commentCount),
    followers_count: Math.floor(followersCount),
    popularity: Math.floor(maxTrackPlayback),
    soundcloudTrackCount: Math.floor(trackCount),
    popularityConfidence: confidence,
    popularityUpdatedAt: todayIso()
  };
}

function mergeMetrics(item, metrics) {
  const next = { ...item };
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value === "number") {
      if (Number.isFinite(value) && value > 0) next[key] = value;
      else delete next[key];
    } else if (value) {
      next[key] = value;
    }
  }
  return next;
}

const options = parseArgs(process.argv.slice(2));
const catalog = await readCatalog();
const candidates = catalog.items
  .map((item, index) => ({ item, index }))
  .filter(({ item }) => item.provider === "soundcloud" && item.status === "active")
  .filter(({ item }) => !options.category || item.categories.includes(options.category))
  .filter(({ item }) => !options.id || item.id === options.id)
  .filter(({ item }) => options.force || isStale(item, options.staleDays))
  .slice(0, options.limit);

console.log(`Music Pro popularity enrichment: ${candidates.length}/${catalog.items.length} items selected${options.dryRun ? " (dry run)" : ""}.`);

let updated = 0;
let failed = 0;
for (const [runIndex, entry] of candidates.entries()) {
  const { item, index } = entry;
  try {
    const metrics = await enrichItem(item);
    catalog.items[index] = mergeMetrics(item, metrics);
    updated++;
    console.log(`✓ ${runIndex + 1}/${candidates.length} ${item.displayTitle || item.title}: plays=${metrics.playback_count || 0}, likes=${metrics.likes_count || 0}, tracks=${metrics.soundcloudTrackCount || 0}, confidence=${metrics.popularityConfidence}`);
  } catch (error) {
    failed++;
    console.warn(`⚠ ${runIndex + 1}/${candidates.length} ${item.displayTitle || item.title}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (runIndex < candidates.length - 1) await sleep(options.delayMs);
}

if (!options.dryRun && updated > 0) {
  const normalized = await writeCatalog(catalog);
  const errors = validateCatalog(normalized);
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
}

console.log(`Popularity enrichment complete: ${updated} updated, ${failed} failed.`);

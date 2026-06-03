import fs from "node:fs/promises";
import path from "node:path";
import { compareCatalogItemsForCategory, getPlaylistCategoryRank, inferPlaylistCategories, normalizePlaylistText } from "./playlist-category-rules.mjs";

export const catalogPath = path.join(process.cwd(), "catalog", "catalog.json");
export const bundledPath = path.join(process.cwd(), "src", "catalog", "bundledCatalog.ts");

export function today() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function normalizeSoundCloudUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Empty SoundCloud URL");
  const prefixed = raw.startsWith("http") ? raw : `https://${raw}`;
  const url = new URL(prefixed);
  if (!["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com", "on.soundcloud.com"].includes(url.hostname)) {
    throw new Error(`Not a SoundCloud URL: ${input}`);
  }
  if (url.hostname !== "on.soundcloud.com") url.hostname = "soundcloud.com";
  url.protocol = "https:";
  url.hash = "";
  const keep = new URLSearchParams();
  // Keep no tracking params by default.
  url.search = keep.toString();
  return url.toString().replace(/\/$/, "");
}

export function isSoundCloudPlaceholderArtworkUrl(input) {
  const url = String(input || "").trim();
  return !url || /soundcloud\.com\/images\/fb_placeholder\.png/i.test(url);
}

export function normalizeSoundCloudArtworkUrl(input) {
  const raw = String(input || "").trim();
  if (isSoundCloudPlaceholderArtworkUrl(raw)) return "";
  const httpsUrl = raw.replace(/^http:\/\//i, "https://");
  if (!/sndcdn\.com/i.test(httpsUrl)) return httpsUrl;
  return httpsUrl.replace(
    /-(?:t\d+x\d+|large|small|tiny|mini|badge|crop|original)\.(jpe?g|png|webp)(\?.*)?$/i,
    "-t500x500.$1$2"
  );
}

export function htmlDecode(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function extractMetaContent(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const propertyPattern = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
  const contentFirstPattern = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i");
  return propertyPattern.exec(html)?.[1] || contentFirstPattern.exec(html)?.[1] || "";
}

export function extractPageArtworkUrl(html) {
  return normalizeSoundCloudArtworkUrl(htmlDecode(
    extractMetaContent(html, "og:image")
      || extractMetaContent(html, "twitter:image")
      || ""
  ));
}

function readNestedArtworkCandidate(source, path) {
  let current = source;
  for (const part of path) {
    if (current == null) return "";
    current = current[part];
  }
  return typeof current === "string" ? current : "";
}

export function extractFirstUsableTrackArtworkUrl(rawTracks = []) {
  const tracks = Array.isArray(rawTracks) ? rawTracks : [];
  for (const track of tracks) {
    if (!track || typeof track !== "object") continue;
    const candidates = [
      track.artwork_url,
      track.artworkUrl,
      readNestedArtworkCandidate(track, ["artwork", "url"]),
      readNestedArtworkCandidate(track, ["artwork", "uri"]),
      readNestedArtworkCandidate(track, ["visuals", "visuals", 0, "visual_url"]),
      readNestedArtworkCandidate(track, ["visuals", "visuals", 0, "url"])
    ];
    for (const candidate of candidates) {
      const artworkUrl = normalizeSoundCloudArtworkUrl(candidate);
      if (artworkUrl) return artworkUrl;
    }
  }
  return "";
}

export function extractFirstTrackArtworkUrlFromSoundCloudHtml(html = "") {
  const hydration = extractSoundCloudHydration(html);
  const playlist = hydration.find((entry) => entry?.hydratable === "playlist")?.data;
  return extractFirstUsableTrackArtworkUrl(Array.isArray(playlist?.tracks) ? playlist.tracks : []);
}

export function extractBestSoundCloudArtworkUrl(html = "") {
  return extractPageArtworkUrl(html) || extractFirstTrackArtworkUrlFromSoundCloudHtml(html);
}

export function isSoundCloudDiscoverSetUrl(input) {
  try {
    const normalized = normalizeSoundCloudUrl(input);
    const parts = new URL(normalized).pathname.split("/").filter(Boolean);
    return parts[0] === "discover" && parts[1] === "sets";
  } catch {
    return false;
  }
}

export function assertEmbeddableSoundCloudUrl(input) {
  const normalized = normalizeSoundCloudUrl(input);
  if (isSoundCloudDiscoverSetUrl(normalized)) {
    throw new Error("SoundCloud personalized Discover playlists cannot be embedded. Copy the public track or /sets/ playlist URL instead.");
  }
  return normalized;
}

export function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "item";
}

export function inferTypeFromUrl(url) {
  const u = new URL(url);
  const parts = u.pathname.split("/").filter(Boolean);
  if (url.includes("on.soundcloud.com")) return "unknown";
  if (parts.includes("sets")) return "playlist";
  if (parts.includes("albums")) return "album";
  if (parts.length <= 1) return "profile";
  return "track";
}

export function cleanTitle(title, artist) {
  let out = String(title || "Untitled").trim();
  const by = ` by ${artist}`;
  if (artist && out.toLowerCase().endsWith(by.toLowerCase())) {
    out = out.slice(0, -by.length).trim();
  }
  return out || String(title || "Untitled").trim();
}

const DISPLAY_TITLE_MAX_WORDS = 4;
const DISPLAY_TITLE_STOP_WORDS = new Set([
  "a", "an", "and", "are", "at", "by", "for", "from", "in", "is", "of", "on", "or", "the", "to", "with",
  "best", "collection", "compilation", "complete", "copyright", "download", "free", "full", "hour", "hours", "hr", "hrs",
  "instrumental", "long", "mix", "mixes", "music", "new", "official", "playlist", "playlists", "royalty",
  "set", "song", "songs", "track", "tracks", "version", "soundtrack", "soundtracks", "ost", "score", "scores", "theme", "themes", "jazz", "blues", "soul", "movie", "movies", "film", "game", "games", "handpan", "pantam", "kalimba", "bossa", "classical", "piano", "guitar", "folk", "medieval", "viking", "ambient", "ambience", "house", "private", "my", "com"
]);
const GENERIC_COMPACT_TITLE_KEYS = new Set([
  "", "untitled", "unknown", "soundcloud", "soundcloud link", "link", "playlist", "playlists", "music",
  "track", "tracks", "song", "songs", "set", "album", "profile", "mix", "complete", "soundtrack", "ost", "score", "theme", "jazz", "blues", "soul", "movie", "movies", "film", "game", "games", "handpan", "pantam", "kalimba", "bossa", "classical", "piano", "guitar", "folk", "medieval", "viking", "ambient", "ambience", "house", "private", "my", "com", "new playlist", "my playlist"
]);
const GENERIC_ARTIST_KEYS = new Set([
  "", "soundcloud", "unknown", "unknown artist", "unknown curator", "untitled", "user", "profile"
]);
const DISPLAY_TITLE_FREQUENCY_STOP_WORDS = new Set([
  "frequency", "frequencies", "healing", "low", "meditation", "miracle", "solfeggio", "tone"
]);
const DISPLAY_TITLE_ACRONYMS = new Set([
  "adhd", "asmr", "bb", "bgm", "dj", "dnd", "dna", "edm", "jrpg", "lofi", "ost", "rpg", "tv", "uj", "vgm"
]);
const INSTRUMENT_FALLBACKS = [
  { label: "Piano", keywords: ["piano", "keys", "keyboard"] },
  { label: "Acoustic Guitar", keywords: ["acoustic", "acoustic guitar", "guitar", "fingerstyle", "fingerpicking", "classical guitar", "nylon guitar"] },
  { label: "Handpan", keywords: ["handpan", "hang drum", "pantam", "steel tongue drum"] },
  { label: "Kalimba", keywords: ["kalimba", "mbira", "thumb piano"] },
  { label: "Violin", keywords: ["violin", "viola", "strings"] },
  { label: "Cello", keywords: ["cello"] },
  { label: "Saxophone", keywords: ["sax", "saxophone"] },
  { label: "Trumpet", keywords: ["trumpet"] },
  { label: "Flute", keywords: ["flute", "shakuhachi", "dizi", "bansuri"] },
  { label: "Oud", keywords: ["oud", "saz", "ney", "qanun"] },
  { label: "Orchestra", keywords: ["orchestra", "orchestral", "symphony", "strings", "choir", "classical"] }
];
const MOOD_FALLBACKS = [
  { label: "Ambience", keywords: ["ambience", "ambient", "soundscape", "rain", "forest", "ocean", "waves", "white noise", "brown noise", "pink noise", "frequency", "binaural", "solfeggio"] },
  { label: "Jazz & Blues", keywords: ["jazz", "blues", "soul", "swing", "lounge", "cafe"] },
  { label: "House", keywords: ["house", "deep house", "disco", "funky", "groove"] },
  { label: "Lo-Fi", keywords: ["lofi", "lo-fi", "chillhop", "study", "focus"] },
  { label: "Fantasy Folk", keywords: ["fantasy", "folk", "medieval", "tavern", "celtic", "nordic"] },
  { label: "Movies/Games", keywords: ["movie", "film", "game", "anime", "ost", "soundtrack", "score"] },
  { label: "Bossa", keywords: ["bossa", "latin", "samba", "tango", "salsa"] },
  { label: "Asia", keywords: ["asia", "asian", "traditional chinese", "traditional japanese", "guzheng", "koto", "sitar"] },
  { label: "Middle East", keywords: ["middle east", "arabic", "persian", "turkish", "maqam", "sufi"] }
];

export function normalizeDisplayTitle(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\p{Extended_Pictographic}]/gu, " ")
    .replace(/[#*_`~]+/g, " ")
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\bbossa[-\s]+nova\b/gi, "Bossa")
    .replace(/\bbossanova\b/gi, "Bossa")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-–—:;,.!?\s"'()]+|[-–—:;,.!?\s"'()]+$/g, "");
}

export function makeDisplayTitle(title, artist = "", categories = [], tags = []) {
  const original = normalizeDisplayTitle(cleanTitle(title || "Untitled", artist));
  const quoted = original.match(/["']([^"']{3,72})["']/)?.[1];
  const cleaned = cleanupDisplayTitleSource(original, artist);
  const candidates = [
    quoted || "",
    ...cleaned.split(/\s+(?:[-–—|•:;]|\/)\s+/g),
    cleaned
  ]
    .map((candidate) => cleanupDisplayTitleSource(candidate, artist))
    .filter(Boolean);

  const context = [...categories, ...tags].join(" ").toLowerCase();
  let best = "";
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const shortened = shortenDisplayTitleCandidate(candidate, artist);
    if (!shortened) continue;
    const words = displayTitleWords(shortened).length;
    const lower = shortened.toLowerCase();
    let score = 12 - Math.abs(Math.min(words, DISPLAY_TITLE_MAX_WORDS) - 2);
    if (words <= DISPLAY_TITLE_MAX_WORDS) score += 3;
    if (/\d+\s*hz/i.test(shortened)) score += 3;
    if (context && displayTitleWords(shortened).some((word) => context.includes(word.toLowerCase()))) score += 2;
    if (/\b(playlist|music|tracks?|songs?|mix)\b/i.test(lower)) score -= 5;
    if (candidate === quoted) score += 4;
    if (score > bestScore) {
      best = shortened;
      bestScore = score;
    }
  }

  const compactTitle = best || shortenDisplayTitleCandidate(cleaned || original, artist);
  if (isMeaningfulCompactTitle(compactTitle)) return compactTitle;

  const compactArtist = makeCompactArtistTitle(artist);
  if (compactArtist) return compactArtist;

  return makeCompactContextFallback(categories, tags, original, "instrument")
    || makeCompactContextFallback(categories, tags, original, "mood")
    || "Untitled";
}

function cleanupDisplayTitleSource(value, artist) {
  let out = normalizeDisplayTitle(value)
    .replace(/\b(\d{3,4})\s*(?:hz|hertz)\b/gi, "$1 Hz")
    .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, " ")
    .replace(/\b\d+\s*(?:hours?|hrs?|minutes?|mins?)\b/gi, " ")
    .replace(/\b(?:no copyright|copyright free|royalty free|free download|full album|full playlist|the best|best of)\b/gi, " ")
    .replace(/\b(?:beats?|music|songs?|tracks?)\s+(?:to|for)\s+(?:relax|sleep|study|work|focus)[\w\s/&+-]*/gi, " ")
    .replace(/\b(?:to|for)\s+(?:relax|sleep|study|work|focus)(?:\s*[/&+-]\s*(?:relax|sleep|study|work|focus))*\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (artist) {
    const artistPattern = new RegExp(`\\b${escapeRegExp(artist)}\\b`, "gi");
    out = out.replace(artistPattern, " ").replace(/\s+/g, " ").trim();
  }
  return normalizeDisplayTitle(out);
}

function shortenDisplayTitleCandidate(candidate, artist) {
  const frequency = candidate.match(/\b(\d{3,4})\s*(?:hz|hertz)\b/i);
  if (frequency) {
    const afterHz = candidate.slice((frequency.index || 0) + frequency[0].length);
    const rest = displayTitleWords(afterHz)
      .filter((word) => !DISPLAY_TITLE_FREQUENCY_STOP_WORDS.has(normalizeWordKey(word)))
      .filter((word) => !DISPLAY_TITLE_STOP_WORDS.has(normalizeWordKey(word)))
      .map(formatDisplayWord);
    const words = [frequency[1], "Hz", ...uniqueWords(rest)].slice(0, DISPLAY_TITLE_MAX_WORDS);
    if (words.length > 2) return words.join(" ");
  }

  const artistKeys = new Set(displayTitleWords(artist).map(normalizeWordKey));
  const words = [];
  for (const rawWord of displayTitleWords(candidate)) {
    const key = normalizeWordKey(rawWord);
    if (!key || DISPLAY_TITLE_STOP_WORDS.has(key)) continue;
    if (artistKeys.has(key) && words.length > 0) continue;
    for (const word of expandDisplayWord(rawWord)) {
      if (!words.some((existing) => normalizeWordKey(existing) === normalizeWordKey(word))) words.push(word);
      if (words.length >= DISPLAY_TITLE_MAX_WORDS) break;
    }
    if (words.length >= DISPLAY_TITLE_MAX_WORDS) break;
  }

  if (words.length > 0) return words.join(" ");
  return "";
}

function isMeaningfulCompactTitle(value) {
  const clean = normalizeDisplayTitle(value || "");
  if (!clean) return false;
  const key = normalizePhraseKey(clean);
  if (GENERIC_COMPACT_TITLE_KEYS.has(key)) return false;
  if (!/\p{L}/u.test(clean)) return false;
  return displayTitleWords(clean).some((word) => !DISPLAY_TITLE_STOP_WORDS.has(normalizeWordKey(word)));
}

function makeCompactArtistTitle(artist) {
  const clean = stripNoisyArtistSuffix(normalizeDisplayTitle(artist || ""));
  if (!clean) return "";
  const key = normalizePhraseKey(clean);
  if (GENERIC_ARTIST_KEYS.has(key) || /^user\s+\d+$/.test(key)) return "";
  const words = uniqueWords(displayTitleWords(clean).map(formatDisplayWord).filter(Boolean));
  return words.slice(0, DISPLAY_TITLE_MAX_WORDS).join(" ");
}

function stripNoisyArtistSuffix(value) {
  const words = displayTitleWords(value);
  const last = words[words.length - 1] || "";
  if (words.length >= 3 && /^\d{1,4}$/.test(last)) {
    const withoutSuffix = words.slice(0, -1);
    const letterWords = withoutSuffix.filter((word) => /\p{L}/u.test(word));
    if (letterWords.length >= 2) return withoutSuffix.join(" ");
  }
  return value;
}

function makeCompactContextFallback(categories, tags, title, kind) {
  const haystack = normalizeDisplayTitle([title, ...categories, ...tags].join(" "));
  const normalizedHaystack = normalizePhraseKey(haystack);
  const fallbacks = kind === "instrument" ? INSTRUMENT_FALLBACKS : MOOD_FALLBACKS;
  for (const fallback of fallbacks) {
    if (fallback.keywords.some((keyword) => phraseIncludes(normalizedHaystack, normalizePhraseKey(keyword)))) return fallback.label;
  }

  if (kind === "mood") {
    const category = categories
      .map(normalizeDisplayTitle)
      .find((category) => category && !["User", "Editor's Choice", "Recent"].includes(category));
    if (category) return shortenNameCandidate(category);
  }
  return "";
}

function shortenNameCandidate(value) {
  return uniqueWords(displayTitleWords(value).map(formatDisplayWord).filter(Boolean)).slice(0, DISPLAY_TITLE_MAX_WORDS).join(" ");
}

function phraseIncludes(haystackKey, needleKey) {
  if (!needleKey) return false;
  return ` ${haystackKey} `.includes(` ${needleKey} `);
}

function displayTitleWords(value) {
  return String(value || "").match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)?/gu) || [];
}

function expandDisplayWord(word) {
  const key = normalizeWordKey(word);
  if (key === "lofi" || key === "lo-fi") return ["Lo-Fi"];
  if (key === "hiphop" || key === "hip-hop") return ["Hip-Hop"];
  if (key === "chillhop") return ["Chillhop"];
  if (key === "bossanova") return ["Bossa"];
  if (key === "sleeping") return ["Sleep"];
  return [formatDisplayWord(word)];
}

function formatDisplayWord(word) {
  const key = normalizeWordKey(word);
  if (!key) return "";
  if (key === "hz") return "Hz";
  if (DISPLAY_TITLE_ACRONYMS.has(key)) return key === "lofi" ? "Lo-Fi" : key.toUpperCase();
  if (/^\d+$/.test(word)) return word;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function normalizeWordKey(word) {
  return String(word || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizePhraseKey(value) {
  return displayTitleWords(value).map(normalizeWordKey).filter(Boolean).join(" ");
}

function uniqueWords(words) {
  const seen = new Set();
  const out = [];
  for (const word of words) {
    const key = normalizeWordKey(word);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeCatalogCategoryLabel(value) {
  const raw = String(value || "").trim();
  const key = normalizePlaylistText(raw);
  if (key === "bossa" || key.startsWith("bossa ")) return "Bossa";
  return raw;
}

const POPULARITY_FIELD_NAMES = [
  "playbackCount", "playback_count", "playCount", "play_count", "plays",
  "likesCount", "likes_count", "likeCount", "like_count", "likes",
  "repostsCount", "reposts_count", "repostCount", "repost_count", "reposts",
  "commentsCount", "comments_count", "commentCount", "comment_count", "comments",
  "followersCount", "followers_count", "followerCount", "follower_count", "followers",
  "popularity"
];
const REMOVED_CATEGORY_LABELS = new Set(["Other", "Rock/Metal"]);
const LEGACY_BOSSA_CATEGORY_PATTERN = /\bbossa\s*[- ]?\s*nova\b|\bbossanova\b/i;

function normalizePopularityFields(item = {}) {
  const out = {};
  for (const key of POPULARITY_FIELD_NAMES) {
    const value = Number(item[key]);
    if (Number.isFinite(value) && value > 0) out[key] = value;
  }
  return out;
}

export async function readCatalog() {
  try {
    const raw = await fs.readFile(catalogPath, "utf8");
    const data = JSON.parse(raw);
    return normalizeCatalog(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { version: 1, updatedAt: today(), items: [] };
    }
    throw error;
  }
}

export async function writeCatalog(catalog) {
  const normalized = normalizeCatalog({ ...catalog, updatedAt: today() });
  await fs.mkdir(path.dirname(catalogPath), { recursive: true });
  await fs.writeFile(catalogPath, JSON.stringify(normalized, null, 2) + "\n");
  return normalized;
}

export function normalizeCatalog(data) {
  const seen = new Set();
  const items = Array.isArray(data?.items) ? data.items : [];
  const normalized = [];
  for (const item of items) {
    if (!item || item.provider !== "soundcloud") continue;
    const url = normalizeSoundCloudUrl(item.url);
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const categories = Array.isArray(item.categories)
      ? item.categories
      : [item.category || item.mood || "Focus"];
    const cleanCategories = [...new Set(categories.map(normalizeCatalogCategoryLabel).filter(Boolean))];
    const title = String(item.title || "Untitled");
    const artist = String(item.artist || item.author || "SoundCloud");
    const tags = Array.isArray(item.tags) ? [...new Set(item.tags.map((t) => String(t).trim()).filter(Boolean))] : [];
    const displayTitle = makeDisplayTitle(title, artist, cleanCategories, tags);
    const artworkUrl = normalizeSoundCloudArtworkUrl(item.artworkUrl);
    normalized.push({
      id: String(item.id || `soundcloud-${slugify(new URL(url).pathname)}`),
      provider: "soundcloud",
      type: item.type || inferTypeFromUrl(url),
      title,
      displayTitle,
      artist,
      url,
      ...(artworkUrl ? { artworkUrl } : {}),
      ...(item.authorUrl ? { authorUrl: String(item.authorUrl) } : {}),
      categories: cleanCategories,
      tags,
      source: item.source === "user" ? "user" : "curated",
      addedAt: String(item.addedAt || today()),
      verifiedAt: String(item.verifiedAt || today()),
      status: ["active", "broken", "hidden"].includes(item.status) ? item.status : "active",
      ...normalizePopularityFields(item),
      ...(item.soundcloudTrackCount !== undefined && Number.isFinite(Number(item.soundcloudTrackCount)) ? { soundcloudTrackCount: Math.max(0, Math.floor(Number(item.soundcloudTrackCount))) } : {}),
      ...(item.popularityConfidence && ["none", "low", "medium", "high"].includes(item.popularityConfidence) ? { popularityConfidence: item.popularityConfidence } : {}),
      ...(item.popularityUpdatedAt ? { popularityUpdatedAt: String(item.popularityUpdatedAt) } : {})
    });
  }
  const ordered = normalized.map((item, index) => ({ item, index }));
  ordered.sort((a, b) => {
    const categoryA = a.item.categories[0] || "";
    const categoryB = b.item.categories[0] || "";
    const ca = getPlaylistCategoryRank(categoryA) - getPlaylistCategoryRank(categoryB);
    if (ca !== 0) return ca;
    const ranked = compareCatalogItemsForCategory(a.item, b.item, categoryA);
    if (ranked !== 0) return ranked;
    return a.index - b.index;
  });
  return {
    version: Number(data?.version || 1),
    updatedAt: String(data?.updatedAt || today()),
    items: ordered.map((entry) => entry.item)
  };
}

const DUPLICATE_TITLE_STOP_WORDS = new Set([
  "official", "playlist", "playlists", "set", "sets", "music", "songs", "tracks", "track", "mix", "mixes"
]);

export function normalizeDuplicatePlaylistTitle(value = "") {
  return normalizePlaylistText(value)
    .split(" ")
    .filter((word) => word && !DUPLICATE_TITLE_STOP_WORDS.has(word))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getPlaylistDuplicateKey(item = {}) {
  if (item.type !== "playlist" || item.status !== "active") return "";
  const artistKey = normalizePlaylistText(item.artist || "").replace(/\s+\d{1,4}$/, "");
  const titleKey = normalizeDuplicatePlaylistTitle(item.title || item.displayTitle || "");
  if (!titleKey) return "";
  const trackCount = Number(item.soundcloudTrackCount || 0);
  if (trackCount > 0 && hasStrongTitleTrackDuplicateSignal(titleKey)) return `title:${titleKey}::tracks:${Math.floor(trackCount)}`;
  if (!artistKey || ["soundcloud", "unknown", "unknown artist", "unknown curator", "user"].includes(artistKey)) return "";
  if (trackCount > 0) return `${artistKey}::${titleKey}::tracks:${Math.floor(trackCount)}`;
  const primaryCategory = (Array.isArray(item.categories) ? item.categories : [])
    .map(normalizePlaylistText)
    .find((category) => category && category !== "editors choice" && category !== "recent" && category !== "community") || "";
  return `${artistKey}::${titleKey}::category:${primaryCategory}`;
}

function hasStrongTitleTrackDuplicateSignal(titleKey = "") {
  const words = String(titleKey || "").split(/\s+/).filter(Boolean);
  if (words.length >= 2) return true;
  return String(titleKey || "").length >= 12;
}

function duplicateKeeperScore(item = {}) {
  const popularity = POPULARITY_FIELD_NAMES
    .map((field) => Number(item[field] || 0))
    .filter((value) => Number.isFinite(value) && value > 0)
    .reduce((sum, value) => sum + Math.log10(value + 1), 0);
  return (item.source === "curated" ? 20 : 0)
    + (item.artworkUrl ? 8 : 0)
    + (item.soundcloudTrackCount ? 5 : 0)
    + popularity;
}

export function findDuplicatePlaylistGroups(items = []) {
  const groupsByKey = new Map();
  for (const item of items) {
    const key = getPlaylistDuplicateKey(item);
    if (!key) continue;
    const group = groupsByKey.get(key) || [];
    group.push(item);
    groupsByKey.set(key, group);
  }
  return [...groupsByKey.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({
      key,
      keep: group.slice().sort((a, b) => duplicateKeeperScore(b) - duplicateKeeperScore(a))[0],
      duplicates: group.slice().sort((a, b) => duplicateKeeperScore(b) - duplicateKeeperScore(a)).slice(1),
      items: group
    }));
}

export function hideDuplicatePlaylists(catalog) {
  const duplicateGroups = findDuplicatePlaylistGroups(catalog.items || []);
  if (duplicateGroups.length === 0) return { catalog, duplicateGroups, changed: false };

  const hiddenIds = new Set(duplicateGroups.flatMap((group) => group.duplicates.map((item) => item.id)));
  const next = {
    ...catalog,
    items: (catalog.items || []).map((item) => (
      hiddenIds.has(item.id)
        ? {
          ...item,
          status: "hidden",
          tags: [...new Set([...(Array.isArray(item.tags) ? item.tags : []), "duplicate-hidden"])]
        }
        : item
    ))
  };
  return { catalog: next, duplicateGroups, changed: hiddenIds.size > 0 };
}

export function validateCatalog(data) {
  const errors = [];
  if (!data || typeof data !== "object") errors.push("Catalog must be an object");
  if (typeof data.version !== "number") errors.push("version must be a number");
  if (typeof data.updatedAt !== "string") errors.push("updatedAt must be a string");
  if (!Array.isArray(data.items)) errors.push("items must be an array");
  const ids = new Set();
  const urls = new Set();
  const duplicateKeys = new Map();
  for (const [index, item] of (data.items || []).entries()) {
    const prefix = `items[${index}]`;
    for (const field of ["id", "provider", "type", "title", "artist", "url", "source", "addedAt", "verifiedAt", "status"]) {
      if (typeof item[field] !== "string") errors.push(`${prefix}.${field} must be a string`);
    }
    if (item.displayTitle !== undefined && typeof item.displayTitle !== "string") errors.push(`${prefix}.displayTitle must be a string`);
    for (const field of POPULARITY_FIELD_NAMES) {
      if (item[field] !== undefined && (!Number.isFinite(Number(item[field])) || Number(item[field]) < 0)) errors.push(`${prefix}.${field} must be a non-negative number`);
    }
    if (item.soundcloudTrackCount !== undefined && (!Number.isFinite(Number(item.soundcloudTrackCount)) || Number(item.soundcloudTrackCount) < 0)) errors.push(`${prefix}.soundcloudTrackCount must be a non-negative number`);
    if (item.popularityConfidence !== undefined && !["none", "low", "medium", "high"].includes(item.popularityConfidence)) errors.push(`${prefix}.popularityConfidence is invalid`);
    if (item.popularityUpdatedAt !== undefined && typeof item.popularityUpdatedAt !== "string") errors.push(`${prefix}.popularityUpdatedAt must be a string`);
    if (item.displayTitle && displayTitleWords(item.displayTitle).length > 4) errors.push(`${prefix}.displayTitle should be 4 words or fewer`);
    if (item.provider !== "soundcloud") errors.push(`${prefix}.provider must be soundcloud`);
    if (!["track", "playlist", "profile", "album", "unknown"].includes(item.type)) errors.push(`${prefix}.type is invalid`);
    if (!["curated", "user"].includes(item.source)) errors.push(`${prefix}.source is invalid`);
    if (!["active", "broken", "hidden"].includes(item.status)) errors.push(`${prefix}.status is invalid`);
    if (!Array.isArray(item.categories) || item.categories.length === 0) errors.push(`${prefix}.categories must be a non-empty array`);
    if (Array.isArray(item.categories) && item.categories.some((category) => REMOVED_CATEGORY_LABELS.has(String(category)) || LEGACY_BOSSA_CATEGORY_PATTERN.test(String(category)))) errors.push(`${prefix}.categories contains removed/renamed category`);
    if (!Array.isArray(item.tags)) errors.push(`${prefix}.tags must be an array`);
    try {
      const normalizedUrl = normalizeSoundCloudUrl(item.url).toLowerCase();
      if (urls.has(normalizedUrl)) errors.push(`${prefix}.url is duplicated`);
      urls.add(normalizedUrl);
    } catch (error) {
      errors.push(`${prefix}.url invalid: ${error.message}`);
    }
    if (ids.has(item.id)) errors.push(`${prefix}.id is duplicated`);
    ids.add(item.id);
    const duplicateKey = getPlaylistDuplicateKey(item);
    const firstDuplicate = duplicateKey ? duplicateKeys.get(duplicateKey) : null;
    if (firstDuplicate && item.status === "active") errors.push(`${prefix} duplicates active playlist ${firstDuplicate.id}`);
    if (duplicateKey && item.status === "active") duplicateKeys.set(duplicateKey, item);
  }
  return errors;
}

export async function fetchOEmbed(url) {
  const normalizedUrl = assertEmbeddableSoundCloudUrl(url);
  const endpoint = `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(normalizedUrl)}`;
  const response = await fetch(endpoint, {
    headers: { "User-Agent": "MusicProCatalogBot/0.1 (+Obsidian plugin catalog tooling)" }
  });
  if (!response.ok) {
    throw new Error(`oEmbed failed ${response.status} for ${normalizedUrl}`);
  }
  return await response.json();
}

const AVAILABILITY_SCREEN_CACHE = new Map();
const DEFAULT_AVAILABILITY_SCREEN = {
  sampleSize: 12,
  minTrackCount: 4,
  minSampleTracks: 4,
  maxPreviewTracks: 0,
  maxRestrictedTracks: 0,
  maxShortTracks: 0,
  rejectOnUnknown: true,
  strictPolicy: true
};

export function extractSoundCloudHydration(html = "") {
  const match = String(html || "").match(/window\.__sc_hydration\s*=\s*([\s\S]*?);<\/script>/);
  if (!match?.[1]) return [];
  try {
    const data = JSON.parse(match[1]);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function isLikelySoundCloudPreviewTrack(raw = {}) {
  const policy = String(raw?.policy || "").toUpperCase();
  if (policy === "SNIP") return true;
  const playable = Number(raw?.duration || 0);
  const full = Number(raw?.full_duration || 0);
  if (!Number.isFinite(playable) || !Number.isFinite(full)) return false;
  if (playable < 15_000 || playable > 70_000) return false;
  if (full < 60_000) return false;
  if (full - playable < 20_000) return false;
  return playable / full < 0.72;
}

export function getRawSoundCloudAvailabilityReason(raw = {}, options = {}) {
  const strictPolicy = options.strictPolicy !== false;
  const policy = String(raw?.policy || "").toUpperCase();
  const state = String(raw?.state || "").toLowerCase();
  const sharing = String(raw?.sharing || "").toLowerCase();
  const embeddableBy = String(raw?.embeddable_by || "").toLowerCase();
  if (strictPolicy && policy === "SNIP") return "preview-only";
  if (strictPolicy && policy === "BLOCK") return "restricted-policy";
  if (state && state !== "finished") return "unavailable-state";
  if (sharing === "private") return "private";
  if (embeddableBy && embeddableBy !== "all") return "not-publicly-embeddable";
  if (policy && policy !== "ALLOW" && Array.isArray(raw?.media?.transcodings) && raw.media.transcodings.length === 0) return "no-public-transcoding";
  return "";
}

function hasUsefulAvailabilityMetadata(raw = {}) {
  return Boolean(
    raw?.title
    || raw?.duration
    || raw?.full_duration
    || raw?.state
    || raw?.sharing
    || raw?.embeddable_by
    || raw?.media?.transcodings
  );
}

async function hydrateSoundCloudScreenTracks(rawTracks, clientId, sampleSize) {
  const shouldScreenAll = sampleSize === "all" || sampleSize === Infinity || Number(sampleSize) <= 0;
  const limit = shouldScreenAll ? rawTracks.length : Math.max(0, Math.floor(Number(sampleSize) || 0));
  const sample = rawTracks.slice(0, limit);
  const shallowIds = sample
    .filter((track) => track?.id && !hasUsefulAvailabilityMetadata(track))
    .map((track) => String(track.id));
  if (!clientId || shallowIds.length === 0) return sample;

  const fullById = new Map();
  const chunks = [];
  for (let index = 0; index < shallowIds.length; index += 50) chunks.push(shallowIds.slice(index, index + 50));
  try {
    for (const chunk of chunks) {
      const endpoint = `https://api-v2.soundcloud.com/tracks?ids=${encodeURIComponent(chunk.join(","))}&client_id=${encodeURIComponent(clientId)}`;
      const response = await fetch(endpoint, {
        headers: { "User-Agent": "MusicProCatalogBot/0.1 (+Obsidian plugin catalog tooling)", Accept: "application/json" }
      });
      if (!response.ok) continue;
      const hydratedTracks = await response.json();
      if (!Array.isArray(hydratedTracks)) continue;
      for (const track of hydratedTracks) {
        const id = String(track?.id || "");
        if (id) fullById.set(id, track);
      }
    }
    return sample.map((track) => fullById.get(String(track?.id || "")) || track);
  } catch {
    return sample;
  }
}

export async function screenSoundCloudPlaylistAvailability(url, options = {}) {
  const settings = { ...DEFAULT_AVAILABILITY_SCREEN, ...options };
  const normalizedUrl = assertEmbeddableSoundCloudUrl(url);
  if (inferTypeFromUrl(normalizedUrl) !== "playlist") {
    return { ok: true, reason: "non-playlist", trackCount: 0, sampledTracks: 0, playableCount: 0, previewCount: 0, restrictedCount: 0, shortCount: 0, unknownCount: 0, qualityBonus: 0 };
  }

  const cacheKey = JSON.stringify([normalizedUrl, settings.sampleSize, settings.minTrackCount, settings.strictPolicy]);
  const cached = AVAILABILITY_SCREEN_CACHE.get(cacheKey);
  if (cached) return cached;

  let pageArtworkUrl = "";
  let firstTrackArtworkUrl = "";
  const fail = (reason, extra = {}) => {
    const result = { ok: false, reason, trackCount: 0, sampledTracks: 0, playableCount: 0, previewCount: 0, restrictedCount: 0, shortCount: 0, unknownCount: 0, qualityBonus: -100, artworkUrl: pageArtworkUrl || firstTrackArtworkUrl || "", firstTrackArtworkUrl, ...extra };
    AVAILABILITY_SCREEN_CACHE.set(cacheKey, result);
    return result;
  };

  let html = "";
  try {
    const response = await fetch(normalizedUrl, {
      headers: { "User-Agent": "MusicProCatalogBot/0.1 (+Obsidian plugin catalog tooling)", Accept: "text/html,application/xhtml+xml" }
    });
    if (!response.ok) return fail(`page-${response.status}`);
    html = await response.text();
  } catch {
    return fail("page-fetch-failed");
  }

  pageArtworkUrl = extractPageArtworkUrl(html);
  const hydration = extractSoundCloudHydration(html);
  const playlist = hydration.find((entry) => entry?.hydratable === "playlist")?.data;
  const clientId = String(hydration.find((entry) => entry?.hydratable === "apiClient")?.data?.id || "");
  const rawTracks = Array.isArray(playlist?.tracks) ? playlist.tracks : [];
  firstTrackArtworkUrl = extractFirstUsableTrackArtworkUrl(rawTracks);
  const trackCount = rawTracks.length;
  const playlistSharing = String(playlist?.sharing || "").toLowerCase();
  const playlistEmbeddableBy = String(playlist?.embeddable_by || "").toLowerCase();

  if (!playlist) return fail("playlist-metadata-missing");
  if (playlist?.public === false || playlistSharing === "private") return fail("playlist-private", { trackCount });
  if (playlistEmbeddableBy && playlistEmbeddableBy !== "all") return fail("playlist-not-publicly-embeddable", { trackCount });
  if (trackCount < settings.minTrackCount) return fail("too-few-tracks", { trackCount });

  const tracks = await hydrateSoundCloudScreenTracks(rawTracks, clientId, settings.sampleSize);
  if (!firstTrackArtworkUrl) firstTrackArtworkUrl = extractFirstUsableTrackArtworkUrl(tracks);
  if (tracks.length < settings.minSampleTracks) return fail("too-few-sampled-tracks", { trackCount, sampledTracks: tracks.length });

  let playableCount = 0;
  let previewCount = 0;
  let restrictedCount = 0;
  let shortCount = 0;
  let unknownCount = 0;
  let totalPlayableDurationMs = 0;

  for (const track of tracks) {
    const durationMs = Number(track?.duration || 0);
    const fullDurationMs = Number(track?.full_duration || 0);
    const hasDuration = Number.isFinite(durationMs) && durationMs > 0;
    const preview = isLikelySoundCloudPreviewTrack(track);
    const reason = preview ? "preview-only" : getRawSoundCloudAvailabilityReason(track, settings);
    const short = !preview && hasDuration && durationMs <= 30_000 && (!fullDurationMs || Math.abs(fullDurationMs - durationMs) < 2000);

    if (reason) {
      if (reason === "preview-only") previewCount += 1;
      else restrictedCount += 1;
      continue;
    }
    if (short) {
      shortCount += 1;
      continue;
    }
    if (!hasUsefulAvailabilityMetadata(track) || !hasDuration) {
      unknownCount += 1;
      continue;
    }
    playableCount += 1;
    totalPlayableDurationMs += durationMs;
  }

  const sampledTracks = tracks.length;
  const rejectReason = previewCount > settings.maxPreviewTracks
    ? "preview-tracks"
    : restrictedCount > settings.maxRestrictedTracks
      ? "restricted-tracks"
      : shortCount > settings.maxShortTracks
        ? "short-tracks"
        : settings.rejectOnUnknown && unknownCount > 0
          ? "unknown-track-availability"
          : "";
  if (rejectReason) {
    return fail(rejectReason, { trackCount, sampledTracks, playableCount, previewCount, restrictedCount, shortCount, unknownCount });
  }

  const averagePlayableDurationMs = playableCount > 0 ? totalPlayableDurationMs / playableCount : 0;
  const qualityBonus = Math.min(20, playableCount * 1.2 + Math.log10(trackCount + 1) * 2 + (averagePlayableDurationMs >= 120_000 ? 4 : 0));
  const result = { ok: true, reason: "public-full-playable-sample", trackCount, sampledTracks, playableCount, previewCount, restrictedCount, shortCount, unknownCount, qualityBonus, artworkUrl: pageArtworkUrl || firstTrackArtworkUrl || "", firstTrackArtworkUrl };
  AVAILABILITY_SCREEN_CACHE.set(cacheKey, result);
  return result;
}

export function inferTypeFromOEmbed(url, data = {}) {
  const html = String(data.html || "");
  if (html.includes("api.soundcloud.com%2Fplaylists") || html.includes("api.soundcloud.com/playlists")) return "playlist";
  if (html.includes("api.soundcloud.com%2Ftracks") || html.includes("api.soundcloud.com/tracks")) return "track";
  if (html.includes("api.soundcloud.com%2Fusers") || html.includes("api.soundcloud.com/users")) return "profile";
  return inferTypeFromUrl(url);
}

export function makeItemFromOEmbed(url, data, options = {}) {
  const normalizedUrl = assertEmbeddableSoundCloudUrl(url);
  const artist = String(data.author_name || "SoundCloud").trim();
  const title = cleanTitle(data.title || "Untitled", artist);
  const baseSlug = slugify(`${new URL(normalizedUrl).pathname}`);
  const tags = Array.isArray(options.tags) ? options.tags : [];
  const categories = Array.isArray(options.categories) && options.categories.length > 0
    ? options.categories
    : options.category
      ? [options.category]
      : inferPlaylistCategories({
        title,
        artist,
        url: normalizedUrl,
        tags
      });
  const cleanCategories = [...new Set(categories.map(normalizeCatalogCategoryLabel).filter(Boolean))];
  if (cleanCategories.length === 0) throw new Error(`Could not classify ${title}; pass --categories with a Music Pro category.`);
  const cleanTags = [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))];
  const artworkUrl = normalizeSoundCloudArtworkUrl(data.thumbnail_url);
  return {
    id: `soundcloud-${baseSlug}`,
    provider: "soundcloud",
    type: inferTypeFromOEmbed(normalizedUrl, data),
    title,
    displayTitle: makeDisplayTitle(title, artist, cleanCategories, cleanTags),
    artist,
    url: normalizedUrl,
    ...(artworkUrl ? { artworkUrl } : {}),
    ...(data.author_url ? { authorUrl: String(data.author_url) } : {}),
    categories: cleanCategories,
    tags: cleanTags,
    source: options.source === "user" ? "user" : "curated",
    addedAt: today(),
    verifiedAt: today(),
    status: "active"
  };
}

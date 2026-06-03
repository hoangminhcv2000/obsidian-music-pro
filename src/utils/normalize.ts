export function today(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function normalizeSoundCloudUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error("Please enter a SoundCloud URL.");
  const prefixed = raw.startsWith("http") ? raw : `https://${raw}`;
  const url = new URL(prefixed);
  const allowed = ["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com", "on.soundcloud.com"];
  if (!allowed.includes(url.hostname)) throw new Error("Only SoundCloud links are supported in this version.");
  if (url.hostname !== "on.soundcloud.com") url.hostname = "soundcloud.com";
  url.protocol = "https:";
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

export function isSoundCloudPlaceholderArtworkUrl(input: unknown): boolean {
  const url = typeof input === "string" ? input.trim() : "";
  return !url || /soundcloud\.com\/images\/fb_placeholder\.png/i.test(url);
}

export function normalizeSoundCloudArtworkUrl(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const raw = input.trim();
  if (isSoundCloudPlaceholderArtworkUrl(raw)) return undefined;
  const httpsUrl = raw.replace(/^http:\/\//i, "https://");
  if (!/sndcdn\.com/i.test(httpsUrl)) return httpsUrl;
  return httpsUrl.replace(
    /-(?:t\d+x\d+|large|small|tiny|mini|badge|crop|original)\.(jpe?g|png|webp)(\?.*)?$/i,
    "-t500x500.$1$2"
  );
}

export function isSoundCloudDiscoverSetUrl(input: string): boolean {
  try {
    const normalized = normalizeSoundCloudUrl(input);
    const parsed = new URL(normalized);
    const parts = parsed.pathname.split("/").filter(Boolean);
    return parts[0] === "discover" && parts[1] === "sets";
  } catch {
    return false;
  }
}

export function assertEmbeddableSoundCloudUrl(input: string): string {
  const normalized = normalizeSoundCloudUrl(input);
  if (isSoundCloudDiscoverSetUrl(normalized)) {
    throw new Error("SoundCloud personalized Discover playlists cannot be added or played inside the embedded player. Open the actual public track or /sets/ playlist, then copy its normal SoundCloud URL.");
  }
  return normalized;
}


export function inferSoundCloudType(url: string): "track" | "playlist" | "profile" | "album" | "unknown" {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    if (url.includes("on.soundcloud.com")) return "unknown";
    if (parts.includes("sets")) return "playlist";
    if (parts.includes("albums")) return "album";
    if (parts.length <= 1) return "profile";
    return "track";
  } catch {
    return "unknown";
  }
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "item";
}

export function cleanTitle(title: string, artist: string): string {
  const suffix = ` by ${artist}`;
  if (artist && title.toLowerCase().endsWith(suffix.toLowerCase())) {
    return title.slice(0, -suffix.length).trim() || title;
  }
  return title.trim() || "Untitled";
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

const INSTRUMENT_FALLBACKS: Array<{ label: string; keywords: string[] }> = [
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

const MOOD_FALLBACKS: Array<{ label: string; keywords: string[] }> = [
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

export function normalizeDisplayTitle(value: string): string {
  return value
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

export function makeDisplayTitle(title: string, artist = "", categories: string[] = [], tags: string[] = []): string {
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

  const context = [...categories, ...tags].join(" ");
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
    if (context && displayTitleWords(shortened).some((word) => context.toLowerCase().includes(word.toLowerCase()))) score += 2;
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

export function getDisplayTitle(item: { title: string; displayTitle?: string; artist?: string; categories?: string[]; tags?: string[] }): string {
  const saved = normalizeDisplayTitle(item.displayTitle || "");
  return isMeaningfulCompactTitle(saved)
    ? saved
    : makeDisplayTitle(item.title, item.artist || "", item.categories || [], item.tags || []);
}

export function getDisplaySubtitle(item: { title: string; displayTitle?: string; artist?: string; categories?: string[]; tags?: string[] }): string {
  const displayTitle = getDisplayTitle(item);
  const compactArtist = makeCompactArtistTitle(item.artist || "");
  if (compactArtist && normalizePhraseKey(compactArtist) !== normalizePhraseKey(displayTitle)) return compactArtist;

  const fallback = makeCompactContextFallback(item.categories || [], item.tags || [], item.title || "", "instrument")
    || makeCompactContextFallback(item.categories || [], item.tags || [], item.title || "", "mood");
  return fallback && normalizePhraseKey(fallback) !== normalizePhraseKey(displayTitle) ? fallback : "";
}

function cleanupDisplayTitleSource(value: string, artist: string): string {
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

function shortenDisplayTitleCandidate(candidate: string, artist: string): string {
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
  const words: string[] = [];
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

function isMeaningfulCompactTitle(value: string): boolean {
  const clean = normalizeDisplayTitle(value || "");
  if (!clean) return false;
  const key = normalizePhraseKey(clean);
  if (GENERIC_COMPACT_TITLE_KEYS.has(key)) return false;
  if (!/\p{L}/u.test(clean)) return false;
  return displayTitleWords(clean).some((word) => !DISPLAY_TITLE_STOP_WORDS.has(normalizeWordKey(word)));
}

function makeCompactArtistTitle(artist: string): string {
  const clean = stripNoisyArtistSuffix(normalizeDisplayTitle(artist || ""));
  if (!clean) return "";
  const key = normalizePhraseKey(clean);
  if (GENERIC_ARTIST_KEYS.has(key) || /^user\s+\d+$/.test(key)) return "";
  const words = uniqueWords(displayTitleWords(clean).map(formatDisplayWord).filter(Boolean));
  return words.slice(0, DISPLAY_TITLE_MAX_WORDS).join(" ");
}

function stripNoisyArtistSuffix(value: string): string {
  const words = displayTitleWords(value);
  const last = words[words.length - 1] || "";
  if (words.length >= 3 && /^\d{1,4}$/.test(last)) {
    const withoutSuffix = words.slice(0, -1);
    const letterWords = withoutSuffix.filter((word) => /\p{L}/u.test(word));
    if (letterWords.length >= 2) return withoutSuffix.join(" ");
  }
  return value;
}

function makeCompactContextFallback(categories: string[], tags: string[], title: string, kind: "instrument" | "mood"): string {
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

function shortenNameCandidate(value: string): string {
  return uniqueWords(displayTitleWords(value).map(formatDisplayWord).filter(Boolean)).slice(0, DISPLAY_TITLE_MAX_WORDS).join(" ");
}

function phraseIncludes(haystackKey: string, needleKey: string): boolean {
  if (!needleKey) return false;
  return ` ${haystackKey} `.includes(` ${needleKey} `);
}

function displayTitleWords(value: string): string[] {
  return value.match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)?/gu) || [];
}

function expandDisplayWord(word: string): string[] {
  const key = normalizeWordKey(word);
  if (key === "lofi" || key === "lo-fi") return ["Lo-Fi"];
  if (key === "hiphop" || key === "hip-hop") return ["Hip-Hop"];
  if (key === "chillhop") return ["Chillhop"];
  if (key === "bossanova") return ["Bossa"];
  if (key === "sleeping") return ["Sleep"];
  return [formatDisplayWord(word)];
}

function formatDisplayWord(word: string): string {
  const key = normalizeWordKey(word);
  if (!key) return "";
  if (key === "hz") return "Hz";
  if (DISPLAY_TITLE_ACRONYMS.has(key)) return key === "lofi" ? "Lo-Fi" : key.toUpperCase();
  if (/^\d+$/.test(word)) return word;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function normalizeWordKey(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizePhraseKey(value: string): string {
  return displayTitleWords(value).map(normalizeWordKey).filter(Boolean).join(" ");
}

function uniqueWords(words: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of words) {
    const key = normalizeWordKey(word);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

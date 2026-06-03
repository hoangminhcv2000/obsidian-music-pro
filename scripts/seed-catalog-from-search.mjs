#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { bundledPath, cleanTitle, extractSoundCloudHydration, fetchOEmbed, makeDisplayTitle, makeItemFromOEmbed, normalizeCatalog, normalizeSoundCloudUrl, readCatalog, screenSoundCloudPlaylistAvailability, slugify, today, validateCatalog, writeCatalog } from "./catalog-utils.mjs";
import { compareCatalogItemsForCategory, getPlaylistSortProfile, inferPlaylistCategories, normalizePlaylistText } from "./playlist-category-rules.mjs";

const args = process.argv.slice(2);
const target = Number(args.find((arg) => arg.startsWith("--target="))?.split("=")[1] || 650);
const freshCatalog = args.includes("--fresh") || args.includes("--new-catalog");
const wideSearch = freshCatalog || args.includes("--wide") || args.includes("--fill");

const bannedPattern = /(sex|erotic|sensual|seductive|dirty|freaky|porn|xxx|nsfw|white girl|weed|cocaine|meth|lean|\bdmt\b|psychedelic|testosterone|anabolic|\bgym\b|phonk|sped up|tiktok|rap mix|\brap\b|hip hop|hip-hop|breakcore|\bdnb\b|dubstep|hardstyle|psytrance|\btrance\b|\btechno\b|festival|tomorrowland|mouth sounds|kissing|licking|free download|divorced dad|lil peep|cigarettes after sex|scag ultrakill|demogorgon|dark ambient|dark forest|dark fantasy|horror ambience|gothic ambience|traumatic|predator|kosing|anne\s*frank|ghetto|no1cattledecapitationfan|mr\. snare|bruce wayne|folk metal|classic rock|cypress hill|redman|rain world|royalty free|smooth\s*hiphop|hiphop|yasiin|halloween hack|savage planet|related tracks|copy-of|wind archer|wind down|oc ambience|pure relaxing|campfire songs|campfire acoustic)/i;
const MAX_ADDED_PER_QUERY = wideSearch ? 8 : 3;
const MAX_SIMILAR_TITLE_PER_CATEGORY = 2;
const MAX_LINKS_PER_QUERY = wideSearch ? 80 : 8;
const FETCH_DELAY_MS = wideSearch ? 25 : 150;
const SCREEN_CONCURRENCY = wideSearch ? 10 : 2;
const HOUSE_PLAYLIST_MIN_TRACK_COUNT = 4;
const availabilitySampleArg = args.find((arg) => arg.startsWith("--availability-sample="))?.split("=")[1] || "";
const AVAILABILITY_SCREEN_SAMPLE_SIZE = availabilitySampleArg === "all"
  ? "all"
  : Number.isFinite(Number(availabilitySampleArg)) && Number(availabilitySampleArg) > 0
    ? Math.floor(Number(availabilitySampleArg))
    : wideSearch ? 12 : 8;
const DEFAULT_CATEGORY_LABELS = [
  "Ambience",
  "Jazz & Blues",
  "Orchestra",
  "Piano",
  "Movies/Games",
  "Handpan & Kalimba",
  "House",
  "Acoustic",
  "Fantasy Folk",
  "Bossa",
  "Asia",
  "Middle East"
];
const LOW_VALUE_ARTIST_PATTERN = /^(?:unknown|unknown artist|unknown curator|soundcloud|user(?:\s+\d+)?|\d{1,4}|[a-z])$/i;
const GENERIC_TITLE_PATTERN = /^(?:playlist|music|songs?|tracks?|set|mix|album|piano|classical|guitar|acoustic|handpan|hang\s+drum|kalimba|house|bossa|jazz|blues|soul|medieval|viking|ambient|ambience|soundtrack|ost|score|com)(?:\s+\d{1,4})?$/i;
const QUERY_STOP_WORDS = new Set([
  "playlist", "playlists", "music", "song", "songs", "track", "tracks", "set", "sets", "mix", "album",
  "soundtrack", "soundtracks", "ost", "score", "scores", "theme", "themes", "official", "complete",
  "classical", "piano", "guitar", "acoustic", "instrumental", "traditional", "relaxing", "meditation"
]);
const QUERY_ENTITY_STOP_WORDS = new Set([
  ...QUERY_STOP_WORDS,
  "ambient", "ambience", "soundscape", "frequency", "frequencies", "hz", "hertz", "binaural", "solfeggio",
  "white", "brown", "pink", "noise", "rain", "forest", "jungle", "ocean", "waves", "river", "waterfall",
  "wind", "fireplace", "campfire", "field", "recordings", "environmental", "space", "cosmic", "liminal",
  "jazz", "blues", "soul", "saxophone", "swing", "bebop", "coffee", "cafe", "smooth", "lounge", "late",
  "night", "symphony", "orchestra", "orchestral", "chamber", "strings", "quartet", "violin", "cello",
  "choir", "concerto", "sonata", "covers", "cover", "video", "game", "games", "movie", "film", "anime",
  "handpan", "hang", "drum", "pantam", "steel", "tongue", "kalimba", "mbira", "thumb", "house", "funky",
  "disco", "deep", "soulful", "chill", "nu", "classic", "groove", "groovy", "jazzy", "balearic", "country",
  "fingerstyle", "fingerpicking", "americana", "texas", "outlaw", "bluegrass", "folk", "western", "solo",
  "fantasy", "medieval", "tavern", "bard", "celtic", "nordic", "norse", "scandinavian", "viking", "dnd",
  "dungeons", "dragons", "lute", "hurdy", "gurdy", "elven", "shire", "dungeon", "synth", "bossa", "latin",
  "brazilian", "samba", "salsa", "tango", "bolero", "afro", "cuban", "asia", "asian", "chinese", "japanese",
  "korean", "vietnamese", "sitar", "tabla", "raga", "guzheng", "guqin", "erhu", "pipa", "koto", "shamisen",
  "shakuhachi", "taiko", "gamelan", "middle", "east", "eastern", "arabic", "persian", "turkish", "oud",
  "qanun", "ney", "darbuka", "maqam", "hijaz", "duduk", "desert", "caravan"
]);

function isSafeSeedCandidate(text) {
  if (bannedPattern.test(text)) return false;
  const titleText = text.replace(/https?:\/\/\S+/g, "").trim();
  const lowered = text.toLowerCase();
  if ((titleText.match(/~/g) || []).length >= 3) return false;
  if (titleText.length > 160) return false;
  if (/^copy of\b/i.test(titleText)) return false;
  if (/^untitled\s+playlist\b/i.test(titleText)) return false;
  if (/^(?:untitled\s+)?playlist(?:\s*#?\d+)?$/i.test(titleText)) return false;
  if (/^my\s+playlist(?:\s*#?\d+)?$/i.test(titleText)) return false;
  if (/^n$/i.test(titleText)) return false;
  if (/\bsleep playlist\.?\b/.test(lowered) && !/(rain|noise|frequency|hz|binaural|solfeggio|nature|ocean|forest|wind)/.test(lowered)) return false;
  return true;
}

function similarTitleKey(value) {
  return slugify(String(value || "")
    .replace(/\b(official|full|complete|the|playlist|playlists|set|sets|music|songs?|tracks?|mix|radio|essentials?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function exactTitleArtistKey(title, artist) {
  return `${similarTitleKey(artist)}::${similarTitleKey(title)}`;
}

function queryCoreTokens(query) {
  const tokens = normalizePlaylistText(query)
    .split(" ")
    .filter((token) => token.length >= 2);
  const entityTokens = tokens.filter((token) => !QUERY_ENTITY_STOP_WORDS.has(token));
  const fallbackTokens = tokens.filter((token) => !QUERY_STOP_WORDS.has(token));
  return (entityTokens.length > 0 ? entityTokens : fallbackTokens).slice(0, 5);
}

function hasQueryIntentMatch(query, title, artist, url) {
  const tokens = queryCoreTokens(query);
  if (tokens.length === 0) return true;
  const haystack = normalizePlaylistText([title, artist].join(" "));
  return tokens.some((token) => ` ${haystack} `.includes(` ${token} `));
}

function isLowValueSeedMetadata(title, artist, categories = []) {
  const titleKey = normalizePlaylistText(title);
  const artistKey = normalizePlaylistText(artist).replace(/\s+\d{1,4}$/, "");
  const categoryKeys = new Set(categories.map(normalizePlaylistText));
  if (!titleKey || !artistKey) return true;
  if (LOW_VALUE_ARTIST_PATTERN.test(artistKey)) return true;
  if (GENERIC_TITLE_PATTERN.test(titleKey)) return true;
  if (categoryKeys.has(titleKey)) return true;
  if (titleKey.length <= 3) return true;
  return false;
}

function makeSeedCandidate(url, data, plan) {
  const artist = String(data.author_name || "SoundCloud").trim();
  const title = cleanTitle(data.title || "Untitled", artist);
  if (!isSafeSeedCandidate(`${title} ${artist} ${url}`)) return null;
  if (!hasQueryIntentMatch(plan.query, title, artist, url)) return null;
  const inferredCategories = inferPlaylistCategories({ title, artist, url });
  const categoryMatch = inferredCategories.some((category) => plan.categories.includes(category));
  if (!categoryMatch) return null;
  if (isLowValueSeedMetadata(title, artist, inferredCategories)) return null;
  const item = makeItemFromOEmbed(url, data, {
    categories: inferredCategories,
    tags: [...new Set([...plan.tags, ...inferredCategories.map((category) => slugify(category))])],
    source: "curated"
  });
  const score = Math.max(...inferredCategories.map((category) => getPlaylistSortProfile(item, category).totalScore)) - getAvailabilityRiskPenalty(title, artist, url);
  return { item, title, artist, categories: inferredCategories, score };
}

function getAvailabilityRiskPenalty(title = "", artist = "", url = "") {
  const text = normalizePlaylistText([title, artist, url].join(" "));
  let penalty = 0;
  if (/\b(?:official|album|release|releases|major|label|chart|charts|hits|top|essentials|radio)\b/.test(text)) penalty += 8;
  if (/\b(?:go plus|go\+|preview|30 sec|30 seconds|snippet|snip)\b/.test(text)) penalty += 40;
  if (/\b(?:lofi girl|soundcloud playlists|sc playlists)\b/.test(text)) penalty += 6;
  return penalty;
}

async function applyAvailabilityScreen(candidate, url) {
  const isHouseCandidate = candidate.categories.includes("House") || candidate.item.categories.includes("House");
  const screen = await screenSoundCloudPlaylistAvailability(url, {
    sampleSize: AVAILABILITY_SCREEN_SAMPLE_SIZE,
    minTrackCount: isHouseCandidate ? HOUSE_PLAYLIST_MIN_TRACK_COUNT : 1,
    minSampleTracks: isHouseCandidate ? HOUSE_PLAYLIST_MIN_TRACK_COUNT : 1,
    maxPreviewTracks: 0,
    maxRestrictedTracks: 0,
    maxShortTracks: 0,
    rejectOnUnknown: true,
    strictPolicy: true
  });
  if (!screen.ok) return { candidate: null, screen };
  if (screen.artworkUrl && !candidate.item.artworkUrl) candidate.item.artworkUrl = screen.artworkUrl;
  candidate.item.soundcloudTrackCount = screen.trackCount;
  candidate.score += screen.qualityBonus;
  return { candidate, screen };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

function plan(categories, tags, queries) {
  return queries.map((query) => ({ categories, tags, query }));
}

const queryGroups = [
  plan(["Ambience"], ["ambience", "frequency", "nature"], [
    "432 hz frequency playlist", "528 hz solfeggio playlist", "binaural beats frequency playlist",
    "white noise playlist", "brown noise playlist", "pink noise playlist", "rain ambience playlist",
    "rain sleep playlist", "forest nature sounds playlist", "jungle sounds playlist", "ocean waves ambience playlist",
    "river sounds playlist", "waterfall nature sounds playlist", "wind ambience playlist", "fireplace ambience playlist",
    "campfire ambience playlist", "field recordings nature playlist", "environmental soundscape playlist",
    "space ambience playlist", "cosmic ambience playlist", "liminal ambience playlist"
  ]),
  plan(["Jazz & Blues"], ["jazz", "blues", "soul"], [
    "Miles Davis playlist", "John Coltrane playlist", "Nina Simone playlist", "Ella Fitzgerald playlist",
    "Louis Armstrong playlist", "BB King blues playlist", "Muddy Waters playlist", "Aretha Franklin playlist",
    "Otis Redding playlist", "Marvin Gaye playlist", "Al Green playlist", "Erykah Badu neo soul playlist",
    "classic soul playlist", "motown soul playlist", "neo soul playlist", "soul jazz playlist",
    "jazz coffee playlist", "coffee jazz playlist", "cafe jazz playlist", "smooth jazz playlist",
    "lounge jazz playlist", "saxophone jazz playlist", "delta blues playlist", "electric blues playlist",
    "swing jazz playlist", "bebop jazz playlist", "late night jazz playlist"
  ]),
  plan(["Orchestra"], ["orchestra", "classical", "strings"], [
    "Bach classical playlist", "Mozart classical playlist", "Beethoven symphony playlist", "Tchaikovsky playlist",
    "Vivaldi classical playlist", "Yo Yo Ma cello playlist", "Hilary Hahn violin playlist", "Itzhak Perlman violin playlist",
    "London Symphony Orchestra playlist", "Berlin Philharmonic playlist", "Vienna Philharmonic playlist",
    "orchestral music playlist", "classical music playlist", "symphony playlist", "chamber music playlist",
    "string quartet playlist", "violin classical playlist", "cello classical playlist", "choir classical playlist",
    "violin concerto playlist", "cello suite playlist"
  ]),
  plan(["Piano"], ["piano", "solo"], [
    "Chopin piano playlist", "Ludovico Einaudi piano playlist", "Yiruma piano playlist", "Nils Frahm piano playlist",
    "George Winston piano playlist", "Joep Beving piano playlist", "Glenn Gould piano playlist", "Martha Argerich piano playlist",
    "solo piano playlist", "peaceful piano playlist", "soft piano playlist", "study piano playlist",
    "classical piano playlist", "piano sonata playlist", "piano concerto playlist", "piano covers playlist"
  ]),
  plan(["Movies/Games"], ["ost", "soundtrack"], [
    "legend of zelda soundtrack playlist", "ocarina of time soundtrack playlist", "mario soundtrack playlist",
    "minecraft c418 soundtrack playlist", "final fantasy nobuo uematsu playlist", "chrono trigger soundtrack playlist",
    "nier automata soundtrack playlist", "persona soundtrack playlist", "halo soundtrack playlist", "skyrim jeremy soule playlist",
    "witcher soundtrack playlist", "journey game soundtrack playlist", "hollow knight soundtrack playlist", "celeste soundtrack playlist",
    "undertale soundtrack playlist", "red dead redemption soundtrack playlist", "the last of us soundtrack playlist",
    "baldur's gate soundtrack playlist", "elden ring soundtrack playlist", "god of war soundtrack playlist",
    "studio ghibli joe hisaishi playlist", "star wars john williams playlist", "lord of the rings howard shore playlist",
    "harry potter soundtrack playlist", "interstellar hans zimmer playlist", "dune soundtrack playlist",
    "oppenheimer soundtrack playlist", "blade runner soundtrack playlist", "pirates of the caribbean soundtrack playlist",
    "jurassic park soundtrack playlist", "la la land soundtrack playlist", "amelie soundtrack playlist",
    "cinema paradiso soundtrack playlist", "godfather soundtrack playlist", "anime soundtrack playlist",
    "naruto soundtrack playlist", "one piece soundtrack playlist", "attack on titan ost playlist",
    "demon slayer soundtrack playlist", "jujutsu kaisen soundtrack playlist", "death note soundtrack playlist",
    "cowboy bebop soundtrack playlist", "evangelion soundtrack playlist", "samurai champloo soundtrack playlist",
    "fullmetal alchemist soundtrack playlist", "steins gate soundtrack playlist", "your name soundtrack playlist",
    "suzume soundtrack playlist", "violet evergarden soundtrack playlist", "video game ost playlist", "movie soundtrack playlist"
  ]),
  plan(["Handpan & Kalimba"], ["handpan", "kalimba"], [
    "handpan playlist", "hang drum playlist", "pantam handpan playlist", "handpan meditation playlist",
    "steel tongue drum playlist", "kalimba playlist", "kalimba relaxing playlist", "mbira playlist", "thumb piano playlist"
  ]),
  plan(["House"], ["house", "groove", "disco"], [
    "Flavour Trip house playlist", "Flavour Trip house mix", "Amii Watson Jimmi Harvey playlist",
    "chillout rooftop house Flavour Trip", "soft chill house Flavour Trip", "smooth jazz house Flavour Trip",
    "chill lounge house Flavour Trip", "funky disco house Flavour Trip", "feel good house Amii Watson",
    "Defected house playlist", "Glitterbox disco house playlist", "Folamour playlist",
    "Purple Disco Machine playlist", "Kerri Chandler playlist", "Moodymann playlist", "Masters At Work playlist",
    "Kaytranada house playlist", "warm house groove playlist", "funky house playlist", "disco house playlist",
    "deep house playlist", "soulful house playlist", "chill house playlist", "lounge house playlist",
    "nu disco playlist", "classic house playlist", "disco groove playlist", "jazzy house playlist",
    "balearic house playlist"
  ]),
  plan(["Acoustic"], ["acoustic", "guitar", "country"], [
    "Tommy Emmanuel acoustic guitar playlist", "Andy McKee fingerstyle playlist", "John Fahey guitar playlist",
    "Leo Kottke guitar playlist", "Willie Nelson acoustic playlist", "Townes Van Zandt playlist", "Guy Clark playlist",
    "Doc Watson bluegrass playlist", "Tony Rice bluegrass playlist", "acoustic guitar playlist", "solo acoustic guitar playlist",
    "fingerstyle guitar playlist", "americana acoustic playlist", "texas country playlist", "country acoustic playlist",
    "outlaw country acoustic playlist", "bluegrass acoustic playlist", "folk guitar playlist", "western acoustic playlist"
  ]),
  plan(["Fantasy Folk"], ["fantasy", "folk", "nordic"], [
    "Wardruna playlist", "Heilung playlist", "Danheim playlist", "Faun medieval playlist", "Skald viking playlist",
    "Nordic folk playlist", "Norse music playlist", "Scandinavian folk playlist", "Viking folk playlist",
    "medieval fantasy playlist", "fantasy tavern music playlist", "bard music playlist", "Celtic folk playlist",
    "dnd tavern playlist", "dungeons and dragons music playlist", "lute medieval playlist", "hurdy gurdy medieval playlist",
    "medieval folk playlist", "elven music playlist", "shire music playlist", "dungeon synth playlist"
  ]),
  plan(["Bossa"], ["bossa", "latin", "lounge"], [
    "Antonio Carlos Jobim playlist", "Joao Gilberto playlist", "Astrud Gilberto playlist", "Stan Getz bossa playlist",
    "Elis Regina playlist", "Buena Vista Social Club playlist", "bossa playlist", "bossa jazz playlist",
    "cafe bossa playlist", "brazilian jazz playlist", "samba playlist", "samba bossa playlist", "latin cafe playlist",
    "latin lounge playlist", "latin jazz playlist", "salsa lounge playlist", "tango playlist", "bolero playlist",
    "afro cuban lounge playlist"
  ]),
  plan(["Asia"], ["asia", "traditional"], [
    "Ravi Shankar sitar playlist", "Anoushka Shankar playlist", "Zakir Hussain tabla playlist", "Kodo taiko playlist",
    "Silk Road Ensemble playlist", "Wu Man pipa playlist", "Yoshida Brothers shamisen playlist", "traditional chinese music playlist",
    "guzheng playlist", "guqin playlist", "erhu playlist", "pipa playlist", "traditional japanese music playlist",
    "koto music playlist", "shamisen playlist", "shakuhachi playlist", "taiko playlist", "traditional korean music playlist",
    "vietnamese traditional music playlist", "dan bau playlist", "gamelan playlist", "sitar raga playlist", "bansuri playlist"
  ]),
  plan(["Middle East"], ["middle-east", "traditional"], [
    "Anouar Brahem oud playlist", "Omar Faruk Tekbilek playlist", "Kayhan Kalhor playlist", "Naseer Shamma oud playlist",
    "Marcel Khalife playlist", "Fairuz playlist", "Munir Bashir oud playlist", "middle eastern instrumental playlist",
    "traditional arabic music playlist", "arabic oud playlist", "persian traditional music playlist", "turkish traditional music playlist",
    "ottoman music playlist", "sufi music playlist", "oud playlist", "qanun playlist", "ney flute playlist",
    "darbuka playlist", "maqam playlist", "hijaz playlist", "duduk playlist", "desert caravan music playlist"
  ])
];

const supplementalQueryGroups = [
  plan(["Ambience"], ["ambience", "nature", "soundscape"], [
    "rain soundcloud sets", "sleep rain sounds set", "thunderstorm ambience playlist", "forest ambience soundscape playlist",
    "ocean waves soundcloud playlist", "river sounds set", "waterfall nature sounds set", "brown noise sleep playlist",
    "white noise study playlist", "nature soundscape set", "field recordings soundcloud playlist", "meditation frequency set",
    "432hz meditation set", "healing frequency set", "space ambience set"
  ]),
  plan(["Jazz & Blues"], ["jazz", "blues", "soul"], [
    "jazz lounge set", "smooth jazz soundcloud sets", "coffee jazz soundcloud", "blues guitar playlist",
    "soul jazz set", "jazz cafe set", "instrumental jazz set", "late night jazz set",
    "saxophone jazz set", "classic soul set", "neo soul set", "motown soul set", "delta blues set"
  ]),
  plan(["Orchestra"], ["classical", "orchestra"], [
    "classical violin set", "cello suite set", "chamber orchestra soundcloud", "string quartet soundcloud playlist",
    "classical symphony set", "choir classical set", "violin concerto set", "classical music set",
    "orchestral score set", "modern classical set", "classical ensemble set"
  ]),
  plan(["Piano"], ["piano"], [
    "solo piano set", "peaceful piano set", "soft piano set", "piano study set", "classical piano set",
    "piano covers set", "relaxing piano soundcloud set", "sleep piano set", "ambient piano set", "modern piano set"
  ]),
  plan(["Movies/Games"], ["movies-games", "ost"], [
    "anime ost playlist", "game music playlist", "video game music set", "movie score playlist", "film score set",
    "anime soundtrack set", "jrpg ost playlist", "rpg soundtrack set", "game soundtrack set", "cinematic soundtrack set"
  ]),
  plan(["Handpan & Kalimba"], ["handpan", "kalimba"], [
    "handpan music set", "handpan meditation set", "hang drum set", "tongue drum set", "kalimba covers set",
    "kalimba music set", "mbira set", "thumb piano set", "pantam music set"
  ]),
  plan(["House"], ["house", "groove"], [
    "deep house set", "nu disco set", "soulful house set", "disco house set", "lounge house set",
    "funky house set", "balearic house set", "house groove set", "classic house set", "jazzy house set",
    "poolside house mix", "rooftop house mix", "sunset disco house set", "beach disco house set",
    "cozy jazz house mix Amii Watson", "soulful pizza house mix", "warm deep house playlist"
  ]),
  plan(["Acoustic"], ["acoustic", "guitar"], [
    "fingerstyle guitar set", "acoustic guitar covers set", "bluegrass set", "country acoustic set",
    "folk acoustic set", "americana acoustic set", "solo guitar set", "nylon guitar set", "acoustic instrumental set"
  ]),
  plan(["Fantasy Folk"], ["fantasy", "folk"], [
    "medieval tavern set", "fantasy folk set", "celtic folk set", "nordic folk set", "viking music set",
    "dnd music set", "bard music set", "lute music set", "elven music set", "dungeon synth set"
  ]),
  plan(["Bossa"], ["bossa", "latin"], [
    "bossa set", "latin jazz set", "samba set", "tango set", "bolero set", "latin lounge set",
    "brazilian jazz set", "salsa lounge set", "afro cuban set", "latin cafe set"
  ]),
  plan(["Asia"], ["asia", "traditional"], [
    "guzheng set", "koto set", "sitar set", "tabla set", "shakuhachi set", "taiko set", "gamelan set",
    "erhu set", "pipa set", "traditional asian music set", "traditional japanese set", "traditional chinese set"
  ]),
  plan(["Middle East"], ["middle-east", "traditional"], [
    "oud set", "ney set", "duduk set", "arabic instrumental set", "persian music set", "turkish music set",
    "sufi music set", "maqam set", "qanun set", "middle eastern music set", "desert music set"
  ])
];

const lastChanceQueryGroups = [
  plan(["Ambience"], ["ambience", "soundscape"], [
    "ambient set", "soundscape set", "rain set", "sleep sounds set", "nature sounds set", "noise set"
  ]),
  plan(["Jazz & Blues"], ["jazz", "blues"], [
    "jazz set", "blues set", "soul set", "saxophone set", "lounge jazz set"
  ]),
  plan(["Orchestra"], ["classical", "orchestra"], [
    "classical set", "orchestra set", "violin set", "cello set", "strings set"
  ]),
  plan(["Piano"], ["piano"], [
    "piano set", "relaxing piano set", "study piano set", "soft piano set"
  ]),
  plan(["Movies/Games"], ["movies-games", "ost"], [
    "soundtrack set", "ost set", "game ost set", "anime ost set"
  ]),
  plan(["Handpan & Kalimba"], ["handpan", "kalimba"], [
    "handpan set", "kalimba set", "tongue drum music set"
  ]),
  plan(["House"], ["house"], [
    "house set", "deep house music set", "disco set", "groove set", "groovy soulful house set",
    "jazzy deep house set", "nu disco funky house warm playlist", "balearic groove house playlist"
  ]),
  plan(["Acoustic"], ["acoustic"], [
    "acoustic set", "guitar set", "folk guitar set"
  ]),
  plan(["Fantasy Folk"], ["fantasy", "folk"], [
    "folk set", "celtic set", "medieval set", "fantasy set"
  ]),
  plan(["Bossa"], ["bossa", "latin"], [
    "latin set", "samba music set", "bossa music set"
  ]),
  plan(["Asia"], ["asia", "traditional"], [
    "traditional music set", "asian music set", "sitar music set"
  ]),
  plan(["Middle East"], ["middle-east"], [
    "oud music set", "arabic music set", "persian set", "turkish set"
  ])
];

const ultraLastChanceQueryGroups = [
  plan(["Ambience"], ["ambience"], [
    "rain sounds playlist", "thunder sounds playlist", "ocean waves playlist", "forest sounds playlist", "fireplace sounds playlist",
    "campfire sounds playlist", "white noise sounds playlist", "brown noise sounds playlist", "waterfall sounds playlist", "river sounds playlist",
    "space ambience playlist", "cosmic ambience playlist", "field recording playlist", "nature ambience playlist", "sleep sounds playlist"
  ]),
  plan(["Jazz & Blues"], ["jazz"], [
    "jazz lounge playlist", "smooth jazz playlist", "coffee jazz playlist", "saxophone jazz playlist", "blues guitar playlist",
    "soul jazz playlist", "classic soul playlist", "neo soul playlist", "motown playlist", "delta blues playlist",
    "jazz instrumental playlist", "late night jazz playlist", "jazz cafe playlist"
  ]),
  plan(["Orchestra"], ["classical"], [
    "classical violin playlist", "classical cello playlist", "string quartet playlist", "chamber music playlist", "orchestral playlist",
    "choir playlist", "symphony playlist", "violin concerto playlist", "cello suite playlist", "classical ensemble playlist"
  ]),
  plan(["Piano"], ["piano"], [
    "solo piano playlist", "peaceful piano playlist", "soft piano playlist", "study piano playlist", "relaxing piano playlist",
    "sleep piano playlist", "piano covers playlist", "modern piano playlist", "classical piano playlist"
  ]),
  plan(["Movies/Games"], ["ost"], [
    "game soundtrack playlist", "video game ost playlist", "anime ost playlist", "movie score playlist", "film score playlist",
    "jrpg soundtrack playlist", "rpg soundtrack playlist", "cinematic soundtrack playlist", "soundtrack playlist"
  ]),
  plan(["Handpan & Kalimba"], ["handpan"], [
    "handpan music playlist", "handpan meditation playlist", "hang drum playlist", "tongue drum playlist", "kalimba music playlist",
    "kalimba covers playlist", "mbira music playlist", "thumb piano playlist", "pantam playlist"
  ]),
  plan(["House"], ["house"], [
    "deep house playlist", "soulful house playlist", "funky house playlist", "disco house playlist", "nu disco playlist",
    "classic house playlist", "balearic house playlist", "lounge house playlist", "house groove playlist",
    "warm house groove playlist", "poolside house playlist", "rooftop house playlist", "sunset disco house playlist"
  ]),
  plan(["Acoustic"], ["acoustic"], [
    "acoustic guitar playlist", "fingerstyle guitar playlist", "solo guitar playlist", "nylon guitar playlist", "bluegrass playlist",
    "country acoustic playlist", "americana acoustic playlist", "folk guitar playlist", "acoustic instrumental playlist"
  ]),
  plan(["Fantasy Folk"], ["fantasy"], [
    "fantasy music playlist", "medieval music playlist", "tavern music playlist", "celtic music playlist", "nordic folk playlist",
    "viking music playlist", "bard music playlist", "lute music playlist", "dungeon synth playlist", "elven music playlist"
  ]),
  plan(["Bossa"], ["bossa"], [
    "bossa music playlist", "samba playlist", "latin jazz playlist", "latin lounge playlist", "tango playlist",
    "bolero playlist", "brazilian jazz playlist", "salsa playlist", "afro cuban playlist"
  ]),
  plan(["Asia"], ["asia"], [
    "sitar music playlist", "tabla playlist", "guzheng playlist", "koto playlist", "shakuhachi playlist",
    "taiko playlist", "gamelan playlist", "erhu playlist", "pipa playlist", "traditional asian playlist"
  ]),
  plan(["Middle East"], ["middle-east"], [
    "oud music playlist", "ney playlist", "duduk playlist", "arabic instrumental playlist", "persian music playlist",
    "turkish music playlist", "sufi playlist", "maqam playlist", "qanun playlist", "middle eastern playlist"
  ])
];

function roundRobin(groups) {
  const out = [];
  const max = Math.max(...groups.map((group) => group.length));
  for (let index = 0; index < max; index++) {
    for (const group of groups) {
      if (group[index]) out.push(group[index]);
    }
  }
  return out;
}

const allQueryGroups = [...queryGroups, ...supplementalQueryGroups, ...lastChanceQueryGroups, ...ultraLastChanceQueryGroups];
const queryPlan = args.includes("--supplemental-only")
  ? roundRobin(supplementalQueryGroups)
  : args.includes("--last-chance")
    ? roundRobin([...lastChanceQueryGroups, ...ultraLastChanceQueryGroups])
  : roundRobin(allQueryGroups);

const CLASSIFIER_TAG_SLUGS = new Set([
  ...allQueryGroups.flatMap((group) => group.flatMap((entry) => entry.categories.map(slugify))),
  "ambience", "jazz-blues", "movies-games", "handpan-kalimba", "fantasy-folk", "middle-east",
  // Legacy classifier tags are stripped during migration but never emitted for new items.
  "bossa-nova", "rock-metal", "other", "editors-choice"
]);

function stripClassifierTags(tags = []) {
  return tags.filter((tag) => !CLASSIFIER_TAG_SLUGS.has(slugify(tag)));
}

function extractSoundCloudLinks(html) {
  const out = [];
  const hrefs = html.matchAll(/href="([^"]+)"/g);
  for (const match of hrefs) {
    const href = match[1].replace(/&amp;/g, "&");
    if (!href.startsWith("/") || href.startsWith("/_") || href.startsWith("/search")) continue;
    const parts = href.split("?")[0].split("/").filter(Boolean);
    if (parts.length < 2) continue;
    if (!parts.includes("sets")) continue;
    out.push(`https://soundcloud.com${href.split("?")[0]}`);
  }
  return [...new Set(out)];
}

let cachedSoundCloudClientId = "";

async function fetchSoundCloudClientId() {
  if (cachedSoundCloudClientId) return cachedSoundCloudClientId;
  const response = await fetch("https://soundcloud.com", {
    headers: { "User-Agent": "Mozilla/5.0 MusicProCatalogSeeder/0.1", Accept: "text/html,application/xhtml+xml" }
  });
  if (!response.ok) return "";
  const hydration = extractSoundCloudHydration(await response.text());
  cachedSoundCloudClientId = String(hydration.find((entry) => entry?.hydratable === "apiClient")?.data?.id || "");
  return cachedSoundCloudClientId;
}

async function fetchApiSearchLinks(query) {
  const clientId = await fetchSoundCloudClientId();
  if (!clientId) return [];
  const url = `https://api-v2.soundcloud.com/search/playlists?q=${encodeURIComponent(query)}&client_id=${encodeURIComponent(clientId)}&limit=${MAX_LINKS_PER_QUERY}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 MusicProCatalogSeeder/0.1", Accept: "application/json" }
  });
  if (!response.ok) return [];
  const data = await response.json();
  const collection = Array.isArray(data?.collection) ? data.collection : [];
  return collection
    .map((entry) => entry?.permalink_url || entry?.uri || "")
    .filter((url) => /https?:\/\/soundcloud\.com\/.+\/sets\//i.test(url));
}

async function fetchMobileSearchLinks(query) {
  const url = `https://m.soundcloud.com/search/sets?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 MusicProCatalogSeeder/0.1" } });
  if (!response.ok) throw new Error(`Search failed ${response.status}: ${query}`);
  const html = await response.text();
  return extractSoundCloudLinks(html);
}

async function fetchSearchLinks(query) {
  const [apiResult, mobileResult] = await Promise.allSettled([
    fetchApiSearchLinks(query),
    fetchMobileSearchLinks(query)
  ]);
  const apiLinks = apiResult.status === "fulfilled" ? apiResult.value : [];
  const mobileLinks = mobileResult.status === "fulfilled" ? mobileResult.value : [];
  if (apiResult.status === "rejected" && mobileResult.status === "rejected") {
    throw mobileResult.reason || apiResult.reason;
  }
  return [...new Set([...apiLinks, ...mobileLinks])];
}

async function readBundledCatalogCandidatePool() {
  try {
    const text = await readFile(bundledPath, "utf8");
    const match = text.match(/export const BUNDLED_CATALOG[^=]*=\s*([\s\S]*);\s*$/);
    if (!match?.[1]) return { version: 1, updatedAt: today(), items: [] };
    return normalizeCatalog(JSON.parse(match[1]));
  } catch {
    return { version: 1, updatedAt: today(), items: [] };
  }
}

function makeFallbackCandidate(sourceItem) {
  if (!isSafeSeedCandidate(`${sourceItem.title || ""} ${sourceItem.artist || ""} ${sourceItem.url || ""}`)) return null;
  const sourceTags = stripClassifierTags(sourceItem.tags || []);
  const categories = inferPlaylistCategories(
    { ...sourceItem, tags: sourceTags },
    { preserveExplicit: false, preserveEditorsChoice: false }
  ).filter((category) => DEFAULT_CATEGORY_LABELS.includes(category));
  if (categories.length === 0) return null;
  const title = cleanTitle(sourceItem.title || "Untitled", sourceItem.artist || "");
  const artist = String(sourceItem.artist || "SoundCloud").trim();
  if (isLowValueSeedMetadata(title, artist, categories)) return null;
  const tags = [...new Set([
    ...sourceTags,
    ...categories.map((category) => slugify(category)).filter(Boolean)
  ])].filter((tag) => slugify(tag) !== "editors-choice");
  const item = {
    ...sourceItem,
    categories,
    tags,
    displayTitle: makeDisplayTitle(title, artist, categories, tags),
    source: "curated",
    status: "active"
  };
  delete item.category;
  delete item.mood;
  const score = Math.max(...categories.map((category) => getPlaylistSortProfile(item, category).totalScore)) - getAvailabilityRiskPenalty(title, artist, item.url);
  return { item, title, artist, categories, score };
}

const catalog = freshCatalog
  ? { version: 1, updatedAt: today(), items: [] }
  : await readCatalog();

if (freshCatalog) {
  console.log("Fresh catalog mode: starting from 0 items; Editor's Choice remains empty until manually curated.");
} else {
  const migratedItems = [];
  for (const item of catalog.items) {
    if (!isSafeSeedCandidate(`${item.title || ""} ${item.artist || ""} ${item.url || ""}`)) continue;
    const sourceTags = stripClassifierTags(item.tags || []);
    const inferred = inferPlaylistCategories({ ...item, tags: sourceTags }, { preserveExplicit: false });
    if (inferred.length === 0) continue;
    item.tags = [...new Set([
      ...sourceTags,
      ...inferred.map((category) => slugify(category)).filter(Boolean)
    ])];
    item.categories = inferred;
    migratedItems.push(item);
  }
  catalog.items = migratedItems;
}
const existing = new Set(catalog.items.map((item) => normalizeSoundCloudUrl(item.url).toLowerCase()));
const exactTitleArtistKeys = new Set(catalog.items.map((item) => exactTitleArtistKey(item.title, item.artist)));
const similarTitleCategoryCounts = new Map();
for (const item of catalog.items) {
  for (const category of item.categories || []) {
    const key = `${category}::${similarTitleKey(item.title)}`;
    similarTitleCategoryCounts.set(key, (similarTitleCategoryCounts.get(key) || 0) + 1);
  }
}
let added = 0;
let reused = 0;
for (const plan of queryPlan) {
  if (catalog.items.length >= target) break;
  console.log(`Search: ${plan.query}`);
  let links = [];
  try {
    links = (await fetchSearchLinks(plan.query)).slice(0, MAX_LINKS_PER_QUERY);
  } catch (error) {
    console.error(error.message);
    continue;
  }
  const candidates = (await mapWithConcurrency(links, SCREEN_CONCURRENCY, async (link) => {
    try {
      const url = normalizeSoundCloudUrl(link);
      if (existing.has(url.toLowerCase())) return null;
      const data = await fetchOEmbed(url);
      const candidate = makeSeedCandidate(url, data, plan);
      if (!candidate) return null;
      const screened = await applyAvailabilityScreen(candidate, url);
      if (screened.candidate) return screened.candidate;
      console.log(`  - reject ${candidate.item.displayTitle || candidate.title}: ${screened.screen.reason}`);
      return null;
    } catch (error) {
      console.error(`  - skip ${link}: ${error.message}`);
      return null;
    } finally {
      if (FETCH_DELAY_MS > 0) await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS));
    }
  })).filter(Boolean);

  const ranked = candidates
    .sort((a, b) => b.score - a.score || compareCatalogItemsForCategory(a.item, b.item, plan.categories[0]));
  let addedForQuery = 0;
  for (const candidate of ranked) {
    if (catalog.items.length >= target || addedForQuery >= MAX_ADDED_PER_QUERY) break;
    const { item, title, artist, categories } = candidate;
    const exactKey = exactTitleArtistKey(title, artist);
    if (exactTitleArtistKeys.has(exactKey)) continue;
    const similarKey = similarTitleKey(title);
    if (categories.some((category) => (similarTitleCategoryCounts.get(`${category}::${similarKey}`) || 0) >= MAX_SIMILAR_TITLE_PER_CATEGORY)) continue;
    let base = item.id;
    let suffix = 2;
    while (catalog.items.some((existingItem) => existingItem.id === item.id)) item.id = `${base}-${suffix++}`;
    catalog.items.push(item);
    existing.add(normalizeSoundCloudUrl(item.url).toLowerCase());
    exactTitleArtistKeys.add(exactKey);
    for (const category of categories) {
      const key = `${category}::${similarKey}`;
      similarTitleCategoryCounts.set(key, (similarTitleCategoryCounts.get(key) || 0) + 1);
    }
    added++;
    addedForQuery++;
    console.log(`  + ${item.displayTitle || item.title} — ${item.artist} (${candidate.score.toFixed(1)})`);
  }
}

if (freshCatalog && catalog.items.length < target) {
  console.log(`Fallback: re-screening bundled catalog candidates (${catalog.items.length}/${target}).`);
  const bundledCatalog = await readBundledCatalogCandidatePool();
  const fallbackCandidates = bundledCatalog.items
    .filter((item) => item.status === "active" && item.provider === "soundcloud" && item.type === "playlist")
    .filter((item) => !existing.has(normalizeSoundCloudUrl(item.url).toLowerCase()))
    .map((item) => makeFallbackCandidate(item))
    .filter(Boolean);

  const screenedFallbackCandidates = (await mapWithConcurrency(fallbackCandidates, SCREEN_CONCURRENCY, async (candidate) => {
    const screened = await applyAvailabilityScreen(candidate, candidate.item.url);
    return screened.candidate || null;
  })).filter(Boolean);

  screenedFallbackCandidates
    .sort((a, b) => b.score - a.score || compareCatalogItemsForCategory(a.item, b.item, a.categories[0] || ""));

  for (const candidate of screenedFallbackCandidates) {
    if (catalog.items.length >= target) break;
    const { item, title, artist, categories } = candidate;
    const exactKey = exactTitleArtistKey(title, artist);
    if (exactTitleArtistKeys.has(exactKey)) continue;
    const similarKey = similarTitleKey(title);
    if (categories.some((category) => (similarTitleCategoryCounts.get(`${category}::${similarKey}`) || 0) >= MAX_SIMILAR_TITLE_PER_CATEGORY)) continue;
    let base = item.id;
    let suffix = 2;
    while (catalog.items.some((existingItem) => existingItem.id === item.id)) item.id = `${base}-${suffix++}`;
    catalog.items.push(item);
    existing.add(normalizeSoundCloudUrl(item.url).toLowerCase());
    exactTitleArtistKeys.add(exactKey);
    for (const category of categories) {
      const key = `${category}::${similarKey}`;
      similarTitleCategoryCounts.set(key, (similarTitleCategoryCounts.get(key) || 0) + 1);
    }
    reused++;
  }
}
const normalized = await writeCatalog(catalog);
const errors = validateCatalog(normalized);
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`Seed complete: ${normalized.items.length} items (${added} searched, ${reused} reused from screened bundled candidates).`);
